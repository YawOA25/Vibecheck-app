-- =============================================================================
-- pgTAP test 29: every path that deletes a login also deletes its sign-in
-- history (cto must-fix on VC-74/VC-75), migration
-- 20261028210000_delete_login_traces.sql.
--
-- Why this test exists: Supabase Auth's audit log (auth.audit_log_entries)
-- and half-finished sign-ins (auth.flow_state) hold the plain email and IP
-- address and have no cascade. Test 028 inserted logins directly, so it had
-- no such rows and couldn't notice they were left behind. Here each login
-- gets REAL history rows first (shaped like the ones Supabase writes), then
-- goes through one of the delete paths:
--   * the under-13 refusal in complete_profile;
--   * the 12-month cleanup (an expired 13-17 mark);
--   * delete_account (including an entry that names only the email).
-- A bystander's history must stay untouched.
--
-- Everything runs inside BEGIN ... ROLLBACK, so nothing is kept.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

-- ---- Setup (as the database owner) -----------------------------------------
-- 01 child (under-13 path), 02 expired locked login (cleanup path),
-- 03 adult who deletes their account, 04 bystander.
insert into auth.users (id, email) values
  ('29292929-0000-4000-8000-000000000001', 'traces-child@test.vibecheck.invalid'),
  ('29292929-0000-4000-8000-000000000002', 'traces-teen@test.vibecheck.invalid'),
  ('29292929-0000-4000-8000-000000000003', 'traces-adult@test.vibecheck.invalid'),
  ('29292929-0000-4000-8000-000000000004', 'traces-bystander@test.vibecheck.invalid');
insert into public.profiles (id, display_name, birthdate) values
  ('29292929-0000-4000-8000-000000000003', 'Adult', '1990-01-01'),
  ('29292929-0000-4000-8000-000000000004', 'Bystander', '1990-01-01');

-- A test-only helper: gives login n two audit entries shaped like Supabase's
-- own (one naming the id, one naming only the email) and a flow_state row.
create function pg_temp.add_history(p_n integer, p_email text)
returns void
language sql
as $$
  /* Login number p_n (email p_email) gets real-looking sign-in history.
     Returns nothing. */
  insert into auth.audit_log_entries (id, payload, created_at, ip_address) values
    (gen_random_uuid(),
     json_build_object('action', 'user_signedup', 'actor_id',
       '29292929-0000-4000-8000-00000000000' || p_n, 'actor_username', p_email,
       'log_type', 'team', 'traits', json_build_object('provider', 'email')),
     now(), '203.0.113.' || p_n),
    (gen_random_uuid(),
     json_build_object('action', 'user_confirmation_requested', 'actor_username', upper(p_email),
       'log_type', 'user', 'traits', json_build_object('user_email', p_email)),
     now(), '203.0.113.' || p_n);
  insert into auth.flow_state (id, user_id, provider_type, authentication_method, created_at)
  values (gen_random_uuid(), ('29292929-0000-4000-8000-00000000000' || p_n)::uuid,
          'email', 'otp', now());
$$;

select pg_temp.add_history(1, 'traces-child@test.vibecheck.invalid');
select pg_temp.add_history(2, 'traces-teen@test.vibecheck.invalid');
select pg_temp.add_history(3, 'traces-adult@test.vibecheck.invalid');
select pg_temp.add_history(4, 'traces-bystander@test.vibecheck.invalid');

-- A test-only helper: does any history row still name login n (id or email)?
create function pg_temp.history_left(p_n integer, p_email text)
returns integer
language sql
as $$
  /* Counts audit and flow_state rows that still name login p_n by its id or
     its email (any capitals). Returns the count. */
  select (select count(*)::int from auth.audit_log_entries a
          where a.payload::text ilike '%' || p_email || '%'
             or a.payload::text like '%29292929-0000-4000-8000-00000000000' || p_n || '%')
       + (select count(*)::int from auth.flow_state f
          where f.user_id = ('29292929-0000-4000-8000-00000000000' || p_n)::uuid);
$$;

-- ---- 1. The helper is locked down (2) ---------------------------------------
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=""%'
   from pg_proc p where p.oid = 'private.delete_login_traces(uuid)'::regprocedure),
  'delete_login_traces is security definer with an empty search_path');
select ok(
  not has_function_privilege('authenticated', 'private.delete_login_traces(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.delete_login_traces(uuid)', 'execute'),
  'app users and visitors can''t run it');

select is(pg_temp.history_left(1, 'traces-child@test.vibecheck.invalid'), 3,
  'before: the child has 2 audit entries and 1 flow_state row');

-- ---- 2. Under 13: the email is gone from the history too (2) ---------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"29292929-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  public.complete_profile('Kid', (select (now() at time zone 'America/New_York')::date - interval '10 years')::date),
  'refused_deleted', 'a 10-year-old is refused and the login deleted');
reset role;
select is(pg_temp.history_left(1, 'traces-child@test.vibecheck.invalid'), 0,
  'no audit entry or flow_state row names the child (id or email) any more');

-- ---- 3. The 12-month cleanup removes the history too (2) -------------------
insert into private.age_gate_refusals (email_hmac, refused_at)
values (private.age_refusal_email_hmac('traces-teen@test.vibecheck.invalid'), now() - interval '13 months');
select cmp_ok(private.purge_expired_age_refusals(), '>=', 1, 'the cleanup ran');
select ok(
  not exists (select 1 from auth.users where id = '29292929-0000-4000-8000-000000000002')
  and pg_temp.history_left(2, 'traces-teen@test.vibecheck.invalid') = 0,
  'the expired login and all of its sign-in history are gone');

-- ---- 4. delete_account, including the email-only entry (2) -----------------
set local role service_role;
select lives_ok($$ select public.delete_account('29292929-0000-4000-8000-000000000003') $$,
  'the account is deleted');
reset role;
select is(pg_temp.history_left(3, 'traces-adult@test.vibecheck.invalid'), 0,
  'its history is gone, including the entry that named only the email');

-- ---- 5. Nobody else's history is touched (1) --------------------------------
select is(pg_temp.history_left(4, 'traces-bystander@test.vibecheck.invalid'), 3,
  'the bystander keeps all 3 history rows');

select * from finish();
rollback;
