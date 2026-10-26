-- =============================================================================
-- pgTAP test 5: check-ins and ratings (VC-B02).
--
-- What it checks: user A sees only their own check-ins and ratings, never B's;
-- nobody can write them directly (that's only for the check_in and
-- submit_rating server functions in later tasks); anon can't read them; and
-- the database works out each rating's 0-10 score correctly.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- ---- Setup (as owner): users A and B, one event, a check-in and rating each -
insert into auth.users (id, email) values
  ('55555555-5555-4555-8555-555555555551', 'a5@test.vibecheck.invalid'),
  ('55555555-5555-4555-8555-555555555552', 'b5@test.vibecheck.invalid');
insert into public.profiles (id, display_name, birthdate) values
  ('55555555-5555-4555-8555-555555555551', 'Ava', '1995-05-05'),
  ('55555555-5555-4555-8555-555555555552', 'Bea', '1996-06-06');

insert into public.events (id, title, area_label, starts_at, ends_at) values
  ('cccccccc-0000-4000-8000-000000000001', 'Party', 'Shaw, DC',
   now(), now() + interval '4 hours');

insert into public.check_ins (user_id, event_id, method) values
  ('55555555-5555-4555-8555-555555555551', 'cccccccc-0000-4000-8000-000000000001', 'gps'),
  ('55555555-5555-4555-8555-555555555552', 'cccccccc-0000-4000-8000-000000000001', 'code');

-- A rates everything Fire (3,3,3); B rates everything Good (2,2,2).
insert into public.ratings (user_id, event_id, crowd, music, energy, reaction) values
  ('55555555-5555-4555-8555-555555555551', 'cccccccc-0000-4000-8000-000000000001', 3, 3, 3, 'fire'),
  ('55555555-5555-4555-8555-555555555552', 'cccccccc-0000-4000-8000-000000000001', 2, 2, 2, null);

-- ---- Score maths (as owner): (crowd + music + energy - 3) / 6 x 10 ----------
select is(
  (select score from public.ratings where user_id = '55555555-5555-4555-8555-555555555551'),
  10.0::numeric, 'All Fire scores 10');
select is(
  (select score from public.ratings where user_id = '55555555-5555-4555-8555-555555555552'),
  5.0::numeric, 'All Good scores 5');

-- 23505 = "unique rule broken": one rating per person per event.
select throws_ok(
  $$ insert into public.ratings (user_id, event_id, crowd, music, energy)
     values ('55555555-5555-4555-8555-555555555551', 'cccccccc-0000-4000-8000-000000000001', 1, 1, 1) $$,
  '23505', null, 'A second rating for the same event is refused');

-- ---- Act as user A ----------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"55555555-5555-4555-8555-555555555551","role":"authenticated"}', true);

select results_eq(
  $$ select user_id from public.check_ins where event_id = 'cccccccc-0000-4000-8000-000000000001' $$,
  array['55555555-5555-4555-8555-555555555551'::uuid],
  'A sees only their own check-in, not B''s');

select results_eq(
  $$ select user_id from public.ratings where event_id = 'cccccccc-0000-4000-8000-000000000001' $$,
  array['55555555-5555-4555-8555-555555555551'::uuid],
  'A sees only their own rating, not B''s');

-- Direct writes are refused for everyone; only server functions may write.
select throws_ok(
  $$ update public.ratings set crowd = 1
     where user_id = '55555555-5555-4555-8555-555555555552' $$,
  '42501', null, 'A can''t change B''s rating');
select throws_ok(
  $$ update public.ratings set crowd = 1
     where user_id = '55555555-5555-4555-8555-555555555551' $$,
  '42501', null, 'A can''t edit their own rating directly (must use submit_rating)');
select throws_ok(
  $$ insert into public.ratings (user_id, event_id, crowd, music, energy)
     values ('55555555-5555-4555-8555-555555555552', 'cccccccc-0000-4000-8000-000000000001', 1, 1, 1) $$,
  '42501', null, 'A can''t insert ratings directly');
select throws_ok(
  $$ delete from public.ratings $$,
  '42501', null, 'A can''t delete ratings');
select throws_ok(
  $$ update public.check_ins set method = 'gps'
     where user_id = '55555555-5555-4555-8555-555555555552' $$,
  '42501', null, 'A can''t change B''s check-in');
select throws_ok(
  $$ insert into public.check_ins (user_id, event_id, method)
     values ('55555555-5555-4555-8555-555555555551', 'cccccccc-0000-4000-8000-000000000001', 'tester') $$,
  '42501', null, 'A can''t check in without the check_in function');
select throws_ok(
  $$ delete from public.check_ins $$,
  '42501', null, 'A can''t delete check-ins');

-- ---- Not signed in (anon) ---------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok($$ select * from public.check_ins $$,
  '42501', null, 'anon can''t read check-ins');
select throws_ok($$ select * from public.ratings $$,
  '42501', null, 'anon can''t read ratings');

-- ---- Owner confirms nothing was changed by A's attempts ---------------------
reset role;
select is(
  (select crowd from public.ratings where user_id = '55555555-5555-4555-8555-555555555552'),
  2::smallint, 'B''s rating is unchanged');
select is(
  (select method from public.check_ins where user_id = '55555555-5555-4555-8555-555555555552'),
  'code', 'B''s check-in is unchanged');

select * from finish();
rollback;
