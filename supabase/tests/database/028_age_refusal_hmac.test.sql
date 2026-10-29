-- =============================================================================
-- pgTAP test 28: the refusal mark is an HMAC fingerprint of the email, and an
-- age-locked login can be deleted (VC-75), migration
-- 20261028130000_age_refusal_hmac.sql.
--
-- What it checks, in plain words:
--   * The secret key exists in Vault, and the new helper functions are
--     locked down (security definer, empty search_path, no app user or
--     visitor may run them). App users can't read Vault.
--   * A 13-17 answer stores ONLY the fingerprint of the trimmed, lowercased
--     email: no plain email (or id) in any public or private table, and the
--     fingerprint isn't a plain unkeyed hash anyone could recompute.
--   * The locked person can delete their login: the login and every trace of
--     the email go, the fingerprint mark stays.
--   * Signing up again with the same email (different capitals) is refused:
--     "am I locked?" says yes and complete_profile gives VCLCK with the same
--     wording, even for an adult year. Other people are not affected.
--   * The 12-month cleanup removes the expired mark and the profile-less
--     login it matches, keeps newer marks and never deletes a login with a
--     profile. After that the email may answer again.
--   * Under 13 still keeps nothing, not even a fingerprint.
--
-- Everything runs inside BEGIN ... ROLLBACK, so nothing is kept. Only
-- made-up test accounts are used.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- ---- Setup (as the database owner) -----------------------------------------
-- 01 teen (will be locked, then deletes), 02 child, 03 adult bystander,
-- 04 adult with an old matching mark (must never be deleted by the cleanup).
insert into auth.users (id, email) values
  ('28282828-0000-4000-8000-000000000001', 'hmac-teen@test.vibecheck.invalid'),
  ('28282828-0000-4000-8000-000000000002', 'hmac-child@test.vibecheck.invalid'),
  ('28282828-0000-4000-8000-000000000003', 'hmac-adult@test.vibecheck.invalid'),
  ('28282828-0000-4000-8000-000000000004', 'hmac-profiled@test.vibecheck.invalid');
insert into public.profiles (id, display_name, birthdate) values
  ('28282828-0000-4000-8000-000000000004', 'Profiled', '1990-01-01');

-- Birthdates relative to today in New York (worked out as the owner).
create temporary table hmac_dates on commit drop as
select
  (private.age_gate_today() - interval '15 years')::date                    as age_15,
  (private.age_gate_today() - interval '13 years' + interval '1 day')::date as just_under_13;
grant select on hmac_dates to authenticated;

-- ---- 1. The key and the locks (5) -------------------------------------------
select is((select count(*)::int from vault.secrets where name = 'vc_age_refusal_hmac_key'),
  1, 'the HMAC key exists in Vault (created by the migration, value never written down)');
select ok(
  (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=""%')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in ('age_refusal_hmac_key', 'hmac_email', 'age_refusal_email_hmac',
                       'caller_age_refused', 'purge_expired_age_refusals')),
  'the new helpers are security definer with an empty search_path');
select ok(
  not has_function_privilege('authenticated', 'private.age_refusal_hmac_key()', 'execute')
  and not has_function_privilege('authenticated', 'private.age_refusal_email_hmac(text)', 'execute')
  and not has_function_privilege('authenticated', 'private.hmac_email(text, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.caller_age_refused()', 'execute'),
  'signed-in app users can''t run the key or fingerprint helpers');
select ok(
  not has_function_privilege('anon', 'private.age_refusal_hmac_key()', 'execute')
  and not has_function_privilege('anon', 'private.age_refusal_email_hmac(text)', 'execute')
  and not has_function_privilege('anon', 'private.hmac_email(text, text)', 'execute')
  and not has_function_privilege('anon', 'private.caller_age_refused()', 'execute'),
  'visitors (anon) can''t run them either');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"28282828-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select decrypted_secret from vault.decrypted_secrets $$,
  '42501', null, 'app users can''t read the key from Vault');

-- ---- 2. A 15-year-old: only a fingerprint is stored (5) --------------------
select set_config('request.jwt.claims',
  '{"sub":"28282828-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.complete_profile('Teen', (select age_15 from hmac_dates)),
  'refused_locked', 'a 15-year-old is refused and locked');
select is(public.age_gate_locked(), true, 'the app sees the lock');
reset role;
select is(
  (select count(*)::int from private.age_gate_refusals
   where email_hmac = private.age_refusal_email_hmac('  HMAC-Teen@Test.vibecheck.invalid ')),
  1, 'one mark, matched by the trimmed, lowercased email''s fingerprint');
-- Every public and private table, read whole as text: the email (any case)
-- and the login id appear nowhere. (The login itself still lives in
-- auth.users until the person deletes it or the 12 months run out.)
select is_empty(
  $$ select n.nspname || '.' || c.relname
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'private') and c.relkind = 'r'
       and query_to_xml(format('select * from %I.%I', n.nspname, c.relname), false, false, '')::text
           ~* 'hmac-teen@test\.vibecheck\.invalid|28282828-0000-4000-8000-000000000001' $$,
  'no plain email or login id is stored in any public or private table');
-- A plain SHA-256 of the email could be recomputed by anyone who guesses the
-- email; the mark must be keyed.
select ok(
  not exists (select 1 from private.age_gate_refusals
              where email_hmac = encode(extensions.digest('hmac-teen@test.vibecheck.invalid', 'sha256'), 'hex')),
  'the mark is keyed (it is not a plain hash of the email)');

-- ---- 3. The locked teen deletes their login (4) -----------------------------
set local role service_role;
select lives_ok($$ select public.delete_account('28282828-0000-4000-8000-000000000001') $$,
  'a locked login can be deleted (the Blocked screen''s "Delete my account")');
reset role;
select is_empty($$ select id from auth.users where id = '28282828-0000-4000-8000-000000000001' $$,
  'the locked login is gone');
select is_empty(
  $$ select n.nspname || '.' || c.relname
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('auth', 'public', 'private') and c.relkind = 'r'
       and has_table_privilege(c.oid, 'select')
       and query_to_xml(format('select * from %I.%I', n.nspname, c.relname), false, false, '')::text
           ~* 'hmac-teen@test\.vibecheck\.invalid|28282828-0000-4000-8000-000000000001' $$,
  'after deletion the plain email and the id are stored nowhere (auth, public, private)');
select isnt_empty(
  $$ select 1 from private.age_gate_refusals
     where email_hmac = private.age_refusal_email_hmac('hmac-teen@test.vibecheck.invalid') $$,
  'only the fingerprint mark is kept');

-- ---- 4. Signing up again with the same email is refused (4) ----------------
-- A new login (as if they asked for a new email code), in different capitals.
insert into auth.users (id, email) values
  ('28282828-0000-4000-8000-000000000011', 'HMAC-Teen@test.vibecheck.invalid');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"28282828-0000-4000-8000-000000000011","role":"authenticated"}', true);
select is(public.age_gate_locked(), true,
  'the sign-in check: a new login with a refused email is locked at once');
select throws_ok($$ select public.complete_profile('Teen', '1990-01-01') $$,
  'VCLCK', 'VibeCheck is for people 18 and older.',
  'a re-sign-up with an adult year is refused, with the same wording');
select is_empty($$ select id from public.profiles where id = '28282828-0000-4000-8000-000000000011' $$,
  'and no profile is made');
select set_config('request.jwt.claims',
  '{"sub":"28282828-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(public.complete_profile('Ava', '1995-05-05'), 'created',
  'someone with a different email is not affected');

-- ---- 5. The 12-month cleanup (4) --------------------------------------------
reset role;
-- Make the teen's mark 13 months old, add a 13-month-old mark matching the
-- adult with a profile, and a fresh mark for another email.
update private.age_gate_refusals set refused_at = now() - interval '13 months'
where email_hmac = private.age_refusal_email_hmac('hmac-teen@test.vibecheck.invalid');
insert into private.age_gate_refusals (email_hmac, refused_at) values
  (private.age_refusal_email_hmac('hmac-profiled@test.vibecheck.invalid'), now() - interval '13 months'),
  (private.age_refusal_email_hmac('hmac-recent@test.vibecheck.invalid'), now() - interval '1 month');
-- `>= 2`: the shared dev database could hold other expired marks too.
select cmp_ok(private.purge_expired_age_refusals(), '>=', 2,
  'the cleanup removes the expired marks');
select ok(
  not exists (select 1 from private.age_gate_refusals
              where email_hmac = private.age_refusal_email_hmac('hmac-teen@test.vibecheck.invalid'))
  and not exists (select 1 from auth.users where id = '28282828-0000-4000-8000-000000000011'),
  'the expired mark and the profile-less login it matched are gone');
select ok(
  exists (select 1 from auth.users where id = '28282828-0000-4000-8000-000000000004')
  and exists (select 1 from private.age_gate_refusals
              where email_hmac = private.age_refusal_email_hmac('hmac-recent@test.vibecheck.invalid')),
  'a login with a profile is never deleted, and a newer mark is kept');
-- After the 12 months the email may answer again.
insert into auth.users (id, email) values
  ('28282828-0000-4000-8000-000000000012', 'hmac-teen@test.vibecheck.invalid');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"28282828-0000-4000-8000-000000000012","role":"authenticated"}', true);
select is(public.complete_profile('Teen grown up', '1990-01-01'), 'created',
  'once the mark has expired, the same email can sign up as an adult');

-- ---- 6. Under 13 keeps nothing, not even a fingerprint (2) -----------------
select set_config('request.jwt.claims',
  '{"sub":"28282828-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(public.complete_profile('Kid', (select just_under_13 from hmac_dates)),
  'refused_deleted', 'under 13: refused and the login deleted');
reset role;
select is_empty(
  $$ select 1 from private.age_gate_refusals
     where email_hmac = private.age_refusal_email_hmac('hmac-child@test.vibecheck.invalid') $$,
  'no fingerprint is kept for a child');

select * from finish();
rollback;
