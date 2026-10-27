-- =============================================================================
-- pgTAP test 10: party-code check-in and the tester check-in (VC-B07).
--
-- What it checks, in plain words:
--   * Who may use them: anon can't call either; a login with no profile and
--     an under-18 profile are refused; test events "don't exist" for
--     non-testers.
--   * The code: the right code (in any case, with a dash) checks you in
--     with method 'code'; repeats are idempotent; a right code outside the
--     window is refused; a code is refused when the admin hasn't switched
--     it on; text that can't be a code is refused without counting.
--   * The lock: wrong tries count down 4, 3, 2, 1; the 5th wrong code locks
--     entry, even for the right code; the lock is per event; it lifts once
--     the wrong tries are an hour old.
--   * Rotation: after update_event rotates the code, the old one is wrong
--     and the new one works.
--   * Tester check-in: a tester passes on a test event (method 'tester'),
--     is refused on a real event, and still needs the window; a non-tester
--     is refused everywhere.
--   * Privacy: the code is never readable by app users, never in an answer,
--     and a typed code is stored in no table.
--
-- now() is frozen for the whole test (one transaction), and the functions
-- use now() too, so window edges and "an hour ago" are exact.
-- Everything runs inside BEGIN ... ROLLBACK, so nothing is left behind.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(56);

-- ---- Setup (as owner) -------------------------------------------------------
-- Users: …a1 adult, …a2 tester, …a3 under 18, …a4 no profile, …a5 the
-- wrong-code (lock) user, …a6 admin (rotates codes), …a7 rotation guest.
insert into auth.users (id, email) values
  ('aaaaaaaa-9999-4999-8999-0000000000a1', 'code-adult@test.vibecheck.invalid'),
  ('aaaaaaaa-9999-4999-8999-0000000000a2', 'code-tester@test.vibecheck.invalid'),
  ('aaaaaaaa-9999-4999-8999-0000000000a3', 'code-young@test.vibecheck.invalid'),
  ('aaaaaaaa-9999-4999-8999-0000000000a4', 'code-noprofile@test.vibecheck.invalid'),
  ('aaaaaaaa-9999-4999-8999-0000000000a5', 'code-locker@test.vibecheck.invalid'),
  ('aaaaaaaa-9999-4999-8999-0000000000a6', 'code-admin@test.vibecheck.invalid'),
  ('aaaaaaaa-9999-4999-8999-0000000000a7', 'code-rotate@test.vibecheck.invalid');

-- Profiles written directly as the owner (the age gate is tested in files
-- 6 and 7; the under-18 row stands in for "slipped through").
insert into public.profiles (id, display_name, birthdate, is_tester, role) values
  ('aaaaaaaa-9999-4999-8999-0000000000a1', 'Adult', current_date - interval '30 years', false, 'user'),
  ('aaaaaaaa-9999-4999-8999-0000000000a2', 'Tester', current_date - interval '30 years', true, 'user'),
  ('aaaaaaaa-9999-4999-8999-0000000000a3', 'Young', current_date - interval '17 years', false, 'user'),
  ('aaaaaaaa-9999-4999-8999-0000000000a5', 'Locker', current_date - interval '30 years', false, 'user'),
  ('aaaaaaaa-9999-4999-8999-0000000000a6', 'Admin', current_date - interval '30 years', false, 'admin'),
  ('aaaaaaaa-9999-4999-8999-0000000000a7', 'Rotate', current_date - interval '30 years', false, 'user');

-- Events (all with the party code switched on unless noted):
--   …31 open real event          …32 open test event
--   …33 opens in 1h30 (too early) …34 closed 2h ago (too late)
--   …35 open, code switched OFF   …36 open real (lock is per event)
--   …37 open real (rotation)      …38 closed test event (tester window)
insert into public.events (id, title, area_label, starts_at, ends_at, is_test, code_check_in_enabled) values
  ('aaaaaaaa-0000-4000-8000-000000000031', 'Open party', 'Shaw, DC', now() - interval '1 hour', now() + interval '3 hours', false, true),
  ('aaaaaaaa-0000-4000-8000-000000000032', 'Test party', 'Shaw, DC', now() - interval '1 hour', now() + interval '3 hours', true, true),
  ('aaaaaaaa-0000-4000-8000-000000000033', 'Later party', 'Shaw, DC', now() + interval '2 hours', now() + interval '5 hours', false, true),
  ('aaaaaaaa-0000-4000-8000-000000000034', 'Over party', 'Shaw, DC', now() - interval '6 hours', now() - interval '2 hours', false, true),
  ('aaaaaaaa-0000-4000-8000-000000000035', 'No-code party', 'Shaw, DC', now() - interval '1 hour', now() + interval '3 hours', false, false),
  ('aaaaaaaa-0000-4000-8000-000000000036', 'Other party', 'Shaw, DC', now() - interval '1 hour', now() + interval '3 hours', false, true),
  ('aaaaaaaa-0000-4000-8000-000000000037', 'Rotate party', 'Shaw, DC', now() - interval '1 hour', now() + interval '3 hours', false, true),
  ('aaaaaaaa-0000-4000-8000-000000000038', 'Old test party', 'Shaw, DC', now() - interval '6 hours', now() - interval '2 hours', true, true);

-- Every event's secret code is K7MX2Q (pin and radius don't matter here).
insert into public.event_private (event_id, lat, lng, radius_m, check_in_code)
select e.id, 38.9, -77.0, 150, 'K7MX2Q' from public.events e
where e.id::text like 'aaaaaaaa-0000-4000-8000-%';

-- ---- 1. Static checks (8) ---------------------------------------------------
select ok(not has_function_privilege('anon', 'public.check_in_with_code(uuid, text)', 'execute'),
  'anon can''t run check_in_with_code');
select ok(not has_function_privilege('anon', 'public.tester_check_in(uuid)', 'execute'),
  'anon can''t run tester_check_in');
select ok(has_function_privilege('authenticated', 'public.check_in_with_code(uuid, text)', 'execute')
          and has_function_privilege('authenticated', 'public.tester_check_in(uuid)', 'execute'),
  'signed-in users can call both (the checks inside decide the rest)');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'])
           from pg_proc where oid in ('public.check_in_with_code(uuid, text)'::regprocedure,
                                      'public.tester_check_in(uuid)'::regprocedure)),
  'both are security definer with an empty search_path');
select ok(not has_function_privilege('authenticated', 'private.codes_match(text, text)', 'execute'),
  'app users can''t call the comparison helper');
select ok((select bool_and(prosrc !~* 'raise\s+(notice|log|info|debug|warning)')
           from pg_proc where oid in ('public.check_in_with_code(uuid, text)'::regprocedure,
                                      'public.tester_check_in(uuid)'::regprocedure,
                                      'private.codes_match(text, text)'::regprocedure)),
  'none of them logs anything (so a code can''t end up in the logs)');
select ok(private.codes_match('K7MX2Q', 'K7MX2Q'), 'codes_match: the same code matches');
select ok(not private.codes_match('K7MX2R', 'K7MX2Q') and not private.codes_match(null, 'K7MX2Q'),
  'codes_match: a different last letter, or nothing, doesn''t match');

-- ---- 2. anon, no profile, under 18 are refused (4) --------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$ select public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000031', 'K7MX2Q') $$,
  '42501', null, 'anon can''t use the party code');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-9999-4999-8999-0000000000a4","role":"authenticated"}', true);
select throws_ok(
  $$ select public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000031', 'K7MX2Q') $$,
  '42501', null, 'a login without a profile can''t use the party code');
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-9999-4999-8999-0000000000a3","role":"authenticated"}', true);
select throws_ok(
  $$ select public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000031', 'K7MX2Q') $$,
  '42501', null, 'an under-18 profile can''t use the party code');
select throws_ok(
  $$ select public.tester_check_in('aaaaaaaa-0000-4000-8000-000000000032') $$,
  '42501', null, 'an under-18 profile can''t use the tester check-in');

-- ---- 3. Bad input and hidden events (5) -------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-9999-4999-8999-0000000000a1","role":"authenticated"}', true);
select throws_ok(
  $$ select public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000031', 'K7M') $$,
  'VCCOD', null, 'a 3-letter code is refused as "not a code"');
select throws_ok(
  $$ select public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000031', null) $$,
  'VCCOD', null, 'a missing code is refused as "not a code"');
select throws_ok(
  $$ select public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000032', 'K7MX2Q') $$,
  'VCNFD', null, 'a non-tester can''t use a code on a test event (it "doesn''t exist")');
select throws_ok(
  $$ select public.check_in_with_code('aaaaaaaa-0000-4000-8000-0000000000ff', 'K7MX2Q') $$,
  'VCNFD', null, 'an unknown event is refused');
reset role;
select is((select count(*)::int from public.check_in_attempts
           where user_id = 'aaaaaaaa-9999-4999-8999-0000000000a1'),
  0, 'refused input isn''t recorded as a try');

-- ---- 4. Code switched off, and the window (6) -------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-9999-4999-8999-0000000000a1","role":"authenticated"}', true);
select is(public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000035', 'K7MX2Q'),
  '{"status": "code_off"}'::jsonb, 'the code doesn''t work when the admin hasn''t switched it on');
select is(public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000033', 'K7MX2Q') ->> 'reason',
  'too_early', 'the right code before the window opens is refused (too early)');
select is(public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000034', 'K7MX2Q') ->> 'reason',
  'too_late', 'the right code after the window closes is refused (too late)');
select is((public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000033', 'K7MX2Q') ->> 'opens_at')::timestamptz,
  now() + interval '90 minutes', 'the too-early answer says when check-in opens');
reset role;
select is((select count(*)::int from public.check_ins
           where user_id = 'aaaaaaaa-9999-4999-8999-0000000000a1'),
  0, 'no check-in was made outside the window or with the code off');
select is((select count(*)::int from public.check_in_attempts
           where user_id = 'aaaaaaaa-9999-4999-8999-0000000000a1' and result = 'outside_window'),
  3, 'outside-window tries are recorded (they count toward the hourly limit)');

-- ---- 5. The right code in the window, and repeats (6) -----------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-9999-4999-8999-0000000000a1","role":"authenticated"}', true);
select is(public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000031', 'k7m-x2q'),
  jsonb_build_object('status', 'passed', 'first_at', now(), 'already_checked_in', false),
  'the right code in the window checks you in (small letters and a dash are fine)');
select is(public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000031', 'K7MX2Q'),
  jsonb_build_object('status', 'passed', 'first_at', now(), 'already_checked_in', true),
  'typing it again is fine and says you were already in');
select ok(public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000031', 'K7MX2Q')::text !~ 'K7MX2Q',
  'the answer never contains the code');
reset role;
select is((select count(*)::int from public.check_ins
           where user_id = 'aaaaaaaa-9999-4999-8999-0000000000a1'),
  1, 'repeats keep one check-in row');
select row_eq(
  $$ select method, first_at, last_verified_at from public.check_ins
     where user_id = 'aaaaaaaa-9999-4999-8999-0000000000a1' $$,
  row('code'::text, now(), now()),
  'the check-in has method ''code'', like a GPS one but marked as code');
select is((select count(*)::int from public.check_in_attempts
           where user_id = 'aaaaaaaa-9999-4999-8999-0000000000a1'
             and result = 'passed' and accuracy_bucket is null),
  3, 'code passes are recorded with no accuracy band (no GPS used)');

-- ---- 6. Five wrong codes lock entry (9) -------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-9999-4999-8999-0000000000a5","role":"authenticated"}', true);
select is(public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000031', 'QQ9QQ9'),
  '{"status": "wrong_code", "tries_left": 4}'::jsonb, '1st wrong code: 4 tries left');
select is(public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000031', 'QQ9QQ8') ->> 'tries_left',
  '3', '2nd wrong code: 3 tries left');
select is(public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000031', 'QQ9QQ7') ->> 'tries_left',
  '2', '3rd wrong code: 2 tries left');
select is(public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000031', 'QQ9QQ6'),
  '{"status": "wrong_code", "tries_left": 1}'::jsonb, '4th wrong code: 1 try left');
select is(public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000031', 'QQ9QQ5'),
  '{"status": "locked", "retry_after_minutes": 60}'::jsonb,
  'the 5th wrong code locks entry for an hour');
select is(public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000031', 'K7MX2Q'),
  '{"status": "locked", "retry_after_minutes": 60}'::jsonb,
  'while locked, even the right code is refused');
select is(public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000036', 'K7MX2Q') ->> 'status',
  'passed', 'the lock is per event: the right code still works at another party');
reset role;
select is((select count(*)::int from public.check_in_attempts
           where user_id = 'aaaaaaaa-9999-4999-8999-0000000000a5' and result = 'bad_code'),
  5, 'the refused-while-locked try isn''t counted as another wrong code');
-- The cool-down: move the wrong tries to 61 minutes ago; they stop counting.
update public.check_in_attempts set at = now() - interval '61 minutes'
where user_id = 'aaaaaaaa-9999-4999-8999-0000000000a5' and result = 'bad_code';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-9999-4999-8999-0000000000a5","role":"authenticated"}', true);
select is(public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000031', 'K7MX2Q') ->> 'status',
  'passed', 'after an hour the lock lifts and the right code works');

-- ---- 7. Lock countdown: minutes left follow the oldest wrong try (1) -------
reset role;
-- Five wrong tries for the rotation guest at another event, the oldest 45
-- minutes ago: 15 minutes are left.
insert into public.check_in_attempts (user_id, event_id, result, at)
select 'aaaaaaaa-9999-4999-8999-0000000000a7', 'aaaaaaaa-0000-4000-8000-000000000036', 'bad_code',
       now() - (n * interval '9 minutes')
from generate_series(1, 5) as n;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-9999-4999-8999-0000000000a7","role":"authenticated"}', true);
select is(public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000036', 'K7MX2Q'),
  '{"status": "locked", "retry_after_minutes": 15}'::jsonb,
  'the wait is until the oldest wrong try is an hour old');

-- ---- 8. Rotating the code makes the old one wrong (4) -----------------------
reset role;
-- The admin rotates the code with update_event (as in the app). The new
-- code is kept in a temporary table so the guest's test can use it.
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-9999-4999-8999-0000000000a6","role":"authenticated"}', true);
create temporary table rotated as
  select public.update_event('aaaaaaaa-0000-4000-8000-000000000037', p_rotate_code => true)
           ->> 'check_in_code' as code;
grant select on rotated to authenticated;
select isnt((select code from rotated), 'K7MX2Q', 'rotating made a new code');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-9999-4999-8999-0000000000a7","role":"authenticated"}', true);
select is(public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000037', 'K7MX2Q'),
  '{"status": "wrong_code", "tries_left": 4}'::jsonb, 'after rotation the old code is wrong');
select is(public.check_in_with_code('aaaaaaaa-0000-4000-8000-000000000037', (select code from rotated)) ->> 'status',
  'passed', 'after rotation the new code works');
reset role;
select is((select method from public.check_ins
           where user_id = 'aaaaaaaa-9999-4999-8999-0000000000a7'
             and event_id = 'aaaaaaaa-0000-4000-8000-000000000037'),
  'code', 'the rotated-code check-in is a normal code check-in');

-- ---- 9. Tester check-in (8) -------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-9999-4999-8999-0000000000a2","role":"authenticated"}', true);
select is(public.tester_check_in('aaaaaaaa-0000-4000-8000-000000000032'),
  jsonb_build_object('status', 'passed', 'first_at', now(), 'already_checked_in', false),
  'a tester checks in to a test event with no GPS and no code');
select is(public.tester_check_in('aaaaaaaa-0000-4000-8000-000000000032') ->> 'already_checked_in',
  'true', 'a repeat tester check-in is fine');
select throws_ok(
  $$ select public.tester_check_in('aaaaaaaa-0000-4000-8000-000000000031') $$,
  'VCOVR', null, 'a tester can''t use the override on a real event');
select is(public.tester_check_in('aaaaaaaa-0000-4000-8000-000000000038') ->> 'reason',
  'too_late', 'the tester check-in still needs the event window');
reset role;
select row_eq(
  $$ select method from public.check_ins
     where user_id = 'aaaaaaaa-9999-4999-8999-0000000000a2' $$,
  row('tester'::text),
  'the tester check-in is marked ''tester'', and only on the test event');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-9999-4999-8999-0000000000a1","role":"authenticated"}', true);
select throws_ok(
  $$ select public.tester_check_in('aaaaaaaa-0000-4000-8000-000000000032') $$,
  '42501', null, 'a non-tester can''t use the override on a test event');
select throws_ok(
  $$ select public.tester_check_in('aaaaaaaa-0000-4000-8000-000000000031') $$,
  '42501', null, 'a non-tester can''t use the override on a real event');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$ select public.tester_check_in('aaaaaaaa-0000-4000-8000-000000000032') $$,
  '42501', null, 'anon can''t use the override');

-- ---- 10. The code is never readable by app users (5) ------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-9999-4999-8999-0000000000a1","role":"authenticated"}', true);
select throws_ok($$ select check_in_code from public.event_private $$,
  '42501', null, 'a guest can''t read the party code');
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-9999-4999-8999-0000000000a2","role":"authenticated"}', true);
select throws_ok($$ select check_in_code from public.event_private $$,
  '42501', null, 'a tester can''t read the party code');
reset role;
select ok(not has_table_privilege('authenticated', 'public.event_private', 'select')
          and not has_table_privilege('anon', 'public.event_private', 'select'),
  'no app role has any read right on event_private');
-- The wrong codes typed in section 6 (QQ9QQ...) are in no row of any table.
select is_empty(
  $$ select t.table_schema || '.' || t.table_name
     from information_schema.tables t
     where t.table_schema in ('public', 'private')
       and t.table_type = 'BASE TABLE'
       and query_to_xml(format('select * from %I.%I', t.table_schema, t.table_name),
                        true, false, '')::text ~ 'QQ9QQ' $$,
  'typed codes were stored in no table');
select is_empty(
  $$ select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'check_in_attempts'
       and column_name ~* 'code' $$,
  'check_in_attempts has no column for a typed code');

select * from finish();
rollback;
