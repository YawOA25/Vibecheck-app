-- =============================================================================
-- pgTAP test 31: the map's points (VC-79, migration 20261029110000_map_points.sql).
--
-- What it proves:
--   - the function is locked down: security definer, empty search_path, anon
--     can't run it, and the app can't read area_centroids or map_settings;
--   - every area label from the app's list has a centre, all 600 m or more;
--   - with the venue-pin switch OFF (the default): no row ever carries a
--     party's real pin. Every event, including a staff pick WITH a ticket
--     link, comes back as its area's centre ("centroid only");
--   - a free-text area comes back with no coordinates at all (kind 'none');
--   - test events are hidden from plain users, shown to testers and admins;
--   - the date window works exactly like the list's (ends after, optional
--     starts from, starts before);
--   - the vibe word appears only once an event has started;
--   - non-adults and people without a profile are refused (42501);
--   - with the switch ON (flipped only inside this test's transaction): only
--     the staff pick with a ticket link becomes a venue, rounded to 4
--     decimals; house parties and a staff pick without a link stay circles.
--
-- Only this test's own events are looked at (the dev database has others).
-- now() is frozen for the whole transaction, so the window edges are exact.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

-- ---- Setup (as owner) -------------------------------------------------------
insert into auth.users (id, email) values
  ('31313131-0000-4000-8000-000000000001', 'admin31@test.vibecheck.invalid'),
  ('31313131-0000-4000-8000-000000000002', 'plain31@test.vibecheck.invalid'),
  ('31313131-0000-4000-8000-000000000003', 'tester31@test.vibecheck.invalid'),
  ('31313131-0000-4000-8000-000000000004', 'minor31@test.vibecheck.invalid'),
  ('31313131-0000-4000-8000-000000000005', 'noprofile31@test.vibecheck.invalid');

-- …005 deliberately has no profile; …004 is 15 (not an adult).
insert into public.profiles (id, display_name, birthdate, role, is_tester) values
  ('31313131-0000-4000-8000-000000000001', 'Admin', private.age_gate_today() - interval '30 years', 'admin', false),
  ('31313131-0000-4000-8000-000000000002', 'Plain', private.age_gate_today() - interval '30 years', 'user', false),
  ('31313131-0000-4000-8000-000000000003', 'Tester', private.age_gate_today() - interval '30 years', 'user', true),
  ('31313131-0000-4000-8000-000000000004', 'Minor', private.age_gate_today() - interval '15 years', 'user', false);

-- The events:
--   e1 house party in Shaw, started an hour ago, with a published vibe
--   e2 staff pick WITH a ticket link at Navy Yard, starts in an hour
--   e3 staff pick WITHOUT a ticket link in Clarendon, starts in 2 hours
--   e4 test event in Shaw, starts in an hour
--   e5 free-text area, started 30 minutes ago, nobody has rated
--   e6 house party in Shaw, 10 days away (outside a 7-night window)
--   e7 house party in Shaw, started, only 3 raters (too few for a word)
insert into public.events (id, title, area_label, starts_at, ends_at, source, ticket_url, is_test) values
  ('31313131-eeee-4000-8000-000000000001', 'Shaw kickback', 'Shaw, DC',
   now() - interval '1 hour', now() + interval '3 hours', 'host', null, false),
  ('31313131-eeee-4000-8000-000000000002', 'Rooftop Sundown', 'Navy Yard, DC',
   now() + interval '1 hour', now() + interval '5 hours', 'staff_pick',
   'https://www.eventbrite.com/e/rooftop-sundown-31', false),
  ('31313131-eeee-4000-8000-000000000003', 'Clarendon pick', 'Clarendon, VA',
   now() + interval '2 hours', now() + interval '6 hours', 'staff_pick', null, false),
  ('31313131-eeee-4000-8000-000000000004', 'Tester night', 'Shaw, DC',
   now() + interval '1 hour', now() + interval '5 hours', 'host', null, true),
  ('31313131-eeee-4000-8000-000000000005', 'Somewhere party', 'Behind the old mill, DC',
   now() - interval '30 minutes', now() + interval '4 hours', 'host', null, false),
  ('31313131-eeee-4000-8000-000000000006', 'Far away party', 'Shaw, DC',
   now() + interval '10 days', now() + interval '10 days 4 hours', 'host', null, false),
  ('31313131-eeee-4000-8000-000000000007', 'Early party', 'Shaw, DC',
   now() - interval '20 minutes', now() + interval '4 hours', 'host', null, false);

-- The real pins: deliberately NOT the area centres, so a leak would show.
insert into public.event_private (event_id, lat, lng, check_in_code) values
  ('31313131-eeee-4000-8000-000000000001', 38.915123, -77.019876, 'AAAAA1'),
  ('31313131-eeee-4000-8000-000000000002', 38.877049, -77.004061, 'AAAAA2'),
  ('31313131-eeee-4000-8000-000000000003', 38.886001, -77.094002, 'AAAAA3'),
  ('31313131-eeee-4000-8000-000000000004', 38.913333, -77.023333, 'AAAAA4'),
  ('31313131-eeee-4000-8000-000000000005', 38.950001, -77.050001, 'AAAAA5'),
  ('31313131-eeee-4000-8000-000000000006', 38.911111, -77.022222, 'AAAAA6'),
  ('31313131-eeee-4000-8000-000000000007', 38.914444, -77.024444, 'AAAAA7');

-- Published vibes: e1 has a score (a word), e7 only 3 raters ('Early'), and
-- e2 has one too even though it hasn't started (it must NOT show).
insert into private.vibe_snapshots (event_id, published_at, scored_at, raters, score) values
  ('31313131-eeee-4000-8000-000000000001', now(), now(), 6, 8.5),
  ('31313131-eeee-4000-8000-000000000002', now(), now(), 6, 8.5),
  ('31313131-eeee-4000-8000-000000000007', now(), now(), 3, null);

-- The windows used below (as the app would send them):
--   week:  ends after now, starts before now + 7 days (no "starts from")
--   later: starts from now + 90 minutes (only e3 among the near events)
create temp table w (name text primary key, ends_after timestamptz,
                     starts_from timestamptz, starts_before timestamptz);
insert into w values
  ('week',  now(), null, now() + interval '7 days'),
  ('later', now(), now() + interval '90 minutes', now() + interval '7 days'),
  ('far',   now(), null, now() + interval '11 days');
grant select on w to authenticated;

-- A copy of the centres, readable in the test as a signed-in user (the real
-- table is locked away from the app, which this test also proves).
create temp table cent as select * from public.area_centroids;
grant select on cent to authenticated;
-- The word a score of 8.5 gets (worked out here, as the owner, because the
-- helper is locked away from signed-in users).
create temp table expect as select private.vibe_label(8.5) as word;
grant select on expect to authenticated;

-- A shortcut: this test's rows from get_map_points for one named window.
create function pg_temp.pts(p_window text)
returns setof record language sql as $$
  select m.event_id, m.kind, m.lat, m.lng, m.radius_m, m.has_started, m.is_live, m.vibe_word
  from w, public.get_map_points(w.ends_after, w.starts_from, w.starts_before) m
  where w.name = p_window and m.event_id::text like '31313131-%'
$$;

-- ---- Lock-down --------------------------------------------------------------
select ok(
  (select prosecdef from pg_proc
   where oid = 'public.get_map_points(timestamptz, timestamptz, timestamptz)'::regprocedure),
  'get_map_points is security definer');

select ok(
  (select proconfig @> array['search_path=""'] from pg_proc
   where oid = 'public.get_map_points(timestamptz, timestamptz, timestamptz)'::regprocedure),
  'get_map_points has an empty search_path');

select ok(not has_function_privilege('anon',
    'public.get_map_points(timestamptz, timestamptz, timestamptz)', 'execute'),
  'anon can''t run get_map_points');

select ok(has_function_privilege('authenticated',
    'public.get_map_points(timestamptz, timestamptz, timestamptz)', 'execute'),
  'signed-in users can run get_map_points');

-- Neither app role holds ANY table right on the two map tables (the full
-- list, as in test 001: truncate, references and trigger would leak too).
-- area_centroids is not meant to be readable: only get_map_points reads it.
select ok(not has_table_privilege('anon', 'public.area_centroids',
  'select,insert,update,delete,truncate,references,trigger'),
  'anon has no rights on area_centroids');
select ok(not has_table_privilege('authenticated', 'public.area_centroids',
  'select,insert,update,delete,truncate,references,trigger'),
  'authenticated has no rights on area_centroids');
select ok(not has_table_privilege('anon', 'private.map_settings',
  'select,insert,update,delete,truncate,references,trigger'),
  'anon has no rights on map_settings (the venue-pin switch)');
select ok(not has_table_privilege('authenticated', 'private.map_settings',
  'select,insert,update,delete,truncate,references,trigger'),
  'authenticated has no rights on map_settings (the venue-pin switch)');

select is((select staff_pick_pins from private.map_settings), false,
  'the venue-pin switch is OFF by default');

-- ---- The centre table -------------------------------------------------------
select is((select count(*)::int from public.area_centroids), 51,
  'all 51 area labels have a centre (DMV, Baltimore and Richmond)');

select is((select count(*)::int from public.area_centroids where radius_m < 600), 0,
  'no circle is smaller than 600 m');

select ok(exists (select 1 from public.area_centroids where label = 'Fells Point, MD')
          and exists (select 1 from public.area_centroids where label = 'Scott''s Addition, VA'),
  'Baltimore and Richmond labels are in the table');

-- ---- Anon is refused ----------------------------------------------------------
set local role anon;
select throws_ok(
  $$ select * from public.get_map_points(now(), null, now() + interval '7 days') $$,
  '42501', null, 'anon is refused');
reset role;

-- ---- Plain adult, switch OFF ---------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"31313131-0000-4000-8000-000000000002","role":"authenticated"}', true);

-- No path returns pin coordinates: no row's point matches ANY real pin of
-- this test's events, even within 4 decimals (the venue rounding).
select is(
  (select count(*)::int
   from pg_temp.pts('week') as p(event_id uuid, kind text, lat float8, lng float8,
        radius_m int, has_started bool, is_live bool, vibe_word text)
   join (select * from (values
          (38.915123::float8, -77.019876::float8), (38.877049, -77.004061),
          (38.886001, -77.094002), (38.913333, -77.023333), (38.950001, -77.050001),
          (38.911111, -77.022222), (38.914444, -77.024444)) v(lat, lng)) pin
     on round(p.lat::numeric, 3) = round(pin.lat::numeric, 3)
    and round(p.lng::numeric, 3) = round(pin.lng::numeric, 3)),
  0, 'no row carries (or nearly carries) a real pin while the switch is off');

-- Centroid only: every placed row equals its area's centre and radius.
select is(
  (select count(*)::int
   from pg_temp.pts('week') as p(event_id uuid, kind text, lat float8, lng float8,
        radius_m int, has_started bool, is_live bool, vibe_word text)
   join public.events e on e.id = p.event_id
   left join cent c on c.label = e.area_label
   where p.kind <> 'none'
     and (p.kind <> 'area' or p.lat <> c.lat or p.lng <> c.lng or p.radius_m <> c.radius_m)),
  0, 'every placed row is exactly its area centre and radius (kind area)');

select is(
  (select kind from pg_temp.pts('week') as p(event_id uuid, kind text, lat float8, lng float8,
        radius_m int, has_started bool, is_live bool, vibe_word text)
   where event_id = '31313131-eeee-4000-8000-000000000002'),
  'area', 'a staff pick WITH a ticket link is still an area circle while the switch is off');

select row_eq(
  $$ select kind, lat, lng, radius_m
     from pg_temp.pts('week') as p(event_id uuid, kind text, lat float8, lng float8,
          radius_m int, has_started bool, is_live bool, vibe_word text)
     where event_id = '31313131-eeee-4000-8000-000000000005' $$,
  row('none'::text, null::float8, null::float8, null::int),
  'a free-text area comes back with no coordinates (kind none)');

-- Test events hidden from plain users.
select is(
  (select count(*)::int from pg_temp.pts('week') as p(event_id uuid, kind text, lat float8,
        lng float8, radius_m int, has_started bool, is_live bool, vibe_word text)
   where event_id = '31313131-eeee-4000-8000-000000000004'),
  0, 'a plain user never gets the test event');

-- Window filtering.
select results_eq(
  $$ select event_id from pg_temp.pts('week') as p(event_id uuid, kind text, lat float8,
        lng float8, radius_m int, has_started bool, is_live bool, vibe_word text)
     order by event_id $$,
  array['31313131-eeee-4000-8000-000000000001'::uuid, '31313131-eeee-4000-8000-000000000002',
        '31313131-eeee-4000-8000-000000000003', '31313131-eeee-4000-8000-000000000005',
        '31313131-eeee-4000-8000-000000000007'],
  'the week window has the near events, not the one 10 days away');

select results_eq(
  $$ select event_id from pg_temp.pts('later') as p(event_id uuid, kind text, lat float8,
        lng float8, radius_m int, has_started bool, is_live bool, vibe_word text) $$,
  array['31313131-eeee-4000-8000-000000000003'::uuid],
  'a "starts from" edge drops the events starting earlier');

select is(
  (select count(*)::int from pg_temp.pts('far') as p(event_id uuid, kind text, lat float8,
        lng float8, radius_m int, has_started bool, is_live bool, vibe_word text)
   where event_id = '31313131-eeee-4000-8000-000000000006'),
  1, 'a wider window reaches the event 10 days away');

-- The vibe word: only after the start.
select is(
  (select vibe_word from pg_temp.pts('week') as p(event_id uuid, kind text, lat float8,
        lng float8, radius_m int, has_started bool, is_live bool, vibe_word text)
   where event_id = '31313131-eeee-4000-8000-000000000001'),
  (select word from expect), 'a started event with a published score gets its word');

select ok(
  (select vibe_word is null and not has_started and not is_live
   from pg_temp.pts('week') as p(event_id uuid, kind text, lat float8,
        lng float8, radius_m int, has_started bool, is_live bool, vibe_word text)
   where event_id = '31313131-eeee-4000-8000-000000000002'),
  'a not-started event gets no word, even with a published score');

select is(
  (select vibe_word from pg_temp.pts('week') as p(event_id uuid, kind text, lat float8,
        lng float8, radius_m int, has_started bool, is_live bool, vibe_word text)
   where event_id = '31313131-eeee-4000-8000-000000000007'),
  'Early', 'a started event with too few raters reads Early');

select ok(
  (select vibe_word is null and has_started and is_live
   from pg_temp.pts('week') as p(event_id uuid, kind text, lat float8,
        lng float8, radius_m int, has_started bool, is_live bool, vibe_word text)
   where event_id = '31313131-eeee-4000-8000-000000000005'),
  'a started event nobody rated is live with no word');

select throws_ok(
  $$ select * from public.get_map_points(null, null, now()) $$,
  '22023', null, 'a missing window edge is refused');

-- ---- Tester and admin see the test event ------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"31313131-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(
  (select kind from pg_temp.pts('week') as p(event_id uuid, kind text, lat float8,
        lng float8, radius_m int, has_started bool, is_live bool, vibe_word text)
   where event_id = '31313131-eeee-4000-8000-000000000004'),
  'area', 'a tester gets the test event, as an area circle');

select set_config('request.jwt.claims',
  '{"sub":"31313131-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select count(*)::int from pg_temp.pts('week') as p(event_id uuid, kind text, lat float8,
        lng float8, radius_m int, has_started bool, is_live bool, vibe_word text)
   where event_id = '31313131-eeee-4000-8000-000000000004'),
  1, 'an admin gets the test event');

-- ---- Non-adults are refused -----------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"31313131-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.get_map_points(now(), null, now() + interval '7 days') $$,
  '42501', null, 'a minor is refused');

select set_config('request.jwt.claims',
  '{"sub":"31313131-0000-4000-8000-000000000005","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.get_map_points(now(), null, now() + interval '7 days') $$,
  '42501', null, 'a user without a profile is refused');

-- ---- Switch ON (inside this transaction only; rolled back at the end) --------
reset role;
update private.map_settings set staff_pick_pins = true;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"31313131-0000-4000-8000-000000000002","role":"authenticated"}', true);

select row_eq(
  $$ select kind, lat, lng, radius_m
     from pg_temp.pts('week') as p(event_id uuid, kind text, lat float8, lng float8,
          radius_m int, has_started bool, is_live bool, vibe_word text)
     where event_id = '31313131-eeee-4000-8000-000000000002' $$,
  row('venue'::text, 38.877::float8, -77.0041::float8, null::int),
  'switch on: the staff pick with a ticket link is a venue, rounded to 4 decimals');

select is(
  (select count(*)::int from pg_temp.pts('week') as p(event_id uuid, kind text, lat float8,
        lng float8, radius_m int, has_started bool, is_live bool, vibe_word text)
   where kind = 'venue'),
  1, 'switch on: house parties and the staff pick without a link stay area circles');

select * from finish();
rollback;
