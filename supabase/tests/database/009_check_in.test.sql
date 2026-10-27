-- =============================================================================
-- pgTAP test 9: GPS check-in (VC-B06, proposals VC-20 and VC-05).
--
-- What it checks, in plain words:
--   * Who may check in: anon can't call check_in at all; a login with no
--     profile and an under-18 profile are refused; testers alone can use
--     test events (to everyone else a test event "doesn't exist").
--   * Distance: with a 150 m radius and a perfect reading, 149 m passes and
--     151 m fails. The phone's accuracy adds slack, capped at 75 m
--     (224 m passes, 226 m fails); accuracy worse than 300 m is a weak signal.
--   * The window: exactly 30 minutes before the start and exactly 60
--     minutes after the end pass; one second outside fails.
--   * Limits: 20 attempts an hour, then refused (and the refusal isn't
--     counted); attempts older than an hour don't count. 8 different events
--     in 24 hours, then a new one is refused, but a repeat to one of the 8
--     still works.
--   * Repeats are idempotent: one row, first time kept, last check refreshed.
--   * Privacy: no table has a column that could hold coordinates (besides
--     the event's own secret pin), the reading's numbers appear in no row of
--     any table, and check_in never logs.
--
-- How the distances are made: moving straight north by d metres changes the
-- latitude by degrees(d / 6371008.8), the same Earth radius check_in uses,
-- so the distance it computes is d (to a tiny fraction of a metre).
--
-- now() is frozen for the whole test (one transaction), and check_in uses
-- now() too, so "now() + 30 minutes" is exactly the window edge.
-- Everything runs inside BEGIN ... ROLLBACK, so nothing is left behind.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(52);

-- ---- Setup (as owner) -------------------------------------------------------
-- Users: 1 adult, 2 tester, 3 under 18, 4 no profile, 5 hourly-limit,
-- 6 events-limit, 7 window checks.
insert into auth.users (id, email) values
  ('99999999-9999-4999-8999-999999999991', 'adult@test.vibecheck.invalid'),
  ('99999999-9999-4999-8999-999999999992', 'tester@test.vibecheck.invalid'),
  ('99999999-9999-4999-8999-999999999993', 'young@test.vibecheck.invalid'),
  ('99999999-9999-4999-8999-999999999994', 'noprofile@test.vibecheck.invalid'),
  ('99999999-9999-4999-8999-999999999995', 'tries@test.vibecheck.invalid'),
  ('99999999-9999-4999-8999-999999999996', 'busy@test.vibecheck.invalid'),
  ('99999999-9999-4999-8999-999999999997', 'window@test.vibecheck.invalid');

-- Profiles are written directly as the owner (the age gate is tested in
-- files 6 and 7). The under-18 profile is impossible through the app; it
-- stands in for "someone whose profile slipped through", to prove check_in
-- checks age itself.
insert into public.profiles (id, display_name, birthdate, is_tester) values
  ('99999999-9999-4999-8999-999999999991', 'Adult', current_date - interval '30 years', false),
  ('99999999-9999-4999-8999-999999999992', 'Tester', current_date - interval '30 years', true),
  ('99999999-9999-4999-8999-999999999993', 'Young', current_date - interval '17 years', false),
  ('99999999-9999-4999-8999-999999999995', 'Tries', current_date - interval '30 years', false),
  ('99999999-9999-4999-8999-999999999996', 'Busy', current_date - interval '30 years', false),
  ('99999999-9999-4999-8999-999999999997', 'Window', current_date - interval '30 years', false);

-- Events. Ids: …01 open real event, …02 open test event, …11-…14 window
-- edges, …21-…29 the events-limit set. All open ones run 1 hour ago to 3
-- hours from now.
insert into public.events (id, title, area_label, starts_at, ends_at, is_test) values
  ('99999999-0000-4000-8000-000000000001', 'Open party', 'Shaw, DC', now() - interval '1 hour', now() + interval '3 hours', false),
  ('99999999-0000-4000-8000-000000000002', 'Test party', 'Shaw, DC', now() - interval '1 hour', now() + interval '3 hours', true),
  -- Opens exactly now (starts in 30 minutes).
  ('99999999-0000-4000-8000-000000000011', 'Opens now', 'Shaw, DC', now() + interval '30 minutes', now() + interval '4 hours', false),
  -- Opens one second from now.
  ('99999999-0000-4000-8000-000000000012', 'Opens soon', 'Shaw, DC', now() + interval '30 minutes 1 second', now() + interval '4 hours', false),
  -- Closes exactly now (ended 60 minutes ago).
  ('99999999-0000-4000-8000-000000000013', 'Closes now', 'Shaw, DC', now() - interval '5 hours', now() - interval '60 minutes', false),
  -- Closed one second ago.
  ('99999999-0000-4000-8000-000000000014', 'Just closed', 'Shaw, DC', now() - interval '5 hours', now() - interval '60 minutes 1 second', false);
insert into public.events (id, title, area_label, starts_at, ends_at)
select ('99999999-0000-4000-8000-0000000000' || (20 + n)::text)::uuid, 'Crawl stop ' || n, 'Shaw, DC',
       now() - interval '1 hour', now() + interval '3 hours'
from generate_series(1, 9) as n;

-- Every event's secret pin: the same spot, radius 150 m.
insert into public.event_private (event_id, lat, lng, radius_m, check_in_code)
select e.id, 38.9, -77.0, 150, 'ABCDEF' from public.events e
where e.id::text like '99999999-0000-4000-8000-%';

-- ---- 1. Static checks (5) ---------------------------------------------------
select ok(not has_function_privilege('anon',
  'public.check_in(uuid, double precision, double precision, double precision)', 'execute'),
  'anon can''t run check_in');
select ok(has_function_privilege('authenticated',
  'public.check_in(uuid, double precision, double precision, double precision)', 'execute'),
  'signed-in users can call check_in (it checks who they are inside)');
select ok((select prosecdef and proconfig @> array['search_path=""']
           from pg_proc where oid = 'public.check_in(uuid, double precision, double precision, double precision)'::regprocedure),
  'check_in is security definer with an empty search_path');
select ok(not has_function_privilege('authenticated',
  'private.distance_m(double precision, double precision, double precision, double precision)', 'execute'),
  'app users can''t call the distance helper (it would help find a pin)');
select ok((select prosrc !~* 'raise\s+(notice|log|info|debug|warning)'
           from pg_proc where oid = 'public.check_in(uuid, double precision, double precision, double precision)'::regprocedure),
  'check_in never logs anything (so the reading can''t end up in the logs)');

-- ---- 2. Accuracy bands (5) --------------------------------------------------
select is(private.accuracy_bucket(24.9), '0-25m', '24.9 m is in the 0-25m band');
select is(private.accuracy_bucket(25), '25-75m', '25 m is in the 25-75m band');
select is(private.accuracy_bucket(75), '75-300m', '75 m is in the 75-300m band');
select is(private.accuracy_bucket(300), '75-300m', '300 m is still in the 75-300m band');
select is(private.accuracy_bucket(300.1), '300m+', 'over 300 m is in the 300m+ band');

-- ---- 3. anon is refused even with a hand-made call (1) ----------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$ select public.check_in('99999999-0000-4000-8000-000000000001', 38.9, -77.0, 10) $$,
  '42501', null, 'anon can''t check in');

-- ---- 4. No profile and under 18 are refused (2) -----------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999994","role":"authenticated"}', true);
select throws_ok(
  $$ select public.check_in('99999999-0000-4000-8000-000000000001', 38.9, -77.0, 10) $$,
  '42501', null, 'a login without a profile can''t check in');
select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999993","role":"authenticated"}', true);
select throws_ok(
  $$ select public.check_in('99999999-0000-4000-8000-000000000001', 38.9, -77.0, 10) $$,
  '42501', null, 'an under-18 profile can''t check in');

-- ---- 5. Bad readings and unknown events (5) ---------------------------------
select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999991","role":"authenticated"}', true);
select throws_ok(
  $$ select public.check_in('99999999-0000-4000-8000-000000000001', 91, -77.0, 10) $$,
  'VCGPS', null, 'an impossible latitude is refused');
select throws_ok(
  $$ select public.check_in('99999999-0000-4000-8000-000000000001', 38.9, -77.0, -1) $$,
  'VCGPS', null, 'a negative accuracy is refused');
select throws_ok(
  $$ select public.check_in('99999999-0000-4000-8000-000000000001', 38.9, -77.0, null) $$,
  'VCGPS', null, 'a missing accuracy is refused');
select throws_ok(
  $$ select public.check_in('99999999-0000-4000-8000-000000000001', 'NaN'::float8, -77.0, 10) $$,
  'VCGPS', null, 'a "not a number" latitude is refused');
select throws_ok(
  $$ select public.check_in('99999999-0000-4000-8000-0000000000ff', 38.9, -77.0, 10) $$,
  'VCNFD', null, 'an unknown event is refused as not found');

-- ---- 6. Test events: testers only (3) ---------------------------------------
select throws_ok(
  $$ select public.check_in('99999999-0000-4000-8000-000000000002', 38.9, -77.0, 10) $$,
  'VCNFD', 'That event doesn''t exist.', 'a non-tester can''t check in to a test event (it "doesn''t exist")');
select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999992","role":"authenticated"}', true);
select is(public.check_in('99999999-0000-4000-8000-000000000002', 38.9, -77.0, 10) ->> 'status',
  'passed', 'a tester can check in to a test event');
select is(public.check_in('99999999-0000-4000-8000-000000000001', 38.9, -77.0, 10) ->> 'status',
  'passed', 'a tester can check in to a real event too, by GPS like anyone');

-- ---- 7. Distance edges, 150 m radius (8) ------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999991","role":"authenticated"}', true);
-- A perfect reading (accuracy 0): no slack at all.
select is(public.check_in('99999999-0000-4000-8000-000000000001',
  38.9 + degrees(151 / 6371008.8), -77.0, 0) ->> 'status',
  'too_far', '151 m away with a perfect reading is too far');
select is(public.check_in('99999999-0000-4000-8000-000000000001',
  38.9 + degrees(149 / 6371008.8), -77.0, 0) ->> 'status',
  'passed', '149 m away with a perfect reading passes');
-- Accuracy adds slack, capped at 75 m: 150 + 75 = 225 m.
select is(public.check_in('99999999-0000-4000-8000-000000000001',
  38.9 + degrees(224 / 6371008.8), -77.0, 200) ->> 'status',
  'passed', '224 m with 200 m accuracy passes (slack capped at 75 m)');
select is(public.check_in('99999999-0000-4000-8000-000000000001',
  38.9 + degrees(226 / 6371008.8), -77.0, 200) ->> 'status',
  'too_far', '226 m with 200 m accuracy fails: the slack never exceeds 75 m');
select is(public.check_in('99999999-0000-4000-8000-000000000001',
  38.9 + degrees(185 / 6371008.8), -77.0, 30) ->> 'status',
  'too_far', '185 m with 30 m accuracy fails (150 + 30 = 180)');
-- The accuracy cap: 300 m is the worst we still judge; over that is weak.
select is(public.check_in('99999999-0000-4000-8000-000000000001',
  38.9 + degrees(224 / 6371008.8), -77.0, 300) ->> 'status',
  'passed', 'accuracy of exactly 300 m is still judged');
select is(public.check_in('99999999-0000-4000-8000-000000000001', 38.9, -77.0, 300.5) ->> 'status',
  'weak_signal', 'accuracy worse than 300 m is a weak signal, even right on the pin');
select is(public.check_in('99999999-0000-4000-8000-000000000001', 38.9, -77.0, 300.5) - 'status',
  '{}'::jsonb, 'a weak-signal answer carries nothing else (no distance hint)');

-- ---- 8. What gets recorded (4) ----------------------------------------------
reset role;
select is((select count(*)::int from public.check_in_attempts
           where user_id = '99999999-9999-4999-8999-999999999991'),
  8, 'each judged attempt is recorded (bad readings and unknown events are not)');
select is((select array_agg(result || ':' || accuracy_bucket order by id)
           from public.check_in_attempts
           where user_id = '99999999-9999-4999-8999-999999999991'),
  array['too_far:0-25m', 'passed:0-25m', 'passed:75-300m', 'too_far:75-300m', 'too_far:25-75m',
        'passed:75-300m', 'weak_signal:300m+', 'weak_signal:300m+'],
  'attempts keep only the result and an accuracy band');
select is((select method from public.check_ins
           where user_id = '99999999-9999-4999-8999-999999999991'
             and event_id = '99999999-0000-4000-8000-000000000001'),
  'gps', 'a GPS pass creates a check-in with method gps');
-- Pretend the first check-in was 10 minutes ago, for the repeat test below.
update public.check_ins set first_at = now() - interval '10 minutes', last_verified_at = now() - interval '10 minutes'
where user_id = '99999999-9999-4999-8999-999999999991';
select pass('first check-in moved 10 minutes into the past for the repeat test');

-- ---- 9. Repeats are idempotent (4) ------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999991","role":"authenticated"}', true);
-- A reading with distinctive digits (about 14 m from the pin), used again
-- by the privacy checks in section 12.
select set_config('vc.repeat', public.check_in('99999999-0000-4000-8000-000000000001',
  38.9001234, -77.0004321, 12)::text, true);
select is(current_setting('vc.repeat')::jsonb ->> 'already_checked_in', 'true',
  'a repeat check-in passes and says it''s a repeat');
reset role;
select is((select count(*)::int from public.check_ins
           where user_id = '99999999-9999-4999-8999-999999999991'),
  1, 'a repeat leaves one check-in row');
select ok((select first_at = now() - interval '10 minutes' from public.check_ins
           where user_id = '99999999-9999-4999-8999-999999999991'),
  'a repeat keeps the first check-in time');
select ok((select last_verified_at = now() from public.check_ins
           where user_id = '99999999-9999-4999-8999-999999999991'),
  'a repeat refreshes the last check time');

-- ---- 10. The window edges (5) -----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999997","role":"authenticated"}', true);
select is(public.check_in('99999999-0000-4000-8000-000000000011', 38.9, -77.0, 10) ->> 'status',
  'passed', 'exactly 30 minutes before the start passes');
select is(public.check_in('99999999-0000-4000-8000-000000000012', 38.9, -77.0, 10) ->> 'reason',
  'too_early', '30 minutes and 1 second before the start is too early');
select is(public.check_in('99999999-0000-4000-8000-000000000013', 38.9, -77.0, 10) ->> 'status',
  'passed', 'exactly 60 minutes after the end passes');
select is(public.check_in('99999999-0000-4000-8000-000000000014', 38.9, -77.0, 10) ->> 'reason',
  'too_late', '60 minutes and 1 second after the end is too late');
select is((public.check_in('99999999-0000-4000-8000-000000000012', 38.9, -77.0, 10) ->> 'opens_at')::timestamptz,
  now() + interval '1 second', 'a too-early answer says when check-in opens');

-- ---- 11. Limits (8) ---------------------------------------------------------
-- 20 an hour: 19 earlier tries (59 minutes ago), then one more = 20.
-- The 19 are stored as 'weak_signal': the hourly limit counts every kind of
-- try, and 'too_far' rows would trip the separate 5-per-event 'too far' cap
-- (VC-36, tested in file 11) before this limit is reached.
reset role;
insert into public.check_in_attempts (user_id, event_id, result, accuracy_bucket, at)
select '99999999-9999-4999-8999-999999999995', '99999999-0000-4000-8000-000000000001',
       'weak_signal', '300m+', now() - interval '59 minutes'
from generate_series(1, 19);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999995","role":"authenticated"}', true);
select is(public.check_in('99999999-0000-4000-8000-000000000001',
  38.9 + degrees(500 / 6371008.8), -77.0, 10) ->> 'status',
  'too_far', 'the 20th attempt in an hour is still judged');
select is(public.check_in('99999999-0000-4000-8000-000000000001', 38.9, -77.0, 10),
  '{"status": "too_many_attempts", "retry_after_minutes": 1}'::jsonb,
  'the 21st attempt in an hour is refused, with minutes to wait');
reset role;
select is((select count(*)::int from public.check_in_attempts
           where user_id = '99999999-9999-4999-8999-999999999995'),
  20, 'a refused-for-limit call isn''t recorded, so waiting always works');
-- Move every try to 61 minutes ago: they no longer count.
update public.check_in_attempts set at = now() - interval '61 minutes'
where user_id = '99999999-9999-4999-8999-999999999995';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999995","role":"authenticated"}', true);
select is(public.check_in('99999999-0000-4000-8000-000000000001', 38.9, -77.0, 10) ->> 'status',
  'passed', 'attempts older than an hour don''t count');

-- 8 events in 24 hours: check-ins at crawl stops 1-8 an hour ago.
reset role;
insert into public.check_ins (user_id, event_id, method, first_at, last_verified_at)
select '99999999-9999-4999-8999-999999999996', ('99999999-0000-4000-8000-0000000000' || (20 + n)::text)::uuid,
       'gps', now() - interval '1 hour', now() - interval '1 hour'
from generate_series(1, 8) as n;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999996","role":"authenticated"}', true);
select is(public.check_in('99999999-0000-4000-8000-000000000029', 38.9, -77.0, 10),
  '{"status": "too_many_events"}'::jsonb, 'a 9th event in 24 hours is refused');
select is(public.check_in('99999999-0000-4000-8000-000000000021', 38.9, -77.0, 10) ->> 'status',
  'passed', 'a repeat check-in to one of the 8 still works');
-- One of the 8 is now more than 24 hours old: the 9th event is allowed.
reset role;
update public.check_ins set first_at = now() - interval '24 hours 1 second'
where user_id = '99999999-9999-4999-8999-999999999996'
  and event_id = '99999999-0000-4000-8000-000000000022';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999996","role":"authenticated"}', true);
select is(public.check_in('99999999-0000-4000-8000-000000000029', 38.9, -77.0, 10) ->> 'status',
  'passed', 'check-ins older than 24 hours don''t count toward the 8');
select is(public.check_in('99999999-0000-4000-8000-000000000029',
  38.9 + degrees(500 / 6371008.8), -77.0, 10) ->> 'status',
  'too_far', 'a repeat check-in is still judged by distance (no free pass)');

-- ---- 12. No raw coordinates stored anywhere (2) -----------------------------
reset role;
-- (a) The only columns that can hold a fractional number are the event's own
--     secret pin (event_private.lat/lng, admin-set), the rating score, and
--     the published vibe's score and night average (VC-51 totals).
select is_empty(
  $$ select table_schema || '.' || table_name || '.' || column_name
     from information_schema.columns
     where table_schema in ('public', 'private')
       and (data_type in ('double precision', 'real', 'numeric', 'point', 'USER-DEFINED')
            or udt_name in ('geometry', 'geography'))
       and (table_schema, table_name, column_name) not in (
         ('public', 'event_private', 'lat'),
         ('public', 'event_private', 'lng'),
         ('public', 'ratings', 'score'),
         ('private', 'vibe_snapshots', 'score'),
         ('private', 'vibe_snapshots', 'night_average')) $$,
  'no table has a column that could hold a guest''s coordinates');
-- (b) The distinctive reading from section 9 (38.9001234, -77.0004321)
--     appears in no row of any table in public or private. query_to_xml
--     turns a whole table into text so it can be searched.
select is_empty(
  $$ select t.table_schema || '.' || t.table_name
     from information_schema.tables t
     where t.table_schema in ('public', 'private')
       and t.table_type = 'BASE TABLE'
       and query_to_xml(format('select * from %I.%I', t.table_schema, t.table_name),
                        true, false, '')::text ~ '38\.9001|77\.0004' $$,
  'the reading''s numbers were stored in no table');

select * from finish();
rollback;
