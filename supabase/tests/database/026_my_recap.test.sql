-- =============================================================================
-- pgTAP test 26: the next-morning recap and Nights out (VC-B12), migration
-- 20261028100000_my_recap.sql.
--
-- What it checks, in plain words:
--   * Locked down: both functions are security definer with an empty
--     search_path; anon can't call get_my_recap; the app can't call the
--     private core (it would choose its own moment).
--   * The 36-hour window: a rating saved exactly 36 hours before is out,
--     one saved a minute later is in; Nights out (p_all) has both, plus an
--     older night.
--   * Hidden ratings are excluded from both lists; so is a test event for a
--     guest who isn't a tester; and a rating saved after the pinned moment.
--   * Only the caller's own ratings: guest 2's answer holds guest 2's events
--     only, and no answer holds a user id.
--   * Privacy: each item's vibe IS the published snapshot (equal to
--     private.published_vibe at the same moment), never a fresh number: a
--     rating added after the publish doesn't show. 'early' hides the score,
--     the reactions and the night; the night is a word only.
--   * The real app call: a rating from an hour ago appears in get_my_recap();
--     a signed-in person with no profile gets 42501.
--
-- The fixed clock: "the morning after" is Saturday 10 Oct 2026, 11 AM New
-- York (EDT, -04), no daylight-saving change nearby. Everything runs inside
-- BEGIN ... ROLLBACK: nothing is kept.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

-- ---- Setup (as owner) -------------------------------------------------------
-- Guest 1 (the one we follow), guest 2, and six bystanders (03-08).
insert into auth.users (id, email)
select ('26262626-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'recap-' || n || '@test.vibecheck.invalid'
from generate_series(1, 8) n;
insert into public.profiles (id, display_name, birthdate, is_tester, role)
select ('26262626-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'Recap ' || n, current_date - interval '30 years', false, 'user'
from generate_series(1, 8) n;
-- Signed in, but never finished the profile (no row in profiles).
insert into auth.users (id, email) values
  ('26262626-9999-4999-8999-0000000000f0', 'recap-noprofile@test.vibecheck.invalid');

-- The events (New York times):
--   a1 A  Fri 9 Oct 10 PM   live night (6 raters), guest 1 rated at 11 PM
--   a2 B  Fri 9 Oct 11 PM   early (3 raters), guest 1 rated at 1 AM
--   a3 C  Wed 7 Oct 10 PM   an older night, guest 1 rated Wed 11 PM
--   a4 D  Fri 9 Oct 9 PM    guest 1's rating was hidden by an admin
--   a5 E  Fri 9 Oct 8 PM    a TEST event (guest 1 isn't a tester)
--   a6 F  Thu 8 Oct 9 PM    guest 1 rated exactly 36 hours before 11 AM Sat
--   a7 G  Thu 8 Oct 10 PM   guest 1 rated 36 hours minus 1 minute before
--   a8 H  on now            guest 1 rated an hour ago (the real-clock call)
insert into public.events (id, title, area_label, starts_at, ends_at, is_test) values
  ('26262626-0000-4000-8000-0000000000a1', 'Recap A', 'Shaw, DC', '2026-10-09 22:00-04', '2026-10-10 03:00-04', false),
  ('26262626-0000-4000-8000-0000000000a2', 'Recap B', 'Shaw, DC', '2026-10-09 23:00-04', '2026-10-10 03:00-04', false),
  ('26262626-0000-4000-8000-0000000000a3', 'Recap C', 'Shaw, DC', '2026-10-07 22:00-04', '2026-10-08 02:00-04', false),
  ('26262626-0000-4000-8000-0000000000a4', 'Recap D', 'Shaw, DC', '2026-10-09 21:00-04', '2026-10-10 02:00-04', false),
  ('26262626-0000-4000-8000-0000000000a5', 'Recap E', 'Shaw, DC', '2026-10-09 20:00-04', '2026-10-10 02:00-04', true),
  ('26262626-0000-4000-8000-0000000000a6', 'Recap F', 'Shaw, DC', '2026-10-08 21:00-04', '2026-10-09 02:00-04', false),
  ('26262626-0000-4000-8000-0000000000a7', 'Recap G', 'Shaw, DC', '2026-10-08 22:00-04', '2026-10-09 02:00-04', false),
  ('26262626-0000-4000-8000-0000000000a8', 'Recap H', 'Shaw, DC', now() - interval '2 hours', now() + interval '2 hours', false);

-- A test-only helper to add one rating directly (as owner).
create function pg_temp.rate(p_guest integer, p_event text, p_crowd integer, p_music integer,
                             p_energy integer, p_reaction text, p_at timestamptz)
returns void
language sql
as $$
  /* Guest number p_guest rates event …p_event (crowd, music, energy 1-3, an
     optional reaction) as saved at the moment p_at. Returns nothing. */
  insert into public.ratings (user_id, event_id, crowd, music, energy, reaction, created_at, updated_at)
  values (('26262626-9999-4999-8999-0000000000' || lpad(p_guest::text, 2, '0'))::uuid,
          ('26262626-0000-4000-8000-0000000000' || p_event)::uuid,
          p_crowd, p_music, p_energy, p_reaction, p_at, p_at);
$$;

-- A: guest 1 all Fire with a fire reaction at 11 PM; guest 2 and bystanders
-- 3-6 all Good at midnight (four dance, one fire). 6 raters: live.
select pg_temp.rate(1, 'a1', 3, 3, 3, 'fire', '2026-10-09 23:00-04');
select pg_temp.rate(2, 'a1', 2, 2, 2, 'dancing', '2026-10-10 00:00-04');
select pg_temp.rate(3, 'a1', 2, 2, 2, 'dancing', '2026-10-10 00:00-04');
select pg_temp.rate(4, 'a1', 2, 2, 2, 'dancing', '2026-10-10 00:00-04');
select pg_temp.rate(5, 'a1', 2, 2, 2, 'dancing', '2026-10-10 00:00-04');
select pg_temp.rate(6, 'a1', 2, 2, 2, 'fire', '2026-10-10 00:00-04');
-- B: guest 1 at 1 AM plus two bystanders: 3 raters, early.
select pg_temp.rate(1, 'a2', 1, 2, 1, null, '2026-10-10 01:00-04');
select pg_temp.rate(3, 'a2', 3, 3, 3, null, '2026-10-10 01:00-04');
select pg_temp.rate(4, 'a2', 3, 3, 3, null, '2026-10-10 01:00-04');
-- C, D, E, F, G: guest 1 alone.
select pg_temp.rate(1, 'a3', 2, 2, 2, null, '2026-10-07 23:00-04');
select pg_temp.rate(1, 'a4', 2, 2, 2, null, '2026-10-09 23:30-04');
update public.ratings set hidden_at = '2026-10-10 00:30-04'
where event_id = '26262626-0000-4000-8000-0000000000a4';
select pg_temp.rate(1, 'a5', 2, 2, 2, null, '2026-10-09 21:00-04');
select pg_temp.rate(1, 'a6', 2, 2, 2, null, '2026-10-08 23:00-04');
select pg_temp.rate(1, 'a7', 2, 2, 2, null, '2026-10-08 23:01-04');
-- H: guest 1 an hour ago, real clock.
select pg_temp.rate(1, 'a8', 3, 2, 3, null, now() - interval '1 hour');
-- Guest 2 also rated G (so guest 2's list has A and G).
select pg_temp.rate(2, 'a7', 1, 1, 1, null, '2026-10-08 23:30-04');

-- Publish A and B at their newest rating.
select private.publish_event_vibe('26262626-0000-4000-8000-0000000000a1', '2026-10-10 00:00-04');
select private.publish_event_vibe('26262626-0000-4000-8000-0000000000a2', '2026-10-10 01:00-04');
-- A 7th rating on A AFTER the publish (never published): the recap must not see it.
select pg_temp.rate(7, 'a1', 1, 1, 1, 'dead', '2026-10-10 00:30-04');

-- Read as guest 1 (auth.uid() comes from these claims). The core runs as
-- owner here because the app is not allowed to call it.
select set_config('request.jwt.claims', '{"sub":"26262626-9999-4999-8999-000000000001","role":"authenticated"}', true);
create temp table recent as
  select private.my_recap('2026-10-10 11:00-04', false) as v;
create temp table every_night as
  select private.my_recap('2026-10-10 11:00-04', true) as v;

-- ---- 1. Locked down (3) -----------------------------------------------------
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'])
           from pg_proc where oid in (
             'private.my_recap(timestamptz, boolean)'::regprocedure,
             'public.get_my_recap(boolean)'::regprocedure)),
  'both recap functions are security definer with an empty search_path');
select ok(not has_function_privilege('anon', 'public.get_my_recap(boolean)', 'execute')
          and has_function_privilege('authenticated', 'public.get_my_recap(boolean)', 'execute'),
  'anon can''t call get_my_recap; signed-in people can');
select ok(not has_function_privilege('anon', 'private.my_recap(timestamptz, boolean)', 'execute')
          and not has_function_privilege('authenticated', 'private.my_recap(timestamptz, boolean)', 'execute'),
  'the app can''t call the private core (it would pick its own moment)');

-- ---- 2. The 36-hour window (4) ----------------------------------------------
select is((select array_agg(i ->> 'title' order by ord) from recent,
                  jsonb_array_elements(v) with ordinality x(i, ord)),
  array['Recap B', 'Recap A', 'Recap G'],
  'morning recap: the events rated in the last 36 hours, newest event first');
select ok((select not (v::text like '%Recap F%') from recent),
  '36-hour edge: a rating saved exactly 36 hours before is out');
select ok((select v::text like '%Recap G%' from recent),
  '36-hour edge: a rating saved 36 hours minus 1 minute before is in');
select is((select array_agg(i ->> 'title' order by ord) from every_night,
                  jsonb_array_elements(v) with ordinality x(i, ord)),
  array['Recap B', 'Recap A', 'Recap G', 'Recap F', 'Recap C'],
  'Nights out (p_all): both edge ratings and the older night too, newest first');

-- ---- 3. Left out (3) --------------------------------------------------------
select ok((select not (r.v::text like '%Recap D%') and not (e.v::text like '%Recap D%')
           from recent r, every_night e),
  'hidden: a rating an admin hid is in neither list');
select ok((select not (e.v::text like '%Recap E%') from every_night e),
  'a test event is left out for a guest who isn''t a tester');
select ok((select not (e.v::text like '%Recap H%') from every_night e),
  'a rating saved after the pinned moment is left out');

-- ---- 4. Only your own (2) ---------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"26262626-9999-4999-8999-000000000002","role":"authenticated"}', true);
select is((select array_agg(i ->> 'title' order by ord)
           from jsonb_array_elements(private.my_recap('2026-10-10 11:00-04', true)) with ordinality x(i, ord)),
  array['Recap A', 'Recap G'],
  'guest 2 sees only guest 2''s rated events');
select set_config('request.jwt.claims', '{"sub":"26262626-9999-4999-8999-000000000001","role":"authenticated"}', true);
select ok((select e.v::text !~ '26262626-9999' from every_night e),
  'no answer holds a user id');

-- ---- 5. Privacy: the published snapshot, nothing fresh (6) ------------------
select is((select i -> 'vibe' from recent, jsonb_array_elements(v) i where i ->> 'title' = 'Recap A'),
  private.published_vibe('26262626-0000-4000-8000-0000000000a1', '2026-10-10 11:00-04'),
  'the vibe is exactly the published snapshot the event page shows');
select is((select (i -> 'vibe' ->> 'raters')::int from recent, jsonb_array_elements(v) i where i ->> 'title' = 'Recap A'),
  6, 'never a fresh count: the 7th rating, added after the publish, doesn''t show');
select is((select i -> 'mine' from recent, jsonb_array_elements(v) i where i ->> 'title' = 'Recap A'),
  '{"crowd": 3, "music": 3, "energy": 3, "reaction": "fire", "label": "Fire"}'::jsonb,
  'mine: the guest''s own three rows, reaction and word');
select is((select i -> 'vibe' -> 'night' from recent, jsonb_array_elements(v) i where i ->> 'title' = 'Recap A'),
  jsonb_build_object('label', 'Good', 'raters', 6, 'over', true,
    'breakdown', private.published_vibe('26262626-0000-4000-8000-0000000000a1', '2026-10-10 11:00-04') -> 'night' -> 'breakdown'),
  'the final night is a word only (no number), and over by the morning');
select is((select (i -> 'vibe' -> 'reactions') -> 0 from recent, jsonb_array_elements(v) i where i ->> 'title' = 'Recap A'),
  '{"reaction": "dancing", "count": 4}'::jsonb,
  'the top reaction comes from the published tally (the unpublished dead isn''t there)');
select is((select jsonb_build_array(i -> 'vibe' ->> 'state', i -> 'vibe' -> 'score', i -> 'vibe' -> 'reactions',
                                    i -> 'vibe' -> 'night', i -> 'vibe' -> 'night_average')
           from recent, jsonb_array_elements(v) i where i ->> 'title' = 'Recap B'),
  '["early", null, [], null, null]'::jsonb,
  'when the snapshot hides the score (early), the recap hides it too: no score, tally or night');

-- ---- 6. The real app call (3) -----------------------------------------------
set local role authenticated;
select is((select array_agg(i ->> 'title') from jsonb_array_elements(public.get_my_recap()) i),
  array['Recap H'],
  'get_my_recap(): the rating from an hour ago, nothing older than 36 hours');
select is(jsonb_array_length(public.get_my_recap(true)), 6,
  'get_my_recap(true): every visible, unhidden night (A, B, C, F, G, H)');
select set_config('request.jwt.claims', '{"sub":"26262626-9999-4999-8999-0000000000f0","role":"authenticated"}', true);
select throws_ok('select public.get_my_recap()', '42501', null,
  'a signed-in person with no profile is refused (42501)');
reset role;

select * from finish();
rollback;
