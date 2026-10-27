-- =============================================================================
-- pgTAP test 4: who can see events (VC-B02).
--
-- What it checks: signed-up adults see real events but not test events;
-- testers see both; someone signed in who never finished the 18+ step (no
-- profile) sees nothing; an under-18 profile (which complete_profile will
-- refuse to create, but we test anyway) sees nothing; someone turning 18 today
-- sees events; nobody can write events directly; anon can't read them.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

-- ---- Setup (as owner) -------------------------------------------------------
insert into auth.users (id, email) values
  ('44444444-4444-4444-8444-444444444441', 'adult@test.vibecheck.invalid'),
  ('44444444-4444-4444-8444-444444444442', 'tester@test.vibecheck.invalid'),
  ('44444444-4444-4444-8444-444444444443', 'noprofile@test.vibecheck.invalid'),
  ('44444444-4444-4444-8444-444444444444', 'minor@test.vibecheck.invalid'),
  ('44444444-4444-4444-8444-444444444445', 'birthday@test.vibecheck.invalid');

-- The 'no profile' user (…443) deliberately gets no profile row.
-- Birthdates are worked out from today so the test never goes stale. "Today"
-- is New York's date (private.age_gate_today), the same day the server's
-- 18+ rule uses; plain current_date is UTC and made this test fail every
-- evening after 8 PM in New York.
insert into public.profiles (id, display_name, birthdate, is_tester) values
  ('44444444-4444-4444-8444-444444444441', 'Adult', private.age_gate_today() - interval '30 years', false),
  ('44444444-4444-4444-8444-444444444442', 'Tester', private.age_gate_today() - interval '30 years', true),
  -- 17 years and 364 days old: one day short of 18.
  ('44444444-4444-4444-8444-444444444444', 'Minor',
   (private.age_gate_today() - interval '18 years')::date + 1, false),
  -- Exactly 18 today.
  ('44444444-4444-4444-8444-444444444445', 'Birthday',
   (private.age_gate_today() - interval '18 years')::date, false);

insert into public.events (id, title, area_label, starts_at, ends_at, is_test) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Real party', 'Shaw, DC',
   now(), now() + interval '4 hours', false),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'Test party', 'Shaw, DC',
   now(), now() + interval '4 hours', true);

-- The query each user runs. We filter to this test's two events so seed data
-- in the dev project doesn't change the result.
-- (Written out in each check below because pgTAP takes the SQL as text.)

-- ---- Adult, not a tester ----------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444441","role":"authenticated"}', true);

select results_eq(
  $$ select id from public.events
     where id in ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002')
     order by id $$,
  array['bbbbbbbb-0000-4000-8000-000000000001'::uuid],
  'An adult sees the real event but not the test event');

select throws_ok(
  $$ insert into public.events (title, area_label, starts_at, ends_at)
     values ('Fake', 'Shaw, DC', now(), now() + interval '1 hour') $$,
  '42501', null, 'A user can''t create events directly');

select throws_ok(
  $$ update public.events set title = 'Hacked' $$,
  '42501', null, 'A user can''t edit events directly');

select throws_ok(
  $$ delete from public.events $$,
  '42501', null, 'A user can''t delete events directly');

-- ---- Tester -----------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444442","role":"authenticated"}', true);

select results_eq(
  $$ select id from public.events
     where id in ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002')
     order by id $$,
  array['bbbbbbbb-0000-4000-8000-000000000001'::uuid, 'bbbbbbbb-0000-4000-8000-000000000002'::uuid],
  'A tester sees both the real and the test event');

-- ---- Signed in, but no profile (never finished the 18+ step) ---------------
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444443","role":"authenticated"}', true);

select is_empty(
  $$ select id from public.events
     where id in ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002') $$,
  'A signed-in user without a profile sees no events');

-- ---- Under 18 (one day short) -----------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);

select is_empty(
  $$ select id from public.events
     where id in ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002') $$,
  'A 17-year-old profile sees no events');

-- ---- Turning 18 today -------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444445","role":"authenticated"}', true);

select results_eq(
  $$ select id from public.events
     where id in ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002') $$,
  array['bbbbbbbb-0000-4000-8000-000000000001'::uuid],
  'Someone who turns 18 today sees the real event');

-- ---- Not signed in (anon) ---------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok($$ select * from public.events $$,
  '42501', null, 'anon can''t read events');

-- ---- Database rule: an event must end after it starts ----------------------
reset role;
-- 23514 = "check constraint violated".
select throws_ok(
  $$ insert into public.events (title, area_label, starts_at, ends_at)
     values ('Backwards', 'Shaw, DC', now(), now() - interval '1 hour') $$,
  '23514', null, 'An event can''t end before it starts');

select * from finish();
rollback;
