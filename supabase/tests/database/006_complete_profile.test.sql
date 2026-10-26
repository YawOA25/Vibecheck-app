-- =============================================================================
-- pgTAP test 6: the 18+ gate and complete_profile (VC-B03).
--
-- What it checks, in plain words:
-- * The age rule on fixed dates: exactly 18 today passes, 17 years and 364
--   days fails, and leap-day birthdays turn 18 on 1 March in non-leap years.
-- * complete_profile, called the way the app calls it: an adult gets a
--   profile; an under-18 gets an error and NO profile (so they still can't
--   see events), even when they skip the app and send the request by hand.
-- * Bad input is refused with clear codes, a second call can't overwrite the
--   birthdate, and only signed-in users may run the function at all.
--
-- How "acting as a user" works: see 002_profiles.test.sql. Everything is
-- rolled back at the end, so no test data is left behind.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(35);

-- ---- 1. The age rule on fixed dates (8 checks) -----------------------------
-- These call the pure helper with a fixed "today", so they give the same
-- answer whatever day the tests run.
select is(private.is_at_least_18('2008-10-26', '2026-10-26'), true,
  '18th birthday today: passes');
select is(private.is_at_least_18('2008-10-27', '2026-10-26'), false,
  '17 years and 364 days: fails');
select is(private.is_at_least_18('1990-01-01', '2026-10-26'), true,
  'clearly an adult: passes');
select is(private.is_at_least_18('2008-02-29', '2026-02-28'), false,
  'leap-day baby is still 17 on 28 Feb of a non-leap year');
select is(private.is_at_least_18('2008-02-29', '2026-03-01'), true,
  'leap-day baby turns 18 on 1 March of a non-leap year');
select is(private.is_at_least_18('2010-02-28', '2028-02-29'), true,
  'born 28 Feb: 18 on 29 Feb of a leap year (birthday has passed)');
select is(private.is_at_least_18('2010-03-01', '2028-02-29'), false,
  'born 1 March: still 17 on 29 Feb of a leap year');
select is(private.is_at_least_18(null, '2026-10-26'), false,
  'a missing birthdate counts as "no"');

-- ---- 2. "Today" is the New York date (1 check) ------------------------------
select is(private.age_gate_today(), (now() at time zone 'America/New_York')::date,
  'the gate counts from today''s date in New York');

-- ---- Setup (as the database owner) -----------------------------------------
-- Four logins with no profiles yet, the state right after the email code.
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'adult@test.vibecheck.invalid'),
  ('a0000000-0000-4000-8000-000000000002', 'just18@test.vibecheck.invalid'),
  ('a0000000-0000-4000-8000-000000000003', 'minor@test.vibecheck.invalid'),
  ('a0000000-0000-4000-8000-000000000004', 'typos@test.vibecheck.invalid');

-- The birthdates that sit right on the line depend on today's date. App users
-- can't run private.age_gate_today(), so we work them out now, as the owner,
-- and put them in a temporary table the test user is allowed to read.
create temporary table gate_dates on commit drop as
select
  (private.age_gate_today() - interval '18 years')::date               as turns_18_today,
  (private.age_gate_today() - interval '18 years' + interval '1 day')::date as one_day_short,
  (private.age_gate_today() + interval '1 day')::date                   as tomorrow;
grant select on gate_dates to authenticated;

-- ---- 3. An adult completes their profile (4 checks) ------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$ select public.complete_profile('  Ava  ', '1995-05-05') $$,
  'an adult can complete their profile');

-- The user reads back their own row, naming columns (birthdate isn't readable).
select results_eq(
  $$ select display_name, role, is_tester from public.profiles
     where id = 'a0000000-0000-4000-8000-000000000001' $$,
  $$ values ('Ava'::text, 'user'::text, false) $$,
  'the name is trimmed, role is user, and tester is off');

select is(private.is_adult_user(), true,
  'with a profile, the adult now counts as an adult user (can see events)');

-- A second call must not overwrite the birthdate (for example to a younger one).
select throws_ok(
  $$ select public.complete_profile('Ava', '2015-01-01') $$,
  'VCDUP', 'Your profile is already set up.',
  'a second call is refused, so the birthdate can''t be changed');

-- ---- 4. Exactly 18 today passes (2 checks) ----------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$ select public.complete_profile('Jay', (select turns_18_today from gate_dates)) $$,
  'someone whose 18th birthday is today (New York) passes');

select is(private.is_adult_user(), true,
  'the 18-today user counts as an adult user');

-- ---- 5. Under 18 is refused and leaves no profile (5 checks) ---------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select throws_ok(
  $$ select public.complete_profile('Min', (select one_day_short from gate_dates)) $$,
  'VCA18', 'VibeCheck is for people 18 and older.',
  '17 years and 364 days is refused');

-- "Even if the app is bypassed": a hand-made request with a clearly young
-- birthdate gets the same answer.
select throws_ok(
  $$ select public.complete_profile('Min', '2015-06-01') $$,
  'VCA18', 'VibeCheck is for people 18 and older.',
  'a hand-made request for an 11-year-old is refused');

select is_empty(
  $$ select id from public.profiles where id = 'a0000000-0000-4000-8000-000000000003' $$,
  'the refused user has no profile');

select is(private.is_adult_user(), false,
  'the refused user still doesn''t count as an adult user (can''t see events)');

select is_empty(
  $$ select id from public.events $$,
  'the refused user sees no events');

-- ---- 6. Bad input is refused (6 checks) -------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);

select throws_ok(
  $$ select public.complete_profile('   ', '1995-05-05') $$,
  'VCNAM', null, 'a name of only spaces is refused');

select throws_ok(
  $$ select public.complete_profile(repeat('x', 41), '1995-05-05') $$,
  'VCNAM', null, 'a 41-character name is refused');

select throws_ok(
  $$ select public.complete_profile(null, '1995-05-05') $$,
  'VCNAM', null, 'a missing name is refused');

select throws_ok(
  $$ select public.complete_profile('Tia', (select tomorrow from gate_dates)) $$,
  'VCDOB', null, 'a birthdate in the future is refused');

select throws_ok(
  $$ select public.complete_profile('Tia', '1899-12-31') $$,
  'VCDOB', null, 'a birthdate before 1900 is refused');

select throws_ok(
  $$ select public.complete_profile('Tia', null) $$,
  'VCDOB', null, 'a missing birthdate is refused');

-- ---- 7. Only signed-in users can run it (3 checks) -------------------------
-- A token with no user id (no "sub") must not create anything.
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(
  $$ select public.complete_profile('Ghost', '1995-05-05') $$,
  '42501', 'You need to sign in first.',
  'a request with no user id is refused');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$ select public.complete_profile('Anon', '1995-05-05') $$,
  '42501', null, 'a not-signed-in visitor can''t run complete_profile');

reset role;
select is(
  (select count(*)::int from public.profiles
   where id in ('a0000000-0000-4000-8000-000000000003',
                'a0000000-0000-4000-8000-000000000004')),
  0, 'none of the refused calls left a profile behind');

-- ---- 8. Who may run what (6 checks) ----------------------------------------
select ok(not has_function_privilege('anon', 'public.complete_profile(text, date)', 'execute'),
  'anon can''t run complete_profile');
select ok(has_function_privilege('authenticated', 'public.complete_profile(text, date)', 'execute'),
  'authenticated can run complete_profile');
select ok(not has_function_privilege('authenticated', 'private.is_at_least_18(date, date)', 'execute'),
  'app users can''t call the age helper directly');
select ok(not has_function_privilege('authenticated', 'private.age_gate_today()', 'execute'),
  'app users can''t call the gate-date helper directly');
select is(
  (select prosecdef from pg_proc where oid = 'public.complete_profile(text, date)'::regprocedure),
  true, 'complete_profile runs with the owner''s rights (security definer)');
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc
   where oid = 'public.complete_profile(text, date)'::regprocedure),
  'complete_profile has an empty search_path');

select * from finish();
rollback;
