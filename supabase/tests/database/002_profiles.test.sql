-- =============================================================================
-- pgTAP test 2: profiles (VC-B02).
--
-- What it checks: user A can read and rename only their own profile; A can't
-- read or change B's profile; nobody can make themselves an admin or tester,
-- or change their birthdate or id, even if a wrong grant is added later (the
-- trigger backstop); A can't read even their own birthdate column; the server
-- (database owner) can still mark someone as a tester; and a not-signed-in
-- visitor can't read profiles.
--
-- How "acting as a user" works: `set local role authenticated` switches to the
-- app's signed-in role, and `request.jwt.claims` holds the user id that
-- Supabase's auth.uid() reads. `reset role` switches back to the test owner.
-- All of it is rolled back at the end.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

-- ---- Setup (as the database owner): two adult users, A and B ---------------
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'a@test.vibecheck.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'b@test.vibecheck.invalid');

insert into public.profiles (id, display_name, birthdate) values
  ('11111111-1111-4111-8111-111111111111', 'Ava', '1995-05-05'),
  ('22222222-2222-4222-8222-222222222222', 'Bea', '1996-06-06');

-- ---- Act as user A ----------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select results_eq(
  $$ select id from public.profiles $$,
  array['11111111-1111-4111-8111-111111111111'::uuid],
  'A sees exactly one profile: their own');

select is_empty(
  $$ select 1 from public.profiles where id = '22222222-2222-4222-8222-222222222222' $$,
  'A can''t read B''s profile');

-- Read access is granted per column and birthdate is left out, so even A's own
-- birthdate can't be read by the app.
select throws_ok(
  $$ select birthdate from public.profiles
     where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'A can''t read birthdate, even their own');

-- RLS hides B's row from A's update, so it silently matches nothing.
-- We check that B is unchanged further down.
select lives_ok(
  $$ update public.profiles set display_name = 'Hacked'
     where id = '22222222-2222-4222-8222-222222222222' $$,
  'A''s update of B runs but matches no rows');

select lives_ok(
  $$ update public.profiles set display_name = 'Ava Renamed'
     where id = '11111111-1111-4111-8111-111111111111' $$,
  'A can rename themselves');

-- 42501 = "insufficient privilege". NULL means "don't check the message".
select throws_ok(
  $$ update public.profiles set role = 'admin'
     where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'A can''t make themselves an admin');

select throws_ok(
  $$ update public.profiles set is_tester = true
     where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'A can''t make themselves a tester');

select throws_ok(
  $$ update public.profiles set birthdate = '1990-01-01'
     where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'A can''t change their birthdate');

select throws_ok(
  $$ insert into public.profiles (id, display_name, birthdate)
     values ('22222222-2222-4222-8222-222222222222', 'Fake', '1990-01-01') $$,
  '42501', null, 'A can''t insert profiles directly');

select throws_ok(
  $$ delete from public.profiles where id = '22222222-2222-4222-8222-222222222222' $$,
  '42501', null, 'A can''t delete profiles directly');

-- ---- Back to the owner: confirm what really changed -------------------------
reset role;

select is(
  (select display_name from public.profiles where id = '22222222-2222-4222-8222-222222222222'),
  'Bea', 'B''s profile is unchanged');

select is(
  (select display_name from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'Ava Renamed', 'A''s rename was saved');

select is(
  (select role || '/' || is_tester::text from public.profiles
   where id = '11111111-1111-4111-8111-111111111111'),
  'user/false', 'A is still a normal user and not a tester');

-- ---- Trigger backstop -------------------------------------------------------
-- Pretend someone wrongly granted update on every server-only column. The
-- trigger must still refuse each change. (This grant is rolled back with
-- everything else.) Each check also matches the trigger's exact message, to
-- prove it was the trigger that stopped it and not some other rule.
grant update (id, role, is_tester, birthdate) on public.profiles to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select throws_ok(
  $$ update public.profiles set role = 'admin'
     where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', 'Only the server can change id, role, is_tester, birthdate or created_at',
  'Trigger blocks role change even with a wrong grant');

select throws_ok(
  $$ update public.profiles set is_tester = true
     where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', 'Only the server can change id, role, is_tester, birthdate or created_at',
  'Trigger blocks tester change even with a wrong grant');

select throws_ok(
  $$ update public.profiles set birthdate = '1990-01-01'
     where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', 'Only the server can change id, role, is_tester, birthdate or created_at',
  'Trigger blocks birthdate change even with a wrong grant');

-- Changing id would hand A's profile a different identity. BEFORE triggers run
-- before the RLS "with check" rule, so the trigger's message is what we see.
select throws_ok(
  $$ update public.profiles set id = '33333333-3333-4333-8333-333333333333'
     where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', 'Only the server can change id, role, is_tester, birthdate or created_at',
  'Trigger blocks id change even with a wrong grant');

-- ---- Not signed in (anon) ---------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$ select * from public.profiles $$,
  '42501', null, 'anon can''t read profiles');

select throws_ok(
  $$ update public.profiles set display_name = 'x' $$,
  '42501', null, 'anon can''t update profiles');

-- ---- The server can still set server-only fields ---------------------------
-- The trigger only blocks the app's roles. Task VC-B14 marks tester accounts
-- with SQL run as the owner, so that must keep working.
reset role;

select lives_ok(
  $$ update public.profiles set is_tester = true
     where id = '11111111-1111-4111-8111-111111111111' $$,
  'The owner (server) can mark A as a tester');

select is(
  (select is_tester from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  true, 'A is now a tester');

select * from finish();
rollback;
