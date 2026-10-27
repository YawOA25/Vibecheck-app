-- =============================================================================
-- pgTAP test 12: admins can see an event's party code again (proposal VC-35).
--
-- What it checks, in plain words:
--   * get_event_code is security definer with an empty search_path, anon
--     can't call it, and it never logs (so a code can't reach the logs).
--   * An admin gets the current code, and the NEW code after a rotation.
--   * Everyone else is refused with 42501: anon, a login with no profile, a
--     normal user, and a tester who isn't an admin.
--   * An unknown event gives VCNFD to an admin; a non-admin is refused
--     before the lookup, so they can't even learn whether an event exists.
-- Everything runs inside BEGIN ... ROLLBACK, so nothing is left behind.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- ---- Setup (as owner) -------------------------------------------------------
-- Users: …d1 admin, …d2 normal user, …d3 tester (not admin), …d4 no profile.
insert into auth.users (id, email) values
  ('dddddddd-9999-4999-8999-0000000000d1', 'code-view-admin@test.vibecheck.invalid'),
  ('dddddddd-9999-4999-8999-0000000000d2', 'code-view-user@test.vibecheck.invalid'),
  ('dddddddd-9999-4999-8999-0000000000d3', 'code-view-tester@test.vibecheck.invalid'),
  ('dddddddd-9999-4999-8999-0000000000d4', 'code-view-noprofile@test.vibecheck.invalid');
insert into public.profiles (id, display_name, birthdate, is_tester, role) values
  ('dddddddd-9999-4999-8999-0000000000d1', 'Admin', current_date - interval '30 years', false, 'admin'),
  ('dddddddd-9999-4999-8999-0000000000d2', 'User', current_date - interval '30 years', false, 'user'),
  ('dddddddd-9999-4999-8999-0000000000d3', 'Tester', current_date - interval '30 years', true, 'user');

insert into public.events (id, title, area_label, starts_at, ends_at, code_check_in_enabled) values
  ('dddddddd-0000-4000-8000-0000000000e1', 'Code party', 'Shaw, DC', now() + interval '1 hour', now() + interval '5 hours', true);
insert into public.event_private (event_id, lat, lng, radius_m, check_in_code) values
  ('dddddddd-0000-4000-8000-0000000000e1', 38.9, -77.0, 150, 'K7MX2Q');

-- ---- 1. Static checks (3) ---------------------------------------------------
select ok(not has_function_privilege('anon', 'public.get_event_code(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.get_event_code(uuid)', 'execute'),
  'anon can''t call get_event_code; signed-in users can (the admin check inside decides)');
select ok((select prosecdef and proconfig @> array['search_path=""']
           from pg_proc where oid = 'public.get_event_code(uuid)'::regprocedure),
  'get_event_code is security definer with an empty search_path');
select ok((select prosrc !~* 'raise\s+(notice|log|info|debug|warning)'
           from pg_proc where oid = 'public.get_event_code(uuid)'::regprocedure),
  'get_event_code never logs anything');

-- ---- 2. The admin gets the current code (3) ---------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d1","role":"authenticated"}', true);
select is(public.get_event_code('dddddddd-0000-4000-8000-0000000000e1'), 'K7MX2Q',
  'an admin gets the event''s party code');
-- After "Get a new code" (update_event rotates it), the admin sees the new one.
create temp table rotated on commit drop as
  select public.update_event('dddddddd-0000-4000-8000-0000000000e1', p_rotate_code => true)
           ->> 'check_in_code' as code;
select is(public.get_event_code('dddddddd-0000-4000-8000-0000000000e1'),
  (select code from rotated),
  'after a rotation the admin gets the NEW code');
select throws_ok(
  $$ select public.get_event_code('dddddddd-0000-4000-8000-0000000000ff') $$,
  'VCNFD', null, 'an unknown event is refused for an admin');

-- ---- 3. Everyone else is refused (6) ----------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d2","role":"authenticated"}', true);
select throws_ok(
  $$ select public.get_event_code('dddddddd-0000-4000-8000-0000000000e1') $$,
  '42501', null, 'a normal user is refused');
select throws_ok(
  $$ select public.get_event_code('dddddddd-0000-4000-8000-0000000000ff') $$,
  '42501', null, 'a normal user is refused before the lookup (no "does it exist" hint)');
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d3","role":"authenticated"}', true);
select throws_ok(
  $$ select public.get_event_code('dddddddd-0000-4000-8000-0000000000e1') $$,
  '42501', null, 'a tester who isn''t an admin is refused');
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d4","role":"authenticated"}', true);
select throws_ok(
  $$ select public.get_event_code('dddddddd-0000-4000-8000-0000000000e1') $$,
  '42501', null, 'a login without a profile is refused');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$ select public.get_event_code('dddddddd-0000-4000-8000-0000000000e1') $$,
  '42501', null, 'anon (not signed in) is refused');
reset role;
-- And the table itself stays unreadable to app users (VC-20).
select ok(not has_table_privilege('authenticated', 'public.event_private', 'select')
          and not has_table_privilege('anon', 'public.event_private', 'select'),
  'event_private is still unreadable to every app role');

select * from finish();
rollback;
