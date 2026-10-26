-- =============================================================================
-- pgTAP test 3: the secret tables, event_private and check_in_attempts (VC-B02).
--
-- What it checks: NOBODY using the app can read or write them, not even an
-- admin tester, and not a visitor who isn't signed in. Only server functions
-- (running as the owner) may use these tables. This protects house-party
-- locations and check-in history (VC-20).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- ---- Setup (as owner): an admin who is also a tester, one event ------------
-- We use the most powerful app user on purpose: if even they can't read the
-- secret tables, nobody can.
insert into auth.users (id, email) values
  ('33333333-3333-4333-8333-333333333333', 'admin@test.vibecheck.invalid');
insert into public.profiles (id, display_name, birthdate, role, is_tester) values
  ('33333333-3333-4333-8333-333333333333', 'Admin', '1990-01-01', 'admin', true);

insert into public.events (id, title, area_label, starts_at, ends_at, is_test) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Secret test', 'Shaw, DC',
   now(), now() + interval '4 hours', true);
insert into public.event_private (event_id, lat, lng, check_in_code) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 38.91, -77.02, 'ABC123');
insert into public.check_in_attempts (user_id, event_id, result, accuracy_bucket) values
  ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-0000-4000-8000-000000000001',
   'too_far', '25-75m');

-- ---- Act as the admin tester ------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);

select throws_ok($$ select * from public.event_private $$,
  '42501', null, 'Even an admin can''t read event_private');
select throws_ok($$ select lat, lng from public.event_private $$,
  '42501', null, 'Even an admin can''t read event coordinates');
select throws_ok(
  $$ insert into public.event_private (event_id, lat, lng, check_in_code)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 1, 1, 'ZZZ999') $$,
  '42501', null, 'App users can''t write event_private');
select throws_ok($$ update public.event_private set check_in_code = 'HACKED' $$,
  '42501', null, 'App users can''t change the party code');
select throws_ok($$ select * from public.check_in_attempts $$,
  '42501', null, 'App users can''t read check_in_attempts');
select throws_ok(
  $$ insert into public.check_in_attempts (user_id, event_id, result)
     values ('33333333-3333-4333-8333-333333333333',
             'aaaaaaaa-0000-4000-8000-000000000001', 'passed') $$,
  '42501', null, 'App users can''t write check_in_attempts');
select throws_ok($$ delete from public.check_in_attempts $$,
  '42501', null, 'App users can''t delete their failed attempts (to dodge limits)');

-- ---- Not signed in (anon) ---------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok($$ select * from public.event_private $$,
  '42501', null, 'anon can''t read event_private');
select throws_ok($$ select * from public.check_in_attempts $$,
  '42501', null, 'anon can''t read check_in_attempts');

reset role;
select * from finish();
rollback;
