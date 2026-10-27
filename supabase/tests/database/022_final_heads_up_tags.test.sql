-- =============================================================================
-- pgTAP test 22: the final heads-up tags and when a tag may be shown
-- (VC-45, VC-56, VC-57, VC-59, VC-60), migration
-- 20261027190000_final_heads_up_tags.sql.
--
-- What it checks, in plain words:
--   * Locked down: the new helpers can't be called from the app; the
--     changed public functions are security definer with an empty
--     search_path and closed to anon; no second copy (overload) appeared.
--   * The list: exactly the nine tags, in the designer's order. Retired
--     tags (music_fire, packed, good_crowd) can't be +1'd or reported any
--     more; in a rating they are dropped quietly (old builds, temporary
--     until B14) while unknown tags are still refused; old rows with them
--     stay, and they are never shown.
--     Admins can still close an old report about a retired tag.
--   * VC-56: one guest's tag is not shown (not even to them); 2 guests is.
--     The admin tag list still shows the 1-guest counts.
--   * VC-59: "Felt unsafe" needs 3+ guests AND at least 10% of tonight's
--     raters (the legal text says "whichever is higher"). Edges: exactly
--     10% shows; just under doesn't; hidden ratings and ratings from before
--     5 AM don't count as tonight's raters.
--   * VC-60: "Felt unsafe" picks from before 5 AM New York don't count, even
--     inside the 3-hour window; other tags aren't affected. The score
--     functions never read heads-ups.
--   * private.night_start: 5 AM New York, including the daylight-saving
--     change day.
--
-- How time is handled: now() is frozen for the whole test. The bar tests
-- call the counting core private.event_heads_ups with a fixed moment, 6 AM
-- New York on Fri 30 Oct 2026 (night began at 5 AM), so they don't depend
-- on when the test runs. Everything runs inside BEGIN ... ROLLBACK.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(33);

-- ---- Setup (as owner) -------------------------------------------------------
-- Guests …01 to …40, an admin …a1.
insert into auth.users (id, email)
select ('22222222-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'tags-' || n || '@test.vibecheck.invalid'
from generate_series(1, 40) n;
insert into auth.users (id, email) values
  ('22222222-9999-4999-8999-0000000000a1', 'tags-admin@test.vibecheck.invalid');
insert into public.profiles (id, display_name, birthdate, is_tester, role)
select ('22222222-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'Tags guest ' || n, current_date - interval '30 years', false, 'user'
from generate_series(1, 40) n;
insert into public.profiles (id, display_name, birthdate, is_tester, role) values
  ('22222222-9999-4999-8999-0000000000a1', 'Tags admin', current_date - interval '40 years', false, 'admin');

-- The fixed moment for the bar tests: 6 AM New York, Fri 30 Oct 2026.
create function pg_temp.t() returns timestamptz language sql immutable as $$
  /* Returns the test's fixed "now" for private.event_heads_ups. */
  select '2026-10-30 06:00:00 America/New_York'::timestamptz;
$$;

-- A guest's id from their number (1 -> …01).
create function pg_temp.g(p_n integer) returns uuid language sql immutable as $$
  /* Input: a guest number. Returns that guest's user id. */
  select ('22222222-9999-4999-8999-0000000000' || lpad(p_n::text, 2, '0'))::uuid;
$$;

-- Guests from..to rate an event (all "Good"), saved at p_at.
create function pg_temp.rate(p_event text, p_from integer, p_to integer, p_at timestamptz)
returns void language sql as $$
  /* Inputs: event id, first and last guest number, when. Returns nothing. */
  insert into public.ratings (user_id, event_id, crowd, music, energy, created_at, updated_at)
  select pg_temp.g(n), p_event::uuid, 2, 2, 2, p_at, p_at
  from generate_series(p_from, p_to) n;
$$;

-- Guests from..to pick one tag at an event, at p_at.
create function pg_temp.pick(p_event text, p_tag text, p_from integer, p_to integer, p_at timestamptz)
returns void language sql as $$
  /* Inputs: event id, tag, first and last guest number, when. Returns nothing. */
  insert into public.heads_up_votes (user_id, event_id, tag, created_at)
  select pg_temp.g(n), p_event::uuid, p_tag, p_at
  from generate_series(p_from, p_to) n;
$$;

-- Events. …e0 is on right now (for the guest-facing calls). …f1 to …f6 are
-- on around the fixed moment (for the bar tests, one case each).
insert into public.events (id, title, area_label, starts_at, ends_at, is_test) values
  ('22222222-0000-4000-8000-0000000000e0', 'Tags live', 'Shaw, DC', now() - interval '1 hour', now() + interval '3 hours', false);
insert into public.events (id, title, area_label, starts_at, ends_at, is_test)
select ('22222222-0000-4000-8000-0000000000f' || n)::uuid, 'Tags ' || n, 'Shaw, DC',
       pg_temp.t() - interval '4 hours', pg_temp.t() + interval '2 hours', false
from generate_series(1, 6) n;

-- At e0: guests 1 and 2 checked in just now; guests 3 and 4 have OLD
-- "packed" rows (saved before VC-45 retired it), which stay as they are.
insert into public.check_ins (user_id, event_id, method, first_at, last_verified_at)
select pg_temp.g(n), '22222222-0000-4000-8000-0000000000e0', 'gps', now(), now()
from generate_series(1, 2) n;
select pg_temp.pick('22222222-0000-4000-8000-0000000000e0', 'packed', 3, 4, now());

-- ---- 1. Locked down (5) -----------------------------------------------------
select ok(not has_function_privilege('authenticated', 'private.heads_up_tags_active()', 'execute')
          and not has_function_privilege('authenticated', 'private.heads_up_tags_retired()', 'execute')
          and not has_function_privilege('authenticated', 'private.night_start(timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'private.check_known_heads_up_tag(text)', 'execute')
          and not has_function_privilege('authenticated', 'private.check_heads_up_tags(text[])', 'execute')
          and not has_function_privilege('authenticated', 'private.event_heads_ups(uuid, uuid, timestamptz)', 'execute')
          and not has_function_privilege('anon', 'private.event_heads_ups(uuid, uuid, timestamptz)', 'execute'),
  'the app can''t call the new private helpers (or the counting core directly)');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'])
           from pg_proc where oid in (
             'public.get_event_heads_ups(uuid)'::regprocedure,
             'public.admin_set_tag_hidden(uuid, text, boolean, text, text)'::regprocedure,
             'public.admin_keep_tag(uuid, text, text, text)'::regprocedure)),
  'the changed public functions are security definer with an empty search_path');
select ok((select bool_and(proconfig @> array['search_path=""'])
           from pg_proc where oid in (
             'private.heads_up_tags_active()'::regprocedure,
             'private.heads_up_tags_retired()'::regprocedure,
             'private.night_start(timestamptz)'::regprocedure,
             'private.check_known_heads_up_tag(text)'::regprocedure,
             'private.check_heads_up_tags(text[])'::regprocedure,
             'private.event_heads_ups(uuid, uuid, timestamptz)'::regprocedure)),
  'the helpers have an empty search_path too');
select ok(not has_function_privilege('anon', 'public.get_event_heads_ups(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.admin_set_tag_hidden(uuid, text, boolean, text, text)', 'execute')
          and not has_function_privilege('anon', 'public.admin_keep_tag(uuid, text, text, text)', 'execute')
          and has_function_privilege('authenticated', 'public.get_event_heads_ups(uuid)', 'execute'),
  'anon can''t call them; signed-in users can call get_event_heads_ups');
select is((select count(*)::int from pg_proc
           where proname in ('get_event_heads_ups', 'event_heads_ups', 'check_heads_up_tags',
                             'admin_set_tag_hidden', 'admin_keep_tag')),
  5, 'no second copy (overload) of any changed function');

-- ---- 2. The list and night_start (5) ----------------------------------------
select is(private.heads_up_tags_active(),
  array['lines_long', 'overpriced', 'dress_code', 'friendly_crowd', 'sound_bad',
        'felt_unsafe', 'picking_up', 'clearing_out', 'parking_rough'],
  'exactly the nine tags, in the designer''s order (VC-45 + VC-57)');
select is(private.heads_up_tags_retired(), array['music_fire', 'packed', 'good_crowd'],
  'three tags are retired');
select is(private.night_start('2026-10-28 03:00 America/New_York'),
  '2026-10-27 05:00 America/New_York'::timestamptz, '3 AM belongs to the night that began 5 AM the day before');
select is(private.night_start('2026-10-28 05:00 America/New_York'),
  '2026-10-28 05:00 America/New_York'::timestamptz, 'exactly 5 AM starts a new night');
select is(private.night_start('2026-11-01 04:59 America/New_York'),
  '2026-10-31 05:00 America/New_York'::timestamptz, 'the daylight-saving change night still starts at 5 AM');

-- ---- 3. Retired tags, VC-56, admins (11) ------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-9999-4999-8999-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.submit_rating('22222222-0000-4000-8000-0000000000e0', 2, 2, 2, null, array['lines_long', 'liar']) $$,
  'VCTAG', null, 'a rating with an unknown tag is still refused');
select throws_ok($$ select public.add_heads_up('22222222-0000-4000-8000-0000000000e0', 'music_fire') $$,
  'VCTAG', null, 'a retired tag can''t be +1''d');
select throws_ok($$ select public.report_heads_up_tag('22222222-0000-4000-8000-0000000000e0', 'good_crowd', 'not_true') $$,
  'VCTAG', null, 'a retired tag can''t be newly reported');
-- An older build (before VC-45) sends a retired tag with the nine: the
-- rating is saved and only the retired tag is dropped (migration
-- 20261027190100, temporary until B14).
select is(public.submit_rating('22222222-0000-4000-8000-0000000000e0', 2, 2, 2, null,
            array['lines_long', 'overpriced', 'dress_code', 'friendly_crowd', 'sound_bad',
                  'felt_unsafe', 'picking_up', 'clearing_out', 'parking_rough', 'packed']) ->> 'status',
  'saved', 'all nine tags can be picked; a retired one alongside doesn''t block the rating');
reset role;
select is((select array_agg(tag order by tag) from public.heads_up_votes
           where event_id = '22222222-0000-4000-8000-0000000000e0' and user_id = pg_temp.g(1)),
  array['clearing_out', 'dress_code', 'felt_unsafe', 'friendly_crowd', 'lines_long',
        'overpriced', 'parking_rough', 'picking_up', 'sound_bad'],
  'the nine tags were saved and the retired "packed" was dropped');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-9999-4999-8999-000000000001","role":"authenticated"}', true);
select is(public.get_event_heads_ups('22222222-0000-4000-8000-0000000000e0'), '[]'::jsonb,
  'VC-56: one guest''s nine tags aren''t shown, not even to that guest; old "packed" rows (2 guests) aren''t shown either');
select set_config('request.jwt.claims', '{"sub":"22222222-9999-4999-8999-000000000002","role":"authenticated"}', true);
select is(public.add_heads_up('22222222-0000-4000-8000-0000000000e0', 'parking_rough'),
  '{"status": "added"}'::jsonb, 'a second guest +1s "Parking is rough"');
select is(public.get_event_heads_ups('22222222-0000-4000-8000-0000000000e0'),
  '[{"tag": "parking_rough", "count": 2, "mine": true}]'::jsonb,
  'VC-56: at 2 guests the tag shows; the 1-guest tags still don''t');
reset role;
select is((select count(*)::int from public.heads_up_votes
           where event_id = '22222222-0000-4000-8000-0000000000e0' and tag = 'packed'),
  2, 'old rows with a retired tag are left untouched');
-- An old open report about "packed", filed before VC-45.
insert into private.tag_reports (event_id, tag, reporter_id, reason)
values ('22222222-0000-4000-8000-0000000000e0', 'packed', pg_temp.g(2), 'not_true');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-9999-4999-8999-0000000000a1","role":"authenticated"}', true);
select is((select jsonb_object_agg(x ->> 'tag', (x ->> 'votes')::int)
           from jsonb_array_elements(public.admin_get_event_tags('22222222-0000-4000-8000-0000000000e0')) x
           where x ->> 'tag' in ('felt_unsafe', 'packed', 'parking_rough')),
  '{"felt_unsafe": 1, "packed": 2, "parking_rough": 2}'::jsonb,
  'the admin tag list still sees every count, under the bar and retired ones too');
select is(public.admin_keep_tag('22222222-0000-4000-8000-0000000000e0', 'packed', 'no_rule_broken'),
  '{"status": "done"}'::jsonb, 'an admin can still close an old report about a retired tag');
select throws_ok($$ select public.admin_set_tag_hidden('22222222-0000-4000-8000-0000000000e0', 'liar', true, 'coordinated') $$,
  'VCTAG', null, 'admins still can''t use a tag that never existed');
reset role;

-- ---- 4. VC-59: the "Felt unsafe" bar (8) ------------------------------------
-- All at the fixed moment (6 AM), picks and ratings 30 minutes earlier.
-- f1: 10 raters, 2 guests pick felt_unsafe and 2 pick lines_long.
select pg_temp.rate('22222222-0000-4000-8000-0000000000f1', 1, 10, pg_temp.t() - interval '30 minutes');
select pg_temp.pick('22222222-0000-4000-8000-0000000000f1', 'felt_unsafe', 1, 2, pg_temp.t() - interval '30 minutes');
select pg_temp.pick('22222222-0000-4000-8000-0000000000f1', 'lines_long', 1, 2, pg_temp.t() - interval '30 minutes');
select is(private.event_heads_ups('22222222-0000-4000-8000-0000000000f1', null, pg_temp.t()),
  '[{"tag": "lines_long", "count": 2, "mine": false}]'::jsonb,
  '2 guests: "Long line" shows, "Felt unsafe" doesn''t (needs 3)');
select pg_temp.pick('22222222-0000-4000-8000-0000000000f1', 'felt_unsafe', 3, 3, pg_temp.t() - interval '30 minutes');
select is(private.event_heads_ups('22222222-0000-4000-8000-0000000000f1', pg_temp.g(3), pg_temp.t()) -> 0,
  '{"tag": "felt_unsafe", "count": 3, "mine": true}'::jsonb,
  '3 guests out of 10 raters: "Felt unsafe" shows (3 is above 10%)');
-- f2: 31 raters, 3 picks: 3 is under 10% of 31 (3.1).
select pg_temp.rate('22222222-0000-4000-8000-0000000000f2', 1, 31, pg_temp.t() - interval '30 minutes');
select pg_temp.pick('22222222-0000-4000-8000-0000000000f2', 'felt_unsafe', 1, 3, pg_temp.t() - interval '30 minutes');
select is(private.event_heads_ups('22222222-0000-4000-8000-0000000000f2', null, pg_temp.t()), '[]'::jsonb,
  '3 guests out of 31 raters: hidden (under 10%; the higher bar wins)');
select pg_temp.pick('22222222-0000-4000-8000-0000000000f2', 'felt_unsafe', 4, 4, pg_temp.t() - interval '30 minutes');
select is(private.event_heads_ups('22222222-0000-4000-8000-0000000000f2', null, pg_temp.t()),
  '[{"tag": "felt_unsafe", "count": 4, "mine": false}]'::jsonb,
  'a 4th guest out of 31 raters: shows');
-- f3: exactly 30 raters, 3 picks = exactly 10%: shows.
select pg_temp.rate('22222222-0000-4000-8000-0000000000f3', 1, 30, pg_temp.t() - interval '30 minutes');
select pg_temp.pick('22222222-0000-4000-8000-0000000000f3', 'felt_unsafe', 1, 3, pg_temp.t() - interval '30 minutes');
select is(jsonb_array_length(private.event_heads_ups('22222222-0000-4000-8000-0000000000f3', null, pg_temp.t())), 1,
  'exactly 10% (3 of 30) is enough');
-- f4: 33 ratings, but 2 hidden and 2 saved before 5 AM: 29 count, so 3 shows.
select pg_temp.rate('22222222-0000-4000-8000-0000000000f4', 1, 29, pg_temp.t() - interval '30 minutes');
select pg_temp.rate('22222222-0000-4000-8000-0000000000f4', 30, 31, pg_temp.t() - interval '30 minutes');
select pg_temp.rate('22222222-0000-4000-8000-0000000000f4', 32, 33, pg_temp.t() - interval '2 hours');
update public.ratings set hidden_at = pg_temp.t()
where event_id = '22222222-0000-4000-8000-0000000000f4' and user_id in (pg_temp.g(30), pg_temp.g(31));
select pg_temp.pick('22222222-0000-4000-8000-0000000000f4', 'felt_unsafe', 1, 3, pg_temp.t() - interval '30 minutes');
select is(jsonb_array_length(private.event_heads_ups('22222222-0000-4000-8000-0000000000f4', null, pg_temp.t())), 1,
  'hidden ratings and ratings from before 5 AM aren''t tonight''s raters (29 count, 3 picks show)');
-- One more visible rater tonight (30) would still allow it; 31 would not.
select pg_temp.rate('22222222-0000-4000-8000-0000000000f4', 34, 35, pg_temp.t() - interval '10 minutes');
select is(private.event_heads_ups('22222222-0000-4000-8000-0000000000f4', null, pg_temp.t()), '[]'::jsonb,
  'two more raters tonight (31): the same 3 picks drop under 10%');
-- A hidden rater's own pick doesn't count toward the 3 either.
select pg_temp.rate('22222222-0000-4000-8000-0000000000f5', 1, 5, pg_temp.t() - interval '30 minutes');
select pg_temp.pick('22222222-0000-4000-8000-0000000000f5', 'felt_unsafe', 1, 3, pg_temp.t() - interval '30 minutes');
update public.ratings set hidden_at = pg_temp.t()
where event_id = '22222222-0000-4000-8000-0000000000f5' and user_id = pg_temp.g(1);
select is(private.event_heads_ups('22222222-0000-4000-8000-0000000000f5', null, pg_temp.t()), '[]'::jsonb,
  'a hidden rater''s pick doesn''t count, so 2 left: hidden');

-- ---- 5. VC-60: tonight only, and never in the score (3) ---------------------
-- f6: 5 raters. Felt unsafe: 3 picks at 4:59 AM (last night, though inside
-- the 3-hour window) and 2 at 5:30 AM. Long line: 2 picks at 4:59 AM.
select pg_temp.rate('22222222-0000-4000-8000-0000000000f6', 1, 5, pg_temp.t() - interval '30 minutes');
select pg_temp.pick('22222222-0000-4000-8000-0000000000f6', 'felt_unsafe', 1, 3, pg_temp.t() - interval '61 minutes');
select pg_temp.pick('22222222-0000-4000-8000-0000000000f6', 'felt_unsafe', 4, 5, pg_temp.t() - interval '30 minutes');
select pg_temp.pick('22222222-0000-4000-8000-0000000000f6', 'lines_long', 1, 2, pg_temp.t() - interval '61 minutes');
select is(private.event_heads_ups('22222222-0000-4000-8000-0000000000f6', null, pg_temp.t()),
  '[{"tag": "lines_long", "count": 2, "mine": false}]'::jsonb,
  '"Felt unsafe" from before 5 AM doesn''t count (only 2 tonight); other tags keep the plain 3-hour window');
-- Asked at 4:59:30 AM instead, the 4:59 picks belong to that (earlier)
-- night and count; the 5:30 picks and ratings haven't happened yet.
select is(private.event_heads_ups('22222222-0000-4000-8000-0000000000f6', null, pg_temp.t() - interval '60 minutes 30 seconds'),
  '[{"tag": "felt_unsafe", "count": 3, "mine": false}, {"tag": "lines_long", "count": 2, "mine": false}]'::jsonb,
  'asked at 4:59:30 AM, the same 3 early picks count (they are that night''s)');
select ok(not exists (
            select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'private')
              and p.proname ~ 'vibe|score'
              and p.prosrc ~ 'heads_up_votes'),
  'no score or vibe function reads heads-ups (tags are never part of the score)');

select * from finish();
rollback;
