-- =============================================================================
-- pgTAP test 11: the "too far" cap on GPS check-in (proposal VC-36).
--
-- What it checks, in plain words:
--   * check_in keeps its safety settings after being replaced (definer,
--     empty search_path, anon can't call it, never logs).
--   * The 1st to 5th "too far" answers for one event are still "too far".
--   * The 6th try is 'gps_locked', even from the exact pin with a perfect
--     reading, and even with a weak signal: the answer is the same wherever
--     the phone is, so it leaks nothing. Nothing extra is in the answer.
--   * The locked try isn't recorded as an attempt and doesn't check anyone in.
--   * The party code still works after the lock.
--   * The lock lasts the whole event, not a rolling hour: moving the 5
--     "too far" rows to 3 hours ago doesn't lift it.
--   * Another event (same person) and another person (same event) are
--     unaffected; other kinds of failed tries (weak signal, wrong code, too
--     early) don't count toward the cap.
--   * App users still can't read check_in_attempts (where the count lives).
--
-- How the distances are made (same as file 9): moving north by d metres
-- changes the latitude by degrees(d / 6371008.8), so 500 m north is
-- 38.9 + degrees(500 / 6371008.8), far outside the 150 m radius.
-- Everything runs inside BEGIN ... ROLLBACK, so nothing is left behind.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- ---- Setup (as owner) -------------------------------------------------------
-- Users: …b1 the one who gets locked, …b2 another guest at the same event,
-- …b3 a guest with many failed tries of OTHER kinds.
insert into auth.users (id, email) values
  ('bbbbbbbb-9999-4999-8999-0000000000b1', 'cap-locked@test.vibecheck.invalid'),
  ('bbbbbbbb-9999-4999-8999-0000000000b2', 'cap-other@test.vibecheck.invalid'),
  ('bbbbbbbb-9999-4999-8999-0000000000b3', 'cap-mixed@test.vibecheck.invalid');
insert into public.profiles (id, display_name, birthdate, is_tester, role) values
  ('bbbbbbbb-9999-4999-8999-0000000000b1', 'Locked', current_date - interval '30 years', false, 'user'),
  ('bbbbbbbb-9999-4999-8999-0000000000b2', 'Other', current_date - interval '30 years', false, 'user'),
  ('bbbbbbbb-9999-4999-8999-0000000000b3', 'Mixed', current_date - interval '30 years', false, 'user');

-- Events: …c1 the main party, …c2 another party the same night. Both open
-- (started an hour ago, end in 3 hours) with the party code switched on.
insert into public.events (id, title, area_label, starts_at, ends_at, is_test, code_check_in_enabled) values
  ('bbbbbbbb-0000-4000-8000-0000000000c1', 'House party', 'Shaw, DC', now() - interval '1 hour', now() + interval '3 hours', false, true),
  ('bbbbbbbb-0000-4000-8000-0000000000c2', 'Other party', 'Shaw, DC', now() - interval '1 hour', now() + interval '3 hours', false, true);
-- Both secret pins: the same spot, radius 150 m, code K7MX2Q.
insert into public.event_private (event_id, lat, lng, radius_m, check_in_code)
select e.id, 38.9, -77.0, 150, 'K7MX2Q' from public.events e
where e.id::text like 'bbbbbbbb-0000-4000-8000-%';

-- ---- 1. check_in is still locked down after the replace (3) -----------------
select ok(not has_function_privilege('anon',
            'public.check_in(uuid, double precision, double precision, double precision)', 'execute')
          and has_function_privilege('authenticated',
            'public.check_in(uuid, double precision, double precision, double precision)', 'execute'),
  'check_in: anon still can''t call it; signed-in users still can');
select ok((select prosecdef and proconfig @> array['search_path=""']
           from pg_proc where oid = 'public.check_in(uuid, double precision, double precision, double precision)'::regprocedure),
  'check_in is still security definer with an empty search_path');
select ok((select prosrc !~* 'raise\s+(notice|log|info|debug|warning)'
           from pg_proc where oid = 'public.check_in(uuid, double precision, double precision, double precision)'::regprocedure),
  'check_in still never logs anything');

-- ---- 2. Five "too far" answers, then the lock (8) ---------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-9999-4999-8999-0000000000b1","role":"authenticated"}', true);
select is(public.check_in('bbbbbbbb-0000-4000-8000-0000000000c1',
  38.9 + degrees(500 / 6371008.8), -77.0, 10) ->> 'status', 'too_far', '1st try 500 m away: too far');
select is(public.check_in('bbbbbbbb-0000-4000-8000-0000000000c1',
  38.9 + degrees(400 / 6371008.8), -77.0, 10) ->> 'status', 'too_far', '2nd try 400 m away: too far');
select is(public.check_in('bbbbbbbb-0000-4000-8000-0000000000c1',
  38.9, -77.0 + 0.01, 10) ->> 'status', 'too_far', '3rd try east of the pin: too far');
select is(public.check_in('bbbbbbbb-0000-4000-8000-0000000000c1',
  38.9 - degrees(300 / 6371008.8), -77.0, 10) ->> 'status', 'too_far', '4th try 300 m south: too far');
select is(public.check_in('bbbbbbbb-0000-4000-8000-0000000000c1',
  38.9 + degrees(250 / 6371008.8), -77.0, 10) ->> 'status', 'too_far',
  'the 5th "too far" still answers too far');
-- The 6th try is from the exact pin with a perfect reading: still refused.
-- `is(jsonb, jsonb)` compares the whole answer, so no extra hint can hide in it.
select is(public.check_in('bbbbbbbb-0000-4000-8000-0000000000c1', 38.9, -77.0, 5),
  '{"status": "gps_locked"}'::jsonb,
  'the 6th try is gps_locked even from inside the radius, with nothing else in the answer');
select is(public.check_in('bbbbbbbb-0000-4000-8000-0000000000c1', 38.9, -77.0, 500),
  '{"status": "gps_locked"}'::jsonb,
  'a weak-signal reading also gets gps_locked (the answer never depends on the reading)');
select is(public.check_in('bbbbbbbb-0000-4000-8000-0000000000c1',
  38.9 + degrees(500 / 6371008.8), -77.0, 10),
  '{"status": "gps_locked"}'::jsonb,
  'a far-away reading gets the very same answer');

-- ---- 3. Locked tries are not recorded and check nobody in (2) ---------------
reset role;
select is((select count(*)::int from public.check_in_attempts
           where user_id = 'bbbbbbbb-9999-4999-8999-0000000000b1'),
  5, 'only the 5 judged tries are recorded; locked tries are not');
select is_empty(
  $$ select 1 from public.check_ins
     where user_id = 'bbbbbbbb-9999-4999-8999-0000000000b1' $$,
  'the locked tries checked nobody in');

-- ---- 4. The party code still works, and the lock stays (3) ------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-9999-4999-8999-0000000000b1","role":"authenticated"}', true);
select is(public.check_in_with_code('bbbbbbbb-0000-4000-8000-0000000000c1', 'K7MX2Q') ->> 'status',
  'passed', 'the party code still checks a GPS-locked guest in');
select is(public.check_in('bbbbbbbb-0000-4000-8000-0000000000c1', 38.9, -77.0, 5) ->> 'status',
  'gps_locked', 'GPS stays locked for this event even after the code worked');
-- Whole event, not a rolling hour: push the 5 "too far" rows 3 hours back.
reset role;
update public.check_in_attempts set at = now() - interval '3 hours'
where user_id = 'bbbbbbbb-9999-4999-8999-0000000000b1' and result = 'too_far';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-9999-4999-8999-0000000000b1","role":"authenticated"}', true);
select is(public.check_in('bbbbbbbb-0000-4000-8000-0000000000c1', 38.9, -77.0, 5) ->> 'status',
  'gps_locked', 'the lock lasts the whole event: 3-hour-old "too far" answers still count');

-- ---- 5. Other events and other people are unaffected (2) --------------------
select is(public.check_in('bbbbbbbb-0000-4000-8000-0000000000c2', 38.9, -77.0, 5) ->> 'status',
  'passed', 'the same guest can still use GPS at another event');
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-9999-4999-8999-0000000000b2","role":"authenticated"}', true);
select is(public.check_in('bbbbbbbb-0000-4000-8000-0000000000c1', 38.9, -77.0, 5) ->> 'status',
  'passed', 'another guest at the same event can still use GPS');

-- ---- 6. Only "too far" answers count toward the cap (1) ---------------------
-- 12 failed tries of other kinds (weak signal, wrong code, too early) plus
-- 4 "too far": still under the cap, so a good reading passes.
reset role;
-- (The uuid casts are needed because a union of plain text can't fill uuid columns.)
insert into public.check_in_attempts (user_id, event_id, result, accuracy_bucket)
select 'bbbbbbbb-9999-4999-8999-0000000000b3'::uuid, 'bbbbbbbb-0000-4000-8000-0000000000c1'::uuid,
       r.result, r.bucket
from (values ('weak_signal', '300m+'), ('bad_code', null), ('outside_window', '0-25m'), ('weak_signal', '75-300m'))
       as r(result, bucket)
     cross join generate_series(1, 3) -- 4 kinds x 3 = 12 rows (well under the hourly 20)
union all
select 'bbbbbbbb-9999-4999-8999-0000000000b3'::uuid, 'bbbbbbbb-0000-4000-8000-0000000000c1'::uuid,
       'too_far', '0-25m'
from generate_series(1, 4);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-9999-4999-8999-0000000000b3","role":"authenticated"}', true);
select is(public.check_in('bbbbbbbb-0000-4000-8000-0000000000c1', 38.9, -77.0, 5) ->> 'status',
  'passed', 'weak-signal, wrong-code and too-early tries don''t count toward the cap');

-- ---- 7. App users still can't read the attempt counts (1) -------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-9999-4999-8999-0000000000b1","role":"authenticated"}', true);
select throws_ok($$ select count(*) from public.check_in_attempts $$,
  '42501', null, 'a guest can''t read check_in_attempts (so can''t see the cap''s count)');

select * from finish();
rollback;
