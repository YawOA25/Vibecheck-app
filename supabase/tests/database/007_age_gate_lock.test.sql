-- =============================================================================
-- pgTAP test 7: the lock after an under-18 answer (VC-30) and the legal
-- conditions that came with it.
--
-- What it checks, in plain words:
-- * 13 to 17: the answer is refused, a refusal mark is stored (id, time and
--   'under_18' only, never the birthdate), and a retry with an adult year is
--   refused with VCLCK. The app can ask "am I locked?" about itself only.
-- * Under 13: the login itself is deleted at once and nothing is stored.
-- * App users can't read, change or delete the marks.
-- * Retention: marks (and their profile-less logins) older than 12 months
--   are deleted by the cleanup function, which pg_cron runs daily; newer ones
--   are kept. (Updated for VC-75: the mark is now an email fingerprint.)
-- * Adults are not affected, and is_adult_user now uses the New York date.
--
-- How "acting as a user" works: see 002_profiles.test.sql. Everything is
-- rolled back at the end, so no test data is left behind.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(39);

-- ---- Setup (as the database owner) -----------------------------------------
-- Logins with no profile yet (the state right after the email code), plus
-- three more used only by the retention checks.
insert into auth.users (id, email) values
  ('b0000000-0000-4000-8000-000000000001', 'teen@test.vibecheck.invalid'),
  ('b0000000-0000-4000-8000-000000000002', 'child@test.vibecheck.invalid'),
  ('b0000000-0000-4000-8000-000000000003', 'adult@test.vibecheck.invalid'),
  ('b0000000-0000-4000-8000-000000000004', 'just13@test.vibecheck.invalid'),
  ('b0000000-0000-4000-8000-000000000005', 'old-mark@test.vibecheck.invalid'),
  ('b0000000-0000-4000-8000-000000000006', 'old-mark-with-profile@test.vibecheck.invalid'),
  ('b0000000-0000-4000-8000-000000000007', 'recent-mark@test.vibecheck.invalid'),
  ('b0000000-0000-4000-8000-000000000008', 'evening@test.vibecheck.invalid');

-- Birthdates relative to today in New York, worked out now as the owner
-- (app users can't run private.age_gate_today()).
create temporary table lock_dates on commit drop as
select
  (private.age_gate_today() - interval '15 years')::date                     as age_15,
  (private.age_gate_today() - interval '13 years')::date                     as turns_13_today,
  (private.age_gate_today() - interval '13 years' + interval '1 day')::date  as just_under_13,
  (private.age_gate_today() - interval '18 years' + interval '1 day')::date  as just_under_18;
grant select on lock_dates to authenticated;

-- ---- 1. The mark's shape: no birthdate, ever (4 checks) --------------------
-- Since VC-75 the mark is an HMAC fingerprint of the email, not the login id
-- (see 028_age_refusal_hmac.test.sql for the fingerprint itself).
select columns_are('private', 'age_gate_refusals',
  array['email_hmac', 'refused_at', 'reason'],
  'the mark holds only the email fingerprint, the time and the reason (no birthdate, age, id or email)');
select col_is_pk('private', 'age_gate_refusals', 'email_hmac',
  'one mark per email fingerprint');
select is(
  (select count(*)::int from pg_constraint
   where conrelid = 'private.age_gate_refusals'::regclass and contype = 'f'),
  0, 'the mark is not linked to the login (deleting the login keeps it, VC-75)');
select throws_ok(
  $$ insert into private.age_gate_refusals (email_hmac, reason)
     values (repeat('a', 64), 'age_15') $$,
  '23514', null, 'the reason can only be the fixed word under_18');

-- ---- 2. A 15-year-old is refused and locked (7 checks) ----------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(public.age_gate_locked(), false, 'before answering, the login is not locked');
select is(
  public.complete_profile('Teen', (select age_15 from lock_dates)),
  'refused_locked', 'a 15-year-old is refused and locked');
select is(public.age_gate_locked(), true, 'the app can now see that this login is locked');

-- The "just try again" trick: same login, adult year.
select throws_ok(
  $$ select public.complete_profile('Teen', '1990-01-01') $$,
  'VCLCK', 'VibeCheck is for people 18 and older.',
  'a retry with an adult year is refused (and the message has no date in it)');
select throws_ok(
  $$ select public.complete_profile('Teen', (select just_under_13 from lock_dates)) $$,
  'VCLCK', null,
  'a retry with an under-13 year is also refused (the login is not deleted by retrying)');
select is_empty(
  $$ select id from public.profiles where id = 'b0000000-0000-4000-8000-000000000001' $$,
  'the refused teen has no profile');
select is(private.is_adult_user(), false, 'the refused teen can''t see events');

-- ---- 3. App users can't touch the marks (6 checks) --------------------------
select throws_ok($$ select * from private.age_gate_refusals $$,
  '42501', null, 'the teen can''t read the marks');
select throws_ok(
  $$ delete from private.age_gate_refusals $$,
  '42501', null, 'the teen can''t delete their own mark');
select throws_ok(
  $$ update private.age_gate_refusals set refused_at = now() - interval '5 years' $$,
  '42501', null, 'the teen can''t back-date their mark');
select throws_ok(
  $$ insert into private.age_gate_refusals (email_hmac) values (repeat('b', 64)) $$,
  '42501', null, 'the teen can''t lock someone else');
select throws_ok($$ select private.purge_expired_age_refusals() $$,
  '42501', null, 'the teen can''t run the cleanup');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select public.age_gate_locked() $$,
  '42501', null, 'a visitor who isn''t signed in can''t ask about locks');

-- ---- 4. What was stored for the teen, seen as the owner (3 checks) ---------
reset role;
select results_eq(
  $$ select reason from private.age_gate_refusals
     where email_hmac = private.age_refusal_email_hmac('teen@test.vibecheck.invalid') $$,
  $$ values ('under_18'::text) $$,
  'exactly one mark, with the fixed reason');
select ok(
  (select refused_at between now() - interval '1 minute' and now() + interval '1 minute'
   from private.age_gate_refusals where email_hmac = private.age_refusal_email_hmac('teen@test.vibecheck.invalid')),
  'the mark is timestamped now');
select is(
  (select count(*)::int from auth.users where id = 'b0000000-0000-4000-8000-000000000001'),
  1, 'a 13-17 login is kept (so the lock holds after signing back in)');

-- ---- 5. Exactly 13 today is locked, not deleted (2 checks) -----------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(
  public.complete_profile('Thirteen', (select turns_13_today from lock_dates)),
  'refused_locked', 'someone whose 13th birthday is today is locked (13-17 rule)');
select is(public.age_gate_locked(), true, 'and their login is locked');

-- ---- 6. Under 13: the login is deleted and nothing is kept (5 checks) ------
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  public.complete_profile('Kid', (select just_under_13 from lock_dates)),
  'refused_deleted', 'one day short of 13: refused and the login is deleted');
-- The phone may still hold a token for the deleted login. It gets nowhere.
select throws_ok(
  $$ select public.complete_profile('Kid', '1990-01-01') $$,
  '42501', 'Please sign in again.',
  'a retry with the old token is refused: the login no longer exists');

reset role;
select is_empty(
  $$ select id from auth.users where id = 'b0000000-0000-4000-8000-000000000002' $$,
  'the child''s login (and the email it held) is gone');
select is_empty(
  $$ select 1 from private.age_gate_refusals where email_hmac = private.age_refusal_email_hmac('child@test.vibecheck.invalid') $$,
  'no mark is kept for the child');
select is_empty(
  $$ select id from public.profiles where id = 'b0000000-0000-4000-8000-000000000002' $$,
  'no profile is kept for the child');

-- ---- 7. Adults are unaffected (4 checks) ------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(public.complete_profile('Ava', '1995-05-05'), 'created',
  'an adult''s profile is created');
select is(public.age_gate_locked(), false, 'an adult is never locked');
select is(private.is_adult_user(), true, 'the adult can see events');
reset role;
select is_empty(
  $$ select 1 from private.age_gate_refusals where email_hmac = private.age_refusal_email_hmac('adult@test.vibecheck.invalid') $$,
  'no mark is written for an adult');

-- ---- 8. Retention: 12 months, then everything goes (5 checks) --------------
-- As the owner: one mark 13 months old (no profile), one 13 months old whose
-- login somehow has a profile (must be left alone), one 11 months old.
insert into private.age_gate_refusals (email_hmac, refused_at) values
  (private.age_refusal_email_hmac('old-mark@test.vibecheck.invalid'), now() - interval '13 months'),
  (private.age_refusal_email_hmac('old-mark-with-profile@test.vibecheck.invalid'), now() - interval '13 months'),
  (private.age_refusal_email_hmac('recent-mark@test.vibecheck.invalid'), now() - interval '11 months');
insert into public.profiles (id, display_name, birthdate) values
  ('b0000000-0000-4000-8000-000000000006', 'Safe', '1990-01-01');

select is(private.age_refusal_retention(), interval '12 months',
  'the retention period is 12 months');
-- `>= 1` rather than `= 1`: the shared dev database could, in theory, hold
-- other expired marks, and they would be (rightly) counted too.
select cmp_ok(private.purge_expired_age_refusals(), '>=', 1,
  'the cleanup reports what it deleted');
select is_empty(
  $$ select id from auth.users where id = 'b0000000-0000-4000-8000-000000000005' $$,
  'a 13-month-old refused login is deleted, and its mark with it');
select is(
  (select count(*)::int from private.age_gate_refusals
   where email_hmac in (private.age_refusal_email_hmac('teen@test.vibecheck.invalid'),
                        private.age_refusal_email_hmac('recent-mark@test.vibecheck.invalid'))),
  2, 'newer marks are kept');
-- The expired mark of a login that has a profile goes, but the login stays.
select ok(
  exists (select 1 from auth.users where id = 'b0000000-0000-4000-8000-000000000006')
  and not exists (select 1 from private.age_gate_refusals
                  where email_hmac = private.age_refusal_email_hmac('old-mark-with-profile@test.vibecheck.invalid')),
  'a login with a profile is never deleted by the cleanup (its expired mark is)');
select is(
  (select count(*)::int from cron.job
   where jobname = 'vc-purge-expired-age-refusals'
     and command = 'select private.purge_expired_age_refusals()'),
  1, 'pg_cron runs the cleanup on a schedule');

-- Deleting a login (for example account deletion) KEEPS its mark since
-- VC-75, so the same email is still refused for the rest of the 12 months.
delete from auth.users where id = 'b0000000-0000-4000-8000-000000000001';
select isnt_empty(
  $$ select 1 from private.age_gate_refusals where email_hmac = private.age_refusal_email_hmac('teen@test.vibecheck.invalid') $$,
  'deleting the login keeps its email fingerprint mark');

-- ---- 9. is_adult_user uses the New York date (1 check) ---------------------
-- A profile one day short of 18 by the New York date. With the old UTC rule
-- this passed during New York evenings (UTC is already tomorrow).
insert into public.profiles (id, display_name, birthdate) values
  ('b0000000-0000-4000-8000-000000000008', 'Eve', (select just_under_18 from lock_dates));
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000008","role":"authenticated"}', true);
select is(private.is_adult_user(), false,
  'one day short of 18 (New York date) is not an adult user, whatever the UTC date');
reset role;

select * from finish();
rollback;
