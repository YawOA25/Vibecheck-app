-- =============================================================================
-- pgTAP test 27: account deletion (VC-B13), migration
-- 20261028120000_delete_account.sql.
--
-- What it checks, in plain words:
--   * Locked down: delete_account is security definer with an empty
--     search_path; anon and signed-in app users can't run it at all (not
--     even with their OWN id, and certainly not with someone else's); only
--     the service role (the delete-account Edge Function) can.
--   * A signed-in guest who tries it anyway is refused and nothing changes.
--   * Deleting guest 1 removes their login, profile, check-ins, check-in
--     attempts, ratings, +1s, the reports they made, their +1 ban and their
--     sign-in history, and NOT guest 2's rows of the same kinds.
--   * Afterwards guest 1's id is stored nowhere in public or private (a scan
--     of every table, as text), and neither their id nor their email is left
--     anywhere in the auth schema: the SQL delete removes the sign-in
--     identity, sessions, refresh tokens and one-time codes, as much as
--     Supabase's Admin API delete would (cto review).
--   * Moderation log: a row about guest 1 keeps its action and reason but
--     loses the id and the admin's note. Deleting an admin blanks the admin
--     id only; events they created stay, without the creator link.
--   * Scores: event A (2 ratings waiting below the 3-rater gate) is
--     re-made as of its own moment, minus guest 1, so the waiting ratings
--     stay unpublished. Event B (3 waiting) is published as of now. Event C
--     (no published score yet) is left alone.
--   * Errors: deleting the same person again gives VCNFD. Since VC-75 a
--     login locked by the 18+ gate is deleted too, keeping only its email
--     fingerprint mark (more in 028_age_refusal_hmac.test.sql).
--
-- Everything runs inside BEGIN ... ROLLBACK: nothing is kept. Only made-up
-- test accounts are used (never the practice accounts).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- ---- Setup (as owner) -------------------------------------------------------
-- Guests 01 (deleted) and 02 (kept), bystanders 03-12, admin a1, and a
-- locked login (no profile, refused by the 18+ gate).
insert into auth.users (id, email)
select ('27272727-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'delete-' || n || '@test.vibecheck.invalid'
from generate_series(1, 12) n;
insert into public.profiles (id, display_name, birthdate, is_tester, role)
select ('27272727-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'Delete ' || n, current_date - interval '30 years', false, 'user'
from generate_series(1, 12) n;
insert into auth.users (id, email) values
  ('27272727-9999-4999-8999-0000000000a1', 'delete-admin@test.vibecheck.invalid'),
  ('27272727-9999-4999-8999-0000000000f0', 'delete-locked@test.vibecheck.invalid');
insert into public.profiles (id, display_name, birthdate, is_tester, role) values
  ('27272727-9999-4999-8999-0000000000a1', 'Delete Admin', current_date - interval '30 years', false, 'admin');
-- Since VC-75 the mark is the email's fingerprint, not the login id.
insert into private.age_gate_refusals (email_hmac)
values (private.age_refusal_email_hmac('delete-locked@test.vibecheck.invalid'));

-- Events A, B, C on now; D created by the admin.
insert into public.events (id, title, area_label, starts_at, ends_at, is_test, created_by) values
  ('27272727-0000-4000-8000-0000000000e1', 'Delete A', 'Shaw, DC', now() - interval '3 hours', now() + interval '2 hours', false, null),
  ('27272727-0000-4000-8000-0000000000e2', 'Delete B', 'Shaw, DC', now() - interval '3 hours', now() + interval '2 hours', false, null),
  ('27272727-0000-4000-8000-0000000000e3', 'Delete C', 'Shaw, DC', now() - interval '3 hours', now() + interval '2 hours', false, null),
  ('27272727-0000-4000-8000-0000000000e4', 'Delete D', 'Shaw, DC', now() + interval '1 day', now() + interval '1 day 4 hours', false,
   '27272727-9999-4999-8999-0000000000a1');

-- A test-only helper to add one rating directly (as owner).
create function pg_temp.rate(p_guest integer, p_event text, p_score integer, p_at timestamptz)
returns void
language sql
as $$
  /* Guest number p_guest rates event …p_event with p_score (1-3) on all
     three rows, saved at the moment p_at. Returns nothing. */
  insert into public.ratings (user_id, event_id, crowd, music, energy, created_at, updated_at)
  values (('27272727-9999-4999-8999-0000000000' || lpad(p_guest::text, 2, '0'))::uuid,
          ('27272727-0000-4000-8000-0000000000' || p_event)::uuid,
          p_score, p_score, p_score, p_at, p_at);
$$;

-- A and B: guest 1 (all 3s) and guests 2-6 (all 2s) rated 90 minutes ago,
-- then the score was published 60 minutes ago: 6 raters each.
select pg_temp.rate(n, e, case when n = 1 then 3 else 2 end, now() - interval '90 minutes')
from generate_series(1, 6) n, unnest(array['e1', 'e2']) e;
select private.publish_event_vibe('27272727-0000-4000-8000-0000000000e1', now() - interval '60 minutes');
select private.publish_event_vibe('27272727-0000-4000-8000-0000000000e2', now() - interval '60 minutes');
-- Waiting since that publish: 2 new raters on A (below the gate of 3),
-- 3 new raters on B (enough to publish).
select pg_temp.rate(n, 'e1', 1, now() - interval '30 minutes') from generate_series(7, 8) n;
select pg_temp.rate(n, 'e2', 1, now() - interval '30 minutes') from generate_series(7, 9) n;
-- C: guest 1 and guest 2 rated, never published.
select pg_temp.rate(1, 'e3', 3, now() - interval '20 minutes');
select pg_temp.rate(2, 'e3', 3, now() - interval '20 minutes');

-- Everything else personal, for guest 1 AND guest 2.
insert into public.check_ins (user_id, event_id, method, first_at, last_verified_at)
select g, e, 'code', now() - interval '2 hours', now() - interval '2 hours'
from unnest(array['27272727-9999-4999-8999-000000000001', '27272727-9999-4999-8999-000000000002']::uuid[]) g,
     unnest(array['27272727-0000-4000-8000-0000000000e1', '27272727-0000-4000-8000-0000000000e2']::uuid[]) e;
insert into public.check_in_attempts (user_id, event_id, result)
select g, '27272727-0000-4000-8000-0000000000e1', 'passed'
from unnest(array['27272727-9999-4999-8999-000000000001', '27272727-9999-4999-8999-000000000002']::uuid[]) g;
insert into public.heads_up_votes (user_id, event_id, tag, created_at)
select g, '27272727-0000-4000-8000-0000000000e1', 'overpriced', now() - interval '90 minutes'
from unnest(array['27272727-9999-4999-8999-000000000001', '27272727-9999-4999-8999-000000000002']::uuid[]) g;
insert into private.tag_reports (event_id, tag, reporter_id)
select '27272727-0000-4000-8000-0000000000e1', 'overpriced', g
from unnest(array['27272727-9999-4999-8999-000000000001', '27272727-9999-4999-8999-000000000002']::uuid[]) g;
insert into private.heads_up_bans (event_id, user_id, banned_by) values
  ('27272727-0000-4000-8000-0000000000e2', '27272727-9999-4999-8999-000000000001', '27272727-9999-4999-8999-0000000000a1'),
  ('27272727-0000-4000-8000-0000000000e2', '27272727-9999-4999-8999-000000000002', '27272727-9999-4999-8999-0000000000a1');
-- Moderation log: one row about guest 1 (with a note that names them), one
-- about guest 2; both by the admin.
insert into private.moderation_log (admin_id, action, event_id, target_user_id, reason, note) values
  ('27272727-9999-4999-8999-0000000000a1', 'remove_heads_ups', '27272727-0000-4000-8000-0000000000e2',
   '27272727-9999-4999-8999-000000000001', 'broke_tester_rules', 'Delete 1 targeted their ex'),
  ('27272727-9999-4999-8999-0000000000a1', 'remove_heads_ups', '27272727-0000-4000-8000-0000000000e2',
   '27272727-9999-4999-8999-000000000002', 'broke_tester_rules', 'note about guest 2');
-- Sign-in history (auth audit log) for guest 1 and guest 2.
insert into auth.audit_log_entries (id, payload, created_at, ip_address) values
  (gen_random_uuid(), '{"action":"login","actor_id":"27272727-9999-4999-8999-000000000001","actor_username":"delete-1@test.vibecheck.invalid"}', now(), '203.0.113.1'),
  (gen_random_uuid(), '{"action":"user_deleted","actor_id":"00000000-0000-0000-0000-000000000000","traits":{"user_id":"27272727-9999-4999-8999-000000000001"}}', now(), ''),
  (gen_random_uuid(), '{"action":"login","actor_id":"27272727-9999-4999-8999-000000000002","actor_username":"delete-2@test.vibecheck.invalid"}', now(), '203.0.113.2');

-- Supabase Auth's own rows for guest 1, as a real email sign-in leaves
-- them: an identity (holds the email), a session, its refresh token and a
-- one-time code. The delete must leave none of them (section 6).
insert into auth.identities (provider_id, user_id, identity_data, provider)
values ('27272727-9999-4999-8999-000000000001', '27272727-9999-4999-8999-000000000001',
        '{"sub":"27272727-9999-4999-8999-000000000001","email":"delete-1@test.vibecheck.invalid"}', 'email');
insert into auth.sessions (id, user_id)
values ('27272727-5555-4555-8555-000000000001', '27272727-9999-4999-8999-000000000001');
insert into auth.refresh_tokens (token, user_id, session_id, revoked)
values ('delete-test-refresh-token', '27272727-9999-4999-8999-000000000001',
        '27272727-5555-4555-8555-000000000001', false);
insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to)
values (gen_random_uuid(), '27272727-9999-4999-8999-000000000001', 'confirmation_token',
        'delete-test-token-hash', 'delete-1@test.vibecheck.invalid');

-- Guest 2's personal row counts before, to compare after.
create temp table guest2_before as
select (select count(*) from public.check_ins where user_id = '27272727-9999-4999-8999-000000000002')
     + (select count(*) from public.check_in_attempts where user_id = '27272727-9999-4999-8999-000000000002')
     + (select count(*) from public.ratings where user_id = '27272727-9999-4999-8999-000000000002')
     + (select count(*) from public.heads_up_votes where user_id = '27272727-9999-4999-8999-000000000002')
     + (select count(*) from private.tag_reports where reporter_id = '27272727-9999-4999-8999-000000000002')
     + (select count(*) from private.heads_up_bans where user_id = '27272727-9999-4999-8999-000000000002') as n;

-- ---- 1. Locked down (3), and the auth rows are really there (1) -------------
select ok((select prosecdef and proconfig @> array['search_path=""']
           from pg_proc where oid = 'public.delete_account(uuid)'::regprocedure),
  'delete_account is security definer with an empty search_path');
select ok(not has_function_privilege('anon', 'public.delete_account(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.delete_account(uuid)', 'execute'),
  'anon and signed-in app users can''t run delete_account at all');
select ok(has_function_privilege('service_role', 'public.delete_account(uuid)', 'execute'),
  'the service role (the Edge Function) can run delete_account');

select is((select count(*)::int from auth.identities where user_id = '27272727-9999-4999-8999-000000000001')
        + (select count(*)::int from auth.sessions where user_id = '27272727-9999-4999-8999-000000000001')
        + (select count(*)::int from auth.refresh_tokens where user_id = '27272727-9999-4999-8999-000000000001')
        + (select count(*)::int from auth.one_time_tokens where user_id = '27272727-9999-4999-8999-000000000001'),
  4, 'before: guest 1 has an identity, a session, a refresh token and a one-time code');

-- ---- 2. A signed-in guest can't use it, on anyone (3) -----------------------
select set_config('request.jwt.claims', '{"sub":"27272727-9999-4999-8999-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.delete_account('27272727-9999-4999-8999-000000000001') $$,
  '42501', null, 'guest 2 can''t delete guest 1');
select throws_ok(
  $$ select public.delete_account('27272727-9999-4999-8999-000000000002') $$,
  '42501', null, 'guest 2 can''t call it on themselves either (only through the Edge Function)');
reset role;
select ok(exists (select 1 from auth.users where id = '27272727-9999-4999-8999-000000000001'),
  'after the refused calls, guest 1 still exists');

-- ---- 3. Delete guest 1 as the service role (1) ------------------------------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
create temp table result as
  select public.delete_account('27272727-9999-4999-8999-000000000001') as v;
reset role;
select is((select v from result), '{"deleted": true, "events_republished": 2}'::jsonb,
  'answer: deleted, 2 published scores refreshed (A and B; C had none)');

-- ---- 4. Guest 1's rows are gone (5) -----------------------------------------
select ok(not exists (select 1 from auth.users where id = '27272727-9999-4999-8999-000000000001')
          and not exists (select 1 from public.profiles where id = '27272727-9999-4999-8999-000000000001'),
  'login and profile deleted');
select is((select count(*)::int from public.check_ins where user_id = '27272727-9999-4999-8999-000000000001')
        + (select count(*)::int from public.check_in_attempts where user_id = '27272727-9999-4999-8999-000000000001'),
  0, 'check-ins and check-in attempts deleted');
select is((select count(*)::int from public.ratings where user_id = '27272727-9999-4999-8999-000000000001')
        + (select count(*)::int from public.heads_up_votes where user_id = '27272727-9999-4999-8999-000000000001'),
  0, 'ratings and +1s deleted');
select is((select count(*)::int from private.tag_reports where reporter_id = '27272727-9999-4999-8999-000000000001')
        + (select count(*)::int from private.heads_up_bans where user_id = '27272727-9999-4999-8999-000000000001'),
  0, 'reports they made and their +1 ban deleted');
select is((select count(*)::int from auth.audit_log_entries
           where payload::text like '%27272727-9999-4999-8999-000000000001%'),
  0, 'their sign-in history (auth audit log, with email and IP) deleted');

-- ---- 5. Nobody else touched (3) ---------------------------------------------
select is(
  (select count(*) from public.check_ins where user_id = '27272727-9999-4999-8999-000000000002')
  + (select count(*) from public.check_in_attempts where user_id = '27272727-9999-4999-8999-000000000002')
  + (select count(*) from public.ratings where user_id = '27272727-9999-4999-8999-000000000002')
  + (select count(*) from public.heads_up_votes where user_id = '27272727-9999-4999-8999-000000000002')
  + (select count(*) from private.tag_reports where reporter_id = '27272727-9999-4999-8999-000000000002')
  + (select count(*) from private.heads_up_bans where user_id = '27272727-9999-4999-8999-000000000002'),
  (select n from guest2_before),
  'guest 2 keeps every row (check-ins, attempts, ratings, +1s, reports, ban)');
select is((select count(*)::int from auth.audit_log_entries
           where payload::text like '%27272727-9999-4999-8999-000000000002%'),
  1, 'guest 2''s sign-in history is kept');
select is((select count(*)::int from public.profiles where id::text like '27272727-9999-%'),
  12, 'the other 12 test profiles are all still there');

-- ---- 6. Stored nowhere (2) --------------------------------------------------
-- Every table in public and private, read whole as XML text: guest 1's id
-- must not appear anywhere (catches a table added later without a cascade).
select is_empty(
  $$ select n.nspname || '.' || c.relname
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'private') and c.relkind = 'r'
       and query_to_xml(format('select * from %I.%I', n.nspname, c.relname), false, false, '')::text
           like '%27272727-9999-4999-8999-000000000001%' $$,
  'guest 1''s id is stored in no public or private table');
-- The same scan over Supabase Auth's own tables, for the id AND the email
-- (identities and one-time codes hold the email). Tables this role may not
-- read are skipped (only auth.schema_migrations, which holds no user data).
select is_empty(
  $$ select n.nspname || '.' || c.relname
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'auth' and c.relkind = 'r'
       and has_table_privilege(c.oid, 'select')
       and query_to_xml(format('select * from %I.%I', n.nspname, c.relname), false, false, '')::text
           ~ '27272727-9999-4999-8999-000000000001|delete-1@test\.vibecheck\.invalid' $$,
  'neither guest 1''s id nor email is left in any auth table (identity, session, tokens, codes)');

-- ---- 7. Moderation log: no identity left (3) --------------------------------
select is((select count(*)::int from private.moderation_log
           where event_id = '27272727-0000-4000-8000-0000000000e2'
             and target_user_id is null and note is null
             and action = 'remove_heads_ups' and reason = 'broke_tester_rules'),
  1, 'the row about guest 1 keeps action and reason, loses the id and the note');
select ok(not exists (select 1 from private.moderation_log where note like '%Delete 1%'),
  'the note that named guest 1 is gone');
select is((select note from private.moderation_log
           where target_user_id = '27272727-9999-4999-8999-000000000002'),
  'note about guest 2', 'the row about guest 2 is unchanged');

-- ---- 8. Scores (5) ----------------------------------------------------------
select is((select raters from private.vibe_snapshots where event_id = '27272727-0000-4000-8000-0000000000e1'),
  5, 'A: guest 1 no longer counts (6 raters became 5)');
select is((select published_at from private.vibe_snapshots where event_id = '27272727-0000-4000-8000-0000000000e1'),
  now() - interval '60 minutes',
  'A: re-made as of its own moment, so the 2 waiting ratings stay unpublished');
select is((select raters from private.vibe_snapshots where event_id = '27272727-0000-4000-8000-0000000000e2'),
  8, 'B: published as of now with the 3 waiting ratings (5 + 3), as the gate allows');
select is((select published_at from private.vibe_snapshots where event_id = '27272727-0000-4000-8000-0000000000e2'),
  now(), 'B: published as of now');
select ok(not exists (select 1 from private.vibe_snapshots where event_id = '27272727-0000-4000-8000-0000000000e3'),
  'C: still no published score (one waiting rating is never published by deletion)');

-- ---- 9. Deleting an admin (2) -----------------------------------------------
set local role service_role;
select lives_ok($$ select public.delete_account('27272727-9999-4999-8999-0000000000a1') $$,
  'the service role can delete an admin account too');
reset role;
select ok((select created_by is null from public.events where id = '27272727-0000-4000-8000-0000000000e4')
          and not exists (select 1 from private.moderation_log where admin_id is not null
                          and event_id = '27272727-0000-4000-8000-0000000000e2')
          and (select banned_by is null from private.heads_up_bans
               where user_id = '27272727-9999-4999-8999-000000000002'),
  'their event stays without the creator link; log rows and bans lose the admin id');

-- ---- 10. Errors, and a locked login (3) ------------------------------------
set local role service_role;
select throws_ok($$ select public.delete_account('27272727-9999-4999-8999-000000000001') $$,
  'VCNFD', null, 'deleting the same person again: VCNFD');
-- VC-75: a login locked by the 18+ gate CAN be deleted now; its email
-- fingerprint mark stays (it isn't linked to the login).
select lives_ok($$ select public.delete_account('27272727-9999-4999-8999-0000000000f0') $$,
  'a login locked by the 18+ gate can be deleted (VC-75)');
reset role;
select ok(not exists (select 1 from auth.users where id = '27272727-9999-4999-8999-0000000000f0')
          and exists (select 1 from private.age_gate_refusals where email_hmac = private.age_refusal_email_hmac('delete-locked@test.vibecheck.invalid')),
  'the locked login is gone and only its email fingerprint mark is kept');

select * from finish();
rollback;
