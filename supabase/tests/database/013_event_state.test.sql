-- =============================================================================
-- pgTAP test 13: each event's state, DC / MD / VA (proposal VC-37).
--
-- What it checks, in plain words:
--   * The new column exists, may be empty (older events), and the table rule
--     refuses anything but 'DC', 'MD' or 'VA', even from the owner.
--   * Only one create_event and one update_event exist (the old versions
--     were dropped, so calls aren't ambiguous), both still security definer
--     with an empty search_path, callable by signed-in users and not anon.
--   * create_event saves p_state; leaving it out saves nothing (null); a bad
--     code is refused with VCSTA.
--   * update_event changes the state, keeps it when p_state is left out,
--     removes it with '', and refuses a bad code with VCSTA.
--   * A normal user still can't create or edit (the state changes nothing
--     about who may), and signed-in adults can read the state like the area.
-- Everything runs inside BEGIN ... ROLLBACK, so nothing is left behind.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

-- ---- Setup (as owner) -------------------------------------------------------
insert into auth.users (id, email) values
  ('eeeeeeee-9999-4999-8999-0000000000e1', 'state-admin@test.vibecheck.invalid'),
  ('eeeeeeee-9999-4999-8999-0000000000e2', 'state-user@test.vibecheck.invalid');
insert into public.profiles (id, display_name, birthdate, is_tester, role) values
  ('eeeeeeee-9999-4999-8999-0000000000e1', 'Admin', current_date - interval '30 years', false, 'admin'),
  ('eeeeeeee-9999-4999-8999-0000000000e2', 'User', current_date - interval '30 years', false, 'user');

-- ---- 1. The column and its rule (3) -----------------------------------------
select col_is_null('public', 'events', 'state', 'events.state may be empty (older events)');
select throws_ok(
  $$ insert into public.events (title, area_label, starts_at, ends_at, state)
     values ('Bad state', 'Shaw, DC', now() + interval '1 hour', now() + interval '3 hours', 'NY') $$,
  '23514', null, 'the table rule refuses a state other than DC, MD or VA');
select lives_ok(
  $$ insert into public.events (title, area_label, starts_at, ends_at, state)
     values ('Good state', 'Bethesda, MD', now() + interval '1 hour', now() + interval '3 hours', 'MD') $$,
  'the table accepts MD');

-- ---- 2. One version of each function, still locked down (3) ----------------
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('create_event', 'update_event')),
  2, 'exactly one create_event and one update_event exist (old versions dropped)');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'])
           from pg_proc where proname in ('create_event', 'update_event')
             and pronamespace = 'public'::regnamespace),
  'both are still security definer with an empty search_path');
select ok(
  not has_function_privilege('anon',
    'public.create_event(text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, text, text, text, boolean, text, text)', 'execute')
  and not has_function_privilege('anon',
    'public.update_event(uuid, text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, boolean, text, text, text, boolean, text, text)', 'execute')
  and has_function_privilege('authenticated',
    'public.create_event(text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, text, text, text, boolean, text, text)', 'execute'),
  'anon can''t call them; signed-in users can (the admin check inside decides)');

-- ---- 3. create_event and the state (3) --------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-9999-4999-8999-0000000000e1","role":"authenticated"}', true);
select set_config('vc.state_event', public.create_event(
  'Arlington night', 'Clarendon, VA', now() + interval '1 hour', now() + interval '4 hours',
  38.887, -77.095, p_state => 'VA') ->> 'event_id', true);
select is((select state from public.events where id = current_setting('vc.state_event')::uuid),
  'VA', 'create_event saves the state');
select set_config('vc.no_state_event', public.create_event(
  'No state', 'Shaw, DC', now() + interval '1 hour', now() + interval '4 hours',
  38.91, -77.02) ->> 'event_id', true);
select is((select state from public.events where id = current_setting('vc.no_state_event')::uuid),
  null, 'leaving p_state out saves no state (older apps keep working)');
select throws_ok(
  $$ select public.create_event('Bad', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '4 hours', 38.91, -77.02, p_state => 'Maryland') $$,
  'VCSTA', null, 'create_event refuses a state that isn''t DC, MD or VA');

-- ---- 4. update_event and the state (7) --------------------------------------
select lives_ok(
  $$ select public.update_event(current_setting('vc.state_event')::uuid, p_state => 'DC') $$,
  'update_event can change the state');
select is((select state from public.events where id = current_setting('vc.state_event')::uuid),
  'DC', 'the state changed to DC');
select lives_ok(
  $$ select public.update_event(current_setting('vc.state_event')::uuid, p_title => 'Renamed') $$,
  'an edit without p_state works');
select is((select state from public.events where id = current_setting('vc.state_event')::uuid),
  'DC', 'leaving p_state out keeps the state');
select throws_ok(
  $$ select public.update_event(current_setting('vc.state_event')::uuid, p_state => 'ny') $$,
  'VCSTA', null, 'update_event refuses a bad state');

-- '' removes the state, like the ticket link and summary.
select lives_ok(
  $$ select public.update_event(current_setting('vc.state_event')::uuid, p_state => '') $$,
  'update_event accepts an empty state (= remove it)');
select is((select state from public.events where id = current_setting('vc.state_event')::uuid),
  null, 'an empty p_state removes the state');

-- ---- 5. Who may write and read it (2) --------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-9999-4999-8999-0000000000e2","role":"authenticated"}', true);
select throws_ok(
  $$ select public.update_event(current_setting('vc.state_event')::uuid, p_state => 'MD') $$,
  '42501', null, 'a normal user still can''t edit an event, state included');
reset role;
select ok(has_column_privilege('authenticated', 'public.events', 'state', 'select'),
  'signed-in users may read the state, like the area label');

select * from finish();
rollback;
