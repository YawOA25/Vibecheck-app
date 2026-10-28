-- =============================================================================
-- pgTAP test 24: admins can read test events (VC-63b).
--
-- Why: the founder (an admin, not a tester) created a test event and then
-- couldn't see it. Migration 20261027220000_admins_read_test_events.sql
-- lets admins read test events. This test proves:
--   - an admin who is not a tester now sees the test event;
--   - a plain adult still does NOT see it (the important safety check);
--   - a tester still sees it;
--   - someone with no profile still sees nothing;
--   - the new helper answers correctly and only signed-in users may run it;
--   - the old rule is gone and the new one is in place;
--   - the event page's server calls agree (cto fix,
--     20261027220100_admins_see_test_event_details.sql): an admin gets a
--     test event's vibe and heads-ups, and it is in the list's vibes
--     answer; a plain user still gets VCNFD ("not found") and nothing in
--     the list answer; private.can_see_event stays locked to the server.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

-- ---- Setup (as owner) -------------------------------------------------------
insert into auth.users (id, email) values
  ('24242424-0000-4000-8000-000000000001', 'admin24@test.vibecheck.invalid'),
  ('24242424-0000-4000-8000-000000000002', 'plain24@test.vibecheck.invalid'),
  ('24242424-0000-4000-8000-000000000003', 'tester24@test.vibecheck.invalid'),
  ('24242424-0000-4000-8000-000000000004', 'noprofile24@test.vibecheck.invalid');

-- The no-profile user (…004) deliberately gets no profile row.
insert into public.profiles (id, display_name, birthdate, role, is_tester) values
  ('24242424-0000-4000-8000-000000000001', 'Admin', private.age_gate_today() - interval '30 years', 'admin', false),
  ('24242424-0000-4000-8000-000000000002', 'Plain', private.age_gate_today() - interval '30 years', 'user', false),
  ('24242424-0000-4000-8000-000000000003', 'Tester', private.age_gate_today() - interval '30 years', 'user', true);

insert into public.events (id, title, area_label, starts_at, ends_at, is_test) values
  ('24242424-eeee-4000-8000-000000000001', 'Real party', 'Shaw, DC',
   now() + interval '1 day', now() + interval '1 day 4 hours', false),
  ('24242424-eeee-4000-8000-000000000002', 'Jessy + Friends', 'Shaw, DC',
   now() + interval '1 day', now() + interval '1 day 4 hours', true);

-- ---- The rule itself --------------------------------------------------------
select policies_are('public', 'events',
  array['Adults read events; testers and admins also read test events'],
  'events has only the new read rule (the tester-only one is gone)');

select ok(not has_function_privilege('anon', 'private.can_read_test_events()', 'execute'),
  'anon can''t run private.can_read_test_events()');

select ok(not has_function_privilege('authenticated', 'private.is_admin()', 'execute'),
  'private.is_admin() stays locked for signed-in users');

select ok(not has_function_privilege('authenticated', 'private.can_see_event(uuid)', 'execute')
          and not has_function_privilege('anon', 'private.can_see_event(uuid)', 'execute'),
  'private.can_see_event keeps its grants: only server functions may call it');

-- ---- Admin, not a tester ----------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"24242424-0000-4000-8000-000000000001","role":"authenticated"}', true);

select results_eq(
  $$ select id from public.events
     where id in ('24242424-eeee-4000-8000-000000000001', '24242424-eeee-4000-8000-000000000002')
     order by id $$,
  array['24242424-eeee-4000-8000-000000000001'::uuid, '24242424-eeee-4000-8000-000000000002'::uuid],
  'An admin who is not a tester sees the test event too');

select ok(private.can_read_test_events(), 'The helper says yes for an admin');

select lives_ok($$ select public.get_event_vibe('24242424-eeee-4000-8000-000000000002') $$,
  'An admin gets the vibe of a test event (no VCNFD)');

select is(public.get_event_heads_ups('24242424-eeee-4000-8000-000000000002'), '[]'::jsonb,
  'An admin gets the heads-ups of a test event (none yet)');

select is(
  (select count(*)::int
   from jsonb_array_elements(public.get_events_vibe(array['24242424-eeee-4000-8000-000000000002'::uuid])) item
   where item ->> 'event_id' = '24242424-eeee-4000-8000-000000000002'),
  1, 'The list''s vibes call includes the test event for an admin');

-- ---- Plain adult (not admin, not tester) -------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"24242424-0000-4000-8000-000000000002","role":"authenticated"}', true);

select results_eq(
  $$ select id from public.events
     where id in ('24242424-eeee-4000-8000-000000000001', '24242424-eeee-4000-8000-000000000002')
     order by id $$,
  array['24242424-eeee-4000-8000-000000000001'::uuid],
  'A plain user still sees the real event only, never the test event');

select is_empty(
  $$ select id from public.events where is_test
       and id = '24242424-eeee-4000-8000-000000000002' $$,
  'A plain user can''t reach the test event even by asking for it directly');

select ok(not private.can_read_test_events(), 'The helper says no for a plain user');

select throws_ok($$ select public.get_event_vibe('24242424-eeee-4000-8000-000000000002') $$,
  'VCNFD', null, 'A plain user still gets VCNFD for a test event''s vibe');

select throws_ok($$ select public.get_event_heads_ups('24242424-eeee-4000-8000-000000000002') $$,
  'VCNFD', null, 'A plain user still gets VCNFD for a test event''s heads-ups');

select is(
  (select count(*)::int
   from jsonb_array_elements(public.get_events_vibe(array['24242424-eeee-4000-8000-000000000002'::uuid]))),
  0, 'The list''s vibes call leaves the test event out for a plain user');

-- ---- Tester -----------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"24242424-0000-4000-8000-000000000003","role":"authenticated"}', true);

select results_eq(
  $$ select id from public.events
     where id in ('24242424-eeee-4000-8000-000000000001', '24242424-eeee-4000-8000-000000000002')
     order by id $$,
  array['24242424-eeee-4000-8000-000000000001'::uuid, '24242424-eeee-4000-8000-000000000002'::uuid],
  'A tester still sees both events');

-- ---- Signed in, no profile --------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"24242424-0000-4000-8000-000000000004","role":"authenticated"}', true);

select is_empty(
  $$ select id from public.events
     where id in ('24242424-eeee-4000-8000-000000000001', '24242424-eeee-4000-8000-000000000002') $$,
  'A signed-in user without a profile still sees no events');

select ok(not private.can_read_test_events(), 'The helper says no without a profile');

select * from finish();
rollback;
