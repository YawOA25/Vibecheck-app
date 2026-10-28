-- =============================================================================
-- pgTAP test 25: heads-up tags show only once 5 or more different guests
-- rated tonight (VC-67, batch Q1), migration
-- 20261027230000_tags_need_five_raters.sql.
--
-- What it checks, in plain words:
--   * Locked down: the counting core is security definer with an empty
--     search_path, the app (anon or signed in) can't call it, and there is
--     still only one copy of it and of get_event_heads_ups.
--   * The bar: with 4 raters tonight, a tag 2 guests picked is NOT shown
--     (not even "mine" to a guest who picked it); the 5th rater makes it
--     show.
--   * Who counts as "tonight's raters": a hidden rating doesn't count, and
--     a rating saved before 5 AM New York (last night) doesn't count.
--   * The older bars still apply on top: at 5 raters a 1-guest tag stays
--     hidden, and "Felt unsafe" still needs 3 guests.
--   * Through the app's own call (get_event_heads_ups) at a live event:
--     4 raters -> [] for the guest; the admin tag list still shows every
--     count (moderation sees everything); the 5th rater -> shown.
--
-- How time is handled: now() is frozen for the whole test. The bar tests
-- call private.event_heads_ups with a fixed moment, 6 AM New York on Fri
-- 30 Oct 2026 (night began at 5 AM). Everything runs inside
-- BEGIN ... ROLLBACK, so nothing is kept.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- ---- Setup (as owner) -------------------------------------------------------
-- Guests …01 to …10, an admin …a1.
insert into auth.users (id, email)
select ('25252525-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'five-' || n || '@test.vibecheck.invalid'
from generate_series(1, 10) n;
insert into auth.users (id, email) values
  ('25252525-9999-4999-8999-0000000000a1', 'five-admin@test.vibecheck.invalid');
insert into public.profiles (id, display_name, birthdate, is_tester, role)
select ('25252525-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'Five guest ' || n, current_date - interval '30 years', false, 'user'
from generate_series(1, 10) n;
insert into public.profiles (id, display_name, birthdate, is_tester, role) values
  ('25252525-9999-4999-8999-0000000000a1', 'Five admin', current_date - interval '40 years', false, 'admin');

-- The fixed moment for the bar tests: 6 AM New York, Fri 30 Oct 2026.
create function pg_temp.t() returns timestamptz language sql immutable as $$
  /* Returns the test's fixed "now" for private.event_heads_ups. */
  select '2026-10-30 06:00:00 America/New_York'::timestamptz;
$$;

-- A guest's id from their number (1 -> …01).
create function pg_temp.g(p_n integer) returns uuid language sql immutable as $$
  /* Input: a guest number. Returns that guest's user id. */
  select ('25252525-9999-4999-8999-0000000000' || lpad(p_n::text, 2, '0'))::uuid;
$$;

-- An event id from a short code ('f1' -> …f1).
create function pg_temp.e(p_code text) returns uuid language sql immutable as $$
  /* Input: the event's last two characters. Returns the event id. */
  select ('25252525-0000-4000-8000-0000000000' || p_code)::uuid;
$$;

-- Guests from..to rate an event (all "Good"), saved at p_at.
create function pg_temp.rate(p_event text, p_from integer, p_to integer, p_at timestamptz)
returns void language sql as $$
  /* Inputs: event code, first and last guest number, when. Returns nothing. */
  insert into public.ratings (user_id, event_id, crowd, music, energy, created_at, updated_at)
  select pg_temp.g(n), pg_temp.e(p_event), 2, 2, 2, p_at, p_at
  from generate_series(p_from, p_to) n;
$$;

-- Guests from..to pick one tag at an event, at p_at.
create function pg_temp.pick(p_event text, p_tag text, p_from integer, p_to integer, p_at timestamptz)
returns void language sql as $$
  /* Inputs: event code, tag, first and last guest number, when. Returns nothing. */
  insert into public.heads_up_votes (user_id, event_id, tag, created_at)
  select pg_temp.g(n), pg_temp.e(p_event), p_tag, p_at
  from generate_series(p_from, p_to) n;
$$;

-- Events: …e0 is on right now (for the app's own call); …f1 to …f4 are on
-- around the fixed moment (one bar case each).
insert into public.events (id, title, area_label, starts_at, ends_at, is_test) values
  (pg_temp.e('e0'), 'Five live', 'Shaw, DC', now() - interval '1 hour', now() + interval '3 hours', false);
insert into public.events (id, title, area_label, starts_at, ends_at, is_test)
select pg_temp.e('f' || n), 'Five ' || n, 'Shaw, DC',
       pg_temp.t() - interval '4 hours', pg_temp.t() + interval '2 hours', false
from generate_series(1, 4) n;

-- ---- 1. Locked down (3) -----------------------------------------------------
select ok((select prosecdef and proconfig @> array['search_path=""']
           from pg_proc where oid = 'private.event_heads_ups(uuid, uuid, timestamptz)'::regprocedure),
  'the counting core is security definer with an empty search_path');
select ok(not has_function_privilege('anon', 'private.event_heads_ups(uuid, uuid, timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'private.event_heads_ups(uuid, uuid, timestamptz)', 'execute')
          and not has_function_privilege('anon', 'public.get_event_heads_ups(uuid)', 'execute'),
  'the app can''t call the core directly, and anon can''t call get_event_heads_ups');
select is((select count(*)::int from pg_proc
           where proname in ('event_heads_ups', 'get_event_heads_ups')),
  2, 'still one copy (no overload) of each heads-up counting function');

-- ---- 2. The 5-rater bar (4) -------------------------------------------------
-- f1: 4 raters tonight (5:30 AM); guests 1 and 2 picked "Long line".
select pg_temp.rate('f1', 1, 4, pg_temp.t() - interval '30 minutes');
select pg_temp.pick('f1', 'lines_long', 1, 2, pg_temp.t() - interval '30 minutes');
select is(private.event_heads_ups(pg_temp.e('f1'), null, pg_temp.t()), '[]'::jsonb,
  '4 raters tonight: a tag 2 guests picked is not shown');
select is(private.event_heads_ups(pg_temp.e('f1'), pg_temp.g(1), pg_temp.t()), '[]'::jsonb,
  '4 raters tonight: not even "mine" reaches a guest who picked it');
-- One more guest rates: 5 raters.
select pg_temp.rate('f1', 5, 5, pg_temp.t() - interval '10 minutes');
select is(private.event_heads_ups(pg_temp.e('f1'), pg_temp.g(1), pg_temp.t()),
  '[{"tag": "lines_long", "count": 2, "mine": true}]'::jsonb,
  'the 5th rater tonight: the tag shows');
-- A 1-guest tag stays under the VC-56 bar even now.
select pg_temp.pick('f1', 'sound_bad', 3, 3, pg_temp.t() - interval '10 minutes');
select is(jsonb_array_length(private.event_heads_ups(pg_temp.e('f1'), null, pg_temp.t())), 1,
  'at 5 raters a 1-guest tag is still hidden (VC-56 still applies)');

-- ---- 3. Who counts as tonight's raters (2) ----------------------------------
-- f2: 5 ratings tonight, but an admin hid one: only 4 count.
select pg_temp.rate('f2', 1, 5, pg_temp.t() - interval '30 minutes');
select pg_temp.pick('f2', 'lines_long', 1, 2, pg_temp.t() - interval '30 minutes');
update public.ratings set hidden_at = pg_temp.t()
where event_id = pg_temp.e('f2') and user_id = pg_temp.g(5);
select is(private.event_heads_ups(pg_temp.e('f2'), null, pg_temp.t()), '[]'::jsonb,
  'a hidden rating isn''t a rater: 4 visible, so nothing shows');
-- f3: 4 ratings tonight and 1 saved at 4:30 AM (last night): only 4 count.
select pg_temp.rate('f3', 1, 4, pg_temp.t() - interval '30 minutes');
select pg_temp.rate('f3', 5, 5, pg_temp.t() - interval '90 minutes');
select pg_temp.pick('f3', 'lines_long', 1, 2, pg_temp.t() - interval '30 minutes');
select is(private.event_heads_ups(pg_temp.e('f3'), null, pg_temp.t()), '[]'::jsonb,
  'a rating from before 5 AM New York isn''t tonight''s: 4 count, so nothing shows');

-- ---- 4. "Felt unsafe" keeps its stricter bar (1) ----------------------------
-- f4: 5 raters; 2 picked "Felt unsafe" and 2 "Long line".
select pg_temp.rate('f4', 1, 5, pg_temp.t() - interval '30 minutes');
select pg_temp.pick('f4', 'felt_unsafe', 1, 2, pg_temp.t() - interval '30 minutes');
select pg_temp.pick('f4', 'lines_long', 1, 2, pg_temp.t() - interval '30 minutes');
select is(private.event_heads_ups(pg_temp.e('f4'), null, pg_temp.t()),
  '[{"tag": "lines_long", "count": 2, "mine": false}]'::jsonb,
  'at 5 raters, "Felt unsafe" with 2 guests still stays hidden (needs 3, VC-59)');

-- ---- 5. Through the app's own call, and admins (4) --------------------------
-- e0 (live now): 4 raters, guests 1 and 2 picked "Dress code".
select pg_temp.rate('e0', 1, 4, now());
select pg_temp.pick('e0', 'dress_code', 1, 2, now());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25252525-9999-4999-8999-000000000001","role":"authenticated"}', true);
select is(public.get_event_heads_ups(pg_temp.e('e0')), '[]'::jsonb,
  'the event page call: 4 raters tonight, so the guest gets an empty list');
select set_config('request.jwt.claims', '{"sub":"25252525-9999-4999-8999-0000000000a1","role":"authenticated"}', true);
select is((select (x ->> 'votes')::int
           from jsonb_array_elements(public.admin_get_event_tags(pg_temp.e('e0'))) x
           where x ->> 'tag' = 'dress_code'),
  2, 'the admin moderation tag list still sees the count under the 5-rater bar');
reset role;
select pg_temp.rate('e0', 5, 5, now());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25252525-9999-4999-8999-000000000002","role":"authenticated"}', true);
select is(public.get_event_heads_ups(pg_temp.e('e0')),
  '[{"tag": "dress_code", "count": 2, "mine": true}]'::jsonb,
  'the 5th rater: the event page call shows the tag, with "mine"');
select ok(public.get_event_heads_ups(pg_temp.e('e0'))::text !~ '25252525-9999',
  'the answer never holds a guest id');
reset role;

select * from finish();
rollback;
