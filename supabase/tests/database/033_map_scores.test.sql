-- =============================================================================
-- pgTAP test 33: the map's published score (VC-83 Batch 1, migration
-- 20261029130000_map_scores.sql).
--
-- What it proves:
--   - the recreated get_map_points is still locked down: security definer,
--     empty search_path, anon and PUBLIC can't run it, signed-in users can,
--     and anon is refused even if it tries;
--   - its columns are exactly the old ones plus vibe_score and vibe_stale:
--     no rater count and no headcount ever reach the map;
--   - the score gates: null before the start (even with a published score),
--     null with no snapshot, with 0 raters, with 1 rater and with 4 raters
--     (the floor of 5); the snapshot's score rounded to 1 decimal for 'live'
--     and 'stale'; vibe_stale true only for 'stale';
--   - a new rating changes nothing until a new snapshot is published;
--   - the staff-pick pin switch is still OFF, every row is an area centre
--     (no real pin leaks), and the app still has no rights on event_private;
--   - test events stay hidden from plain users (testers get them).
--
-- Only this test's own events are looked at (the dev database has others).
-- now() is frozen for the whole transaction, so "started" is exact.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(33);

-- ---- Setup (as owner) -------------------------------------------------------
insert into auth.users (id, email) values
  ('33333333-0000-4000-8000-000000000001', 'plain33@test.vibecheck.invalid'),
  ('33333333-0000-4000-8000-000000000002', 'tester33@test.vibecheck.invalid'),
  ('33333333-0000-4000-8000-000000000003', 'rater33@test.vibecheck.invalid');

insert into public.profiles (id, display_name, birthdate, role, is_tester) values
  ('33333333-0000-4000-8000-000000000001', 'Plain', private.age_gate_today() - interval '30 years', 'user', false),
  ('33333333-0000-4000-8000-000000000002', 'Tester', private.age_gate_today() - interval '30 years', 'user', true),
  ('33333333-0000-4000-8000-000000000003', 'Rater', private.age_gate_today() - interval '30 years', 'user', false);

-- The events (all in mapped areas, so every one is an area circle):
--   …01 started, live snapshot, 6 raters, score 8.43   -> 8.4, not stale
--   …02 started, stale snapshot (2 h old), 7 raters, 6.04 -> 6.0, stale
--   …03 started, snapshot with 4 raters                 -> no score ('Early')
--   …04 started, snapshot with 1 rater                  -> no score
--   …05 started, snapshot with 0 raters                 -> no score
--   …06 started, no snapshot at all                     -> no score
--   …07 NOT started, snapshot with 6 raters, 9.1        -> no score
--   …08 test event, started, live snapshot, 7.26        -> testers: 7.3
--   …09 staff pick WITH a ticket link, started, live    -> still an area
insert into public.events (id, title, area_label, starts_at, ends_at, source, ticket_url, is_test) values
  ('33333333-eeee-4000-8000-000000000001', 'Live party', 'Shaw, DC',
   now() - interval '1 hour', now() + interval '3 hours', 'host', null, false),
  ('33333333-eeee-4000-8000-000000000002', 'Stale party', 'Petworth, DC',
   now() - interval '3 hours', now() + interval '2 hours', 'host', null, false),
  ('33333333-eeee-4000-8000-000000000003', 'Four raters', 'Shaw, DC',
   now() - interval '1 hour', now() + interval '3 hours', 'host', null, false),
  ('33333333-eeee-4000-8000-000000000004', 'One rater', 'U Street, DC',
   now() - interval '1 hour', now() + interval '3 hours', 'host', null, false),
  ('33333333-eeee-4000-8000-000000000005', 'Zero raters', 'U Street, DC',
   now() - interval '1 hour', now() + interval '3 hours', 'host', null, false),
  ('33333333-eeee-4000-8000-000000000006', 'Nobody rated', 'Navy Yard, DC',
   now() - interval '30 minutes', now() + interval '3 hours', 'host', null, false),
  ('33333333-eeee-4000-8000-000000000007', 'Later party', 'Navy Yard, DC',
   now() + interval '2 hours', now() + interval '6 hours', 'host', null, false),
  ('33333333-eeee-4000-8000-000000000008', 'Tester night', 'Shaw, DC',
   now() - interval '1 hour', now() + interval '3 hours', 'host', null, true),
  ('33333333-eeee-4000-8000-000000000009', 'Rooftop pick', 'Navy Yard, DC',
   now() - interval '1 hour', now() + interval '3 hours', 'staff_pick',
   'https://www.eventbrite.com/e/rooftop-pick-33', false);

-- Real pins, deliberately NOT the area centres, so a leak would show.
insert into public.event_private (event_id, lat, lng, check_in_code) values
  ('33333333-eeee-4000-8000-000000000001', 38.915123, -77.019876, 'BBBBB1'),
  ('33333333-eeee-4000-8000-000000000009', 38.877049, -77.004061, 'BBBBB9');

-- The published snapshots (written by hand, as publish_event_vibe would).
insert into private.vibe_snapshots (event_id, published_at, scored_at, raters, score) values
  ('33333333-eeee-4000-8000-000000000001', now(), now(), 6, 8.43),
  ('33333333-eeee-4000-8000-000000000002', now() - interval '2 hours', now() - interval '2 hours', 7, 6.04),
  ('33333333-eeee-4000-8000-000000000003', now(), now(), 4, 6.5),
  ('33333333-eeee-4000-8000-000000000004', now(), now(), 1, 9.0),
  ('33333333-eeee-4000-8000-000000000005', now(), now(), 0, null),
  ('33333333-eeee-4000-8000-000000000007', now(), now(), 6, 9.1),
  ('33333333-eeee-4000-8000-000000000008', now(), now(), 6, 7.26),
  ('33333333-eeee-4000-8000-000000000009', now(), now(), 6, 9.1);

-- One event's map row for the caller (a week-wide window around now).
create function pg_temp.m(p_id uuid)
returns table (kind text, lat float8, lng float8, has_started boolean,
               vibe_word text, vibe_score numeric, vibe_stale boolean)
language sql as $$
  select m.kind, m.lat, m.lng, m.has_started, m.vibe_word, m.vibe_score, m.vibe_stale
  from public.get_map_points(now() - interval '1 day', null, now() + interval '7 days') m
  where m.event_id = p_id
$$;

-- All of this test's rows for the caller.
create function pg_temp.mine()
returns table (event_id uuid, kind text, lat float8, lng float8)
language sql as $$
  select m.event_id, m.kind, m.lat, m.lng
  from public.get_map_points(now() - interval '1 day', null, now() + interval '7 days') m
  where m.event_id::text like '33333333-%'
$$;

-- ---- Lock-down --------------------------------------------------------------
select ok(
  (select prosecdef from pg_proc
   where oid = 'public.get_map_points(timestamptz, timestamptz, timestamptz)'::regprocedure),
  'get_map_points is still security definer');

select ok(
  (select proconfig @> array['search_path=""'] from pg_proc
   where oid = 'public.get_map_points(timestamptz, timestamptz, timestamptz)'::regprocedure),
  'get_map_points still has an empty search_path');

select ok(not has_function_privilege('anon',
    'public.get_map_points(timestamptz, timestamptz, timestamptz)', 'execute'),
  'anon can''t run get_map_points after the recreate');

-- PUBLIC (every role) must hold no grant of its own: grantee 0 is PUBLIC.
select ok(not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.get_map_points(timestamptz, timestamptz, timestamptz)'::regprocedure
      and a.grantee = 0),
  'PUBLIC holds no execute grant on get_map_points');

select ok(has_function_privilege('authenticated',
    'public.get_map_points(timestamptz, timestamptz, timestamptz)', 'execute'),
  'signed-in users can run get_map_points');

-- Exactly one version of the function (no stray overload left behind).
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'get_map_points'),
  1, 'only one get_map_points exists');

-- The full column list: the old ones plus vibe_score and vibe_stale. No
-- raters, no here (headcount), no night numbers.
select is(
  (select proargnames from pg_proc
   where oid = 'public.get_map_points(timestamptz, timestamptz, timestamptz)'::regprocedure),
  array['p_ends_after', 'p_starts_from', 'p_starts_before',
        'event_id', 'title', 'area_label', 'starts_at', 'ends_at', 'source', 'is_test',
        'kind', 'lat', 'lng', 'radius_m', 'has_started', 'is_live',
        'vibe_word', 'vibe_score', 'vibe_stale']::text[],
  'the map gets exactly these columns (no rater count, no headcount)');

-- The pin switch and the private table, unchanged.
select is((select staff_pick_pins from private.map_settings), false,
  'the staff-pick pin switch is still OFF');

select ok(not has_table_privilege('anon', 'public.event_private',
  'select,insert,update,delete,truncate,references,trigger'),
  'anon still has no rights on event_private');
select ok(not has_table_privilege('authenticated', 'public.event_private',
  'select,insert,update,delete,truncate,references,trigger'),
  'authenticated still has no rights on event_private');

-- ---- Anon is refused ----------------------------------------------------------
set local role anon;
select throws_ok(
  $$ select * from public.get_map_points(now(), null, now() + interval '7 days') $$,
  '42501', null, 'anon is refused');
reset role;

-- ---- Plain adult --------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33333333-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- Live: the snapshot's score, rounded to 1 decimal, not stale.
select is((select vibe_score from pg_temp.m('33333333-eeee-4000-8000-000000000001')),
  8.4::numeric, 'a live published score comes back rounded to 1 decimal (8.43 -> 8.4)');
select is((select vibe_stale from pg_temp.m('33333333-eeee-4000-8000-000000000001')),
  false, 'a live score is not stale');
select is((select vibe_word from pg_temp.m('33333333-eeee-4000-8000-000000000001')),
  'Hot', 'the word still comes with it (from the same snapshot)');

-- Stale: still the score, flagged stale.
select is((select vibe_score from pg_temp.m('33333333-eeee-4000-8000-000000000002')),
  6.0::numeric, 'a stale published score still comes back (6.04 -> 6.0)');
select is((select vibe_stale from pg_temp.m('33333333-eeee-4000-8000-000000000002')),
  true, 'a stale score is flagged stale');

-- Under the floor of 5 raters, or no snapshot: no number.
select ok((select vibe_score is null and not vibe_stale and vibe_word = 'Early'
           from pg_temp.m('33333333-eeee-4000-8000-000000000003')),
  '4 raters: no score (floor of 5), word Early');
select ok((select vibe_score is null and not vibe_stale
           from pg_temp.m('33333333-eeee-4000-8000-000000000004')),
  '1 rater: no score');
select ok((select vibe_score is null and not vibe_stale and vibe_word is null
           from pg_temp.m('33333333-eeee-4000-8000-000000000005')),
  '0 raters in the snapshot: no score, no word');
select ok((select vibe_score is null and not vibe_stale and vibe_word is null and has_started
           from pg_temp.m('33333333-eeee-4000-8000-000000000006')),
  'started with no snapshot: no score, no word');

-- Before the start: nothing about ratings, even with a published score.
select ok((select vibe_score is null and not vibe_stale and vibe_word is null and not has_started
           from pg_temp.m('33333333-eeee-4000-8000-000000000007')),
  'not started: no score, even with a published one');

-- Pins: the switch is off, so the staff pick with a ticket link is an area,
-- and no row of this test carries (or nearly carries) a real pin.
select is((select kind from pg_temp.m('33333333-eeee-4000-8000-000000000009')),
  'area', 'a started staff pick with a ticket link is still an area circle');
select is((select vibe_score from pg_temp.m('33333333-eeee-4000-8000-000000000009')),
  9.1::numeric, 'and it still gets its published score');
select is(
  (select count(*)::int from pg_temp.mine() p
   join (values (38.915123::float8, -77.019876::float8), (38.877049, -77.004061)) pin(lat, lng)
     on round(p.lat::numeric, 3) = round(pin.lat::numeric, 3)
    and round(p.lng::numeric, 3) = round(pin.lng::numeric, 3)),
  0, 'no row carries a real pin');
select is((select count(*)::int from pg_temp.mine() where kind <> 'area'),
  0, 'every row is an area circle while the switch is off');

-- Test events stay hidden from plain users.
select is((select count(*)::int from pg_temp.m('33333333-eeee-4000-8000-000000000008')),
  0, 'a plain user never gets the test event');

-- ---- A new rating changes nothing until a publish -------------------------------
reset role;
-- A new person rates the live party (all Fire = 10). No publish happens.
insert into public.ratings (user_id, event_id, crowd, music, energy)
values ('33333333-0000-4000-8000-000000000003', '33333333-eeee-4000-8000-000000000001', 3, 3, 3);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33333333-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select vibe_score from pg_temp.m('33333333-eeee-4000-8000-000000000001')),
  8.4::numeric, 'one new rating does not change the map score before a publish');

-- Now a new snapshot is published (as publish_event_vibe would).
reset role;
update private.vibe_snapshots set raters = 7, score = 8.91, published_at = now(), scored_at = now()
where event_id = '33333333-eeee-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33333333-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select vibe_score from pg_temp.m('33333333-eeee-4000-8000-000000000001')),
  8.9::numeric, 'after a publish the map shows the new score');
select is((select vibe_word from pg_temp.m('33333333-eeee-4000-8000-000000000001')),
  'Fire', 'and the new word, from the same snapshot');

-- ---- Tester sees the test event, with its score ---------------------------------
select set_config('request.jwt.claims',
  '{"sub":"33333333-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from pg_temp.m('33333333-eeee-4000-8000-000000000008')),
  1, 'a tester gets the test event');
select is((select vibe_score from pg_temp.m('33333333-eeee-4000-8000-000000000008')),
  7.3::numeric, 'with its published score (7.26 -> 7.3)');
select is((select kind from pg_temp.m('33333333-eeee-4000-8000-000000000008')),
  'area', 'as an area circle');

-- ---- Missing window edge still refused -------------------------------------------
select throws_ok(
  $$ select * from public.get_map_points(null, null, now()) $$,
  '22023', null, 'a missing window edge is still refused');

select * from finish();
rollback;
