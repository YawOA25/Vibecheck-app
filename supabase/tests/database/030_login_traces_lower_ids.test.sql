-- =============================================================================
-- pgTAP test 30: login ids in the sign-in history match whatever their
-- capitals (Q8a debt), migration 20261029100000_login_traces_lower_ids.sql.
--
-- Why this test exists: Postgres and Supabase write ids in lower case, and
-- the VC-75 helper and sweep compared ids as exact text. An audit entry with
-- the id in CAPITALS would have been missed by delete_login_traces (leaving
-- the email and IP behind) and wrongly swept as "orphaned" while its login
-- was still alive. Here we plant such entries on purpose and check:
--   * delete_login_traces removes an entry that names the login in capitals;
--   * the sweep keeps a live login's capitalised entry (and an admin action
--     about it), and removes a capitalised entry whose login is gone;
--   * both helpers stay locked down.
--
-- Everything runs inside BEGIN ... ROLLBACK, so nothing is kept.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

-- ---- Setup (as the database owner) -----------------------------------------
-- Ids contain letters, so upper() really changes them.
--   ...0a: a login that will be deleted through delete_login_traces;
--   ...0b: a live login that must keep its history.
insert into auth.users (id, email) values
  ('30303030-aaaa-4bbb-8ccc-00000000000a', 'lower-ids-gone@test.vibecheck.invalid'),
  ('30303030-aaaa-4bbb-8ccc-00000000000b', 'lower-ids-live@test.vibecheck.invalid');

-- Audit entries naming the ids in CAPITALS (one marker each, to find them).
insert into auth.audit_log_entries (id, payload, created_at, ip_address) values
  -- 1. names login 0a by traits.user_id, in capitals.
  (gen_random_uuid(), json_build_object('action', 'login', 'marker', 'q8a-gone',
     'traits', json_build_object('user_id', upper('30303030-aaaa-4bbb-8ccc-00000000000a'))),
   now(), '203.0.113.30'),
  -- 2. names live login 0b by actor_id, in capitals.
  (gen_random_uuid(), json_build_object('action', 'login', 'marker', 'q8a-live',
     'actor_id', upper('30303030-aaaa-4bbb-8ccc-00000000000b')),
   now(), '203.0.113.31'),
  -- 3. an admin action (all-zeros actor) about live login 0b, in capitals.
  (gen_random_uuid(), json_build_object('action', 'user_modified', 'marker', 'q8a-admin',
     'actor_id', '00000000-0000-0000-0000-000000000000',
     'traits', json_build_object('user_id', upper('30303030-aaaa-4bbb-8ccc-00000000000b'))),
   now(), '203.0.113.32'),
  -- 4. names a login that never existed (so is "gone"), in capitals.
  (gen_random_uuid(), json_build_object('action', 'login', 'marker', 'q8a-orphan',
     'actor_id', upper('30303030-aaaa-4bbb-8ccc-0000000000ff')),
   now(), '203.0.113.33');

-- A test-only helper: how many audit entries carry this marker?
create function pg_temp.entries(p_marker text)
returns integer
language sql
as $$
  /* Counts audit entries whose payload has "marker" = p_marker. */
  select count(*)::int from auth.audit_log_entries a where a.payload ->> 'marker' = p_marker;
$$;

-- ---- 1. Both helpers are locked down (2) -----------------------------------
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=""%'
   from pg_proc p where p.oid = 'private.sweep_orphan_login_traces()'::regprocedure),
  'the sweep is security definer with an empty search_path');
select ok(
  not has_function_privilege('authenticated', 'private.sweep_orphan_login_traces()', 'execute')
  and not has_function_privilege('anon', 'private.sweep_orphan_login_traces()', 'execute')
  and not has_function_privilege('authenticated', 'private.delete_login_traces(uuid)', 'execute'),
  'app users and visitors can run neither helper');

-- ---- 2. delete_login_traces finds a capitalised id (1) ---------------------
select private.delete_login_traces('30303030-aaaa-4bbb-8ccc-00000000000a');
select is(pg_temp.entries('q8a-gone'), 0,
  'an entry naming the login in CAPITALS is deleted with its login''s history');

-- ---- 3. The sweep compares ids in lower case (4) ---------------------------
select cmp_ok(private.sweep_orphan_login_traces(), '>=', 1, 'the sweep ran and removed something');
select is(pg_temp.entries('q8a-live'), 1,
  'a LIVE login''s entry is kept even though it names the id in capitals');
select is(pg_temp.entries('q8a-admin'), 1,
  'an admin action about a live login (capitals) is kept');
select is(pg_temp.entries('q8a-orphan'), 0,
  'an entry naming a login that no longer exists (capitals) is removed');

select * from finish();
rollback;
