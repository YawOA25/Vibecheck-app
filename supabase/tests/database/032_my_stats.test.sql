-- =============================================================================
-- pgTAP test 32: the Me screen's stats row (VC-81), migration
-- 20261029120000_my_stats.sql.
--
-- What it checks, in plain words:
--   * Locked down: get_my_stats is security definer with an empty
--     search_path; anon can't call it, signed-in people can.
--   * Nights out counts different event NIGHTS: two parties on Friday
--     night, plus one at 1 AM Saturday (still Friday's night), count once;
--     with a Wednesday night that makes 2.
--   * Ratings counts the caller's own ratings, without one an admin hid.
--   * Test events count only for testers (a plain guest's test-event
--     check-in and rating are left out; a tester's count includes them).
--   * Own rows only: guest 2 gets guest 2's numbers; the answer holds just
--     the three counts, never an id.
--   * Member since is the profile's created_at.
--   * A signed-in person with no profile is refused (42501).
--
-- Everything runs inside BEGIN ... ROLLBACK: nothing is kept.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

-- ---- Setup (as owner) -------------------------------------------------------
-- Guest 1 (the one we follow), guest 2, and guest 3 (a tester).
insert into auth.users (id, email)
select ('32323232-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'stats-' || n || '@test.vibecheck.invalid'
from generate_series(1, 3) n;
insert into public.profiles (id, display_name, birthdate, is_tester, role, created_at)
select ('32323232-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'Stats ' || n, current_date - interval '30 years', n = 3, 'user',
       '2026-09-01 12:00-04'::timestamptz + (n - 1) * interval '1 day'
from generate_series(1, 3) n;
-- Signed in, but never finished the profile (no row in profiles).
insert into auth.users (id, email) values
  ('32323232-9999-4999-8999-0000000000f0', 'stats-noprofile@test.vibecheck.invalid');

-- The events (New York times):
--   b1  Fri 9 Oct 10 PM       Friday night
--   b2  Fri 9 Oct 11:30 PM    Friday night too
--   b3  Sat 10 Oct 1 AM       still Friday night (the night ends at 5 AM)
--   b4  Wed 7 Oct 9 PM        Wednesday night
--   b5  Thu 8 Oct 9 PM        a TEST event
insert into public.events (id, title, area_label, starts_at, ends_at, is_test) values
  ('32323232-0000-4000-8000-0000000000b1', 'Stats 1', 'Shaw, DC', '2026-10-09 22:00-04', '2026-10-10 02:00-04', false),
  ('32323232-0000-4000-8000-0000000000b2', 'Stats 2', 'Shaw, DC', '2026-10-09 23:30-04', '2026-10-10 03:00-04', false),
  ('32323232-0000-4000-8000-0000000000b3', 'Stats 3', 'Shaw, DC', '2026-10-10 01:00-04', '2026-10-10 04:00-04', false),
  ('32323232-0000-4000-8000-0000000000b4', 'Stats 4', 'Shaw, DC', '2026-10-07 21:00-04', '2026-10-08 01:00-04', false),
  ('32323232-0000-4000-8000-0000000000b5', 'Stats 5', 'Shaw, DC', '2026-10-08 21:00-04', '2026-10-09 01:00-04', true);

-- Check-ins: guest 1 at all five; guest 2 at b1; guest 3 (tester) at b5.
insert into public.check_ins (user_id, event_id, method)
select '32323232-9999-4999-8999-000000000001'::uuid,
       ('32323232-0000-4000-8000-0000000000b' || n)::uuid, 'gps'
from generate_series(1, 5) n;
insert into public.check_ins (user_id, event_id, method) values
  ('32323232-9999-4999-8999-000000000002', '32323232-0000-4000-8000-0000000000b1', 'gps'),
  ('32323232-9999-4999-8999-000000000003', '32323232-0000-4000-8000-0000000000b5', 'tester');

-- Ratings: guest 1 rated b1, b2 (hidden by an admin), b4 and b5 (test);
-- guest 2 rated b1.
insert into public.ratings (user_id, event_id, crowd, music, energy, hidden_at) values
  ('32323232-9999-4999-8999-000000000001', '32323232-0000-4000-8000-0000000000b1', 3, 3, 3, null),
  ('32323232-9999-4999-8999-000000000001', '32323232-0000-4000-8000-0000000000b2', 1, 1, 1, now()),
  ('32323232-9999-4999-8999-000000000001', '32323232-0000-4000-8000-0000000000b4', 2, 2, 2, null),
  ('32323232-9999-4999-8999-000000000001', '32323232-0000-4000-8000-0000000000b5', 2, 3, 2, null),
  ('32323232-9999-4999-8999-000000000002', '32323232-0000-4000-8000-0000000000b1', 2, 2, 2, null);

-- ---- 1. Locked down (2) -----------------------------------------------------
select ok((select prosecdef and proconfig @> array['search_path=""']
           from pg_proc where oid = 'public.get_my_stats()'::regprocedure),
  'get_my_stats is security definer with an empty search_path');
select ok(not has_function_privilege('anon', 'public.get_my_stats()', 'execute')
          and has_function_privilege('authenticated', 'public.get_my_stats()', 'execute'),
  'anon can''t call get_my_stats; signed-in people can');

-- ---- 2. Guest 1, as the app calls it (5) ------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"32323232-9999-4999-8999-000000000001","role":"authenticated"}', true);
-- (No temp table here: the app role may not be allowed to make one, so
-- each check calls the function itself; it only reads, so every call
-- gives the same answer.)

select is((select (v ->> 'nights_out')::int from (select public.get_my_stats() as v) g), 2,
  'nights out: Friday''s three check-ins (1 AM included) count once, plus Wednesday; the test event is left out');
select is((select (v ->> 'ratings')::int from (select public.get_my_stats() as v) g), 2,
  'ratings: own ratings without the hidden one and the test event');
select is((select (v ->> 'member_since')::timestamptz from (select public.get_my_stats() as v) g), '2026-09-01 12:00-04'::timestamptz,
  'member since: the profile''s created_at');
select is((select array_agg(k order by k) from (select public.get_my_stats() as v) g, jsonb_object_keys(v) k),
  array['member_since', 'nights_out', 'ratings'],
  'the answer holds the three stats only');
select ok((select v::text !~ '32323232' from (select public.get_my_stats() as v) g),
  'no id appears in the answer');

-- ---- 3. Own rows only, and testers (2) --------------------------------------
select set_config('request.jwt.claims', '{"sub":"32323232-9999-4999-8999-000000000002","role":"authenticated"}', true);
select is((select jsonb_build_array(v -> 'nights_out', v -> 'ratings') from (select public.get_my_stats() as v) s),
  '[1, 1]'::jsonb,
  'guest 2 gets guest 2''s own counts only');
select set_config('request.jwt.claims', '{"sub":"32323232-9999-4999-8999-000000000003","role":"authenticated"}', true);
select is((select (public.get_my_stats() ->> 'nights_out')::int), 1,
  'a tester''s test-event check-in counts');

-- ---- 4. Refused (1) ---------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"32323232-9999-4999-8999-0000000000f0","role":"authenticated"}', true);
select throws_ok('select public.get_my_stats()', '42501', null,
  'a signed-in person with no profile is refused (42501)');
reset role;

select * from finish();
rollback;
