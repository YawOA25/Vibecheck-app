-- =============================================================================
-- pgTAP test 1: the security setup itself (VC-B02).
--
-- What it checks, in plain words: every table has row-level security switched
-- on, the two secret tables have no policies, the not-signed-in role (`anon`)
-- can't touch any table, and signed-in users (`authenticated`) can only read,
-- plus rename themselves. It also has "catch-all" checks that scan the whole
-- `public` schema, so a table, view or function added later without the right
-- locks makes this test fail. It inspects the database's own permission
-- records, so it doesn't need any test data.
--
-- How tests run: everything happens inside BEGIN ... ROLLBACK, so nothing is
-- left behind in the database. `plan(n)` says how many checks to expect;
-- `finish()` reports any that were missing or extra.
-- =============================================================================
begin;

-- pgTAP lives in the `extensions` schema on Supabase. Creating it inside the
-- transaction means the ROLLBACK removes it again if it wasn't there before.
create extension if not exists pgtap with schema extensions;

select plan(33);

-- ---- 1. Row-level security is ON for all six tables (6 checks) -------------
select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'RLS is on for profiles');
select ok((select relrowsecurity from pg_class where oid = 'public.events'::regclass),
  'RLS is on for events');
select ok((select relrowsecurity from pg_class where oid = 'public.event_private'::regclass),
  'RLS is on for event_private');
select ok((select relrowsecurity from pg_class where oid = 'public.check_ins'::regclass),
  'RLS is on for check_ins');
select ok((select relrowsecurity from pg_class where oid = 'public.check_in_attempts'::regclass),
  'RLS is on for check_in_attempts');
select ok((select relrowsecurity from pg_class where oid = 'public.ratings'::regclass),
  'RLS is on for ratings');

-- ---- 2. The secret tables have NO policies, so RLS shows nothing (2) -------
select is((select count(*)::int from pg_policies
           where schemaname = 'public' and tablename = 'event_private'),
  0, 'event_private has no RLS policies');
select is((select count(*)::int from pg_policies
           where schemaname = 'public' and tablename = 'check_in_attempts'),
  0, 'check_in_attempts has no RLS policies');

-- ---- 3. `anon` (not signed in) has no table rights at all (6) --------------
-- has_table_privilege with a list is true if the role has ANY of them. The two
-- secret tables are checked against the FULL list of table rights (including
-- truncate = empty the table, references = point a foreign key at it, and
-- trigger = attach a trigger), because any right at all would be a leak.
select ok(not has_table_privilege('anon', 'public.profiles', 'select,insert,update,delete'),
  'anon has no rights on profiles');
select ok(not has_table_privilege('anon', 'public.events', 'select,insert,update,delete'),
  'anon has no rights on events');
select ok(not has_table_privilege('anon', 'public.event_private',
  'select,insert,update,delete,truncate,references,trigger'),
  'anon has no rights on event_private');
select ok(not has_table_privilege('anon', 'public.check_ins', 'select,insert,update,delete'),
  'anon has no rights on check_ins');
select ok(not has_table_privilege('anon', 'public.check_in_attempts',
  'select,insert,update,delete,truncate,references,trigger'),
  'anon has no rights on check_in_attempts');
select ok(not has_table_privilege('anon', 'public.ratings', 'select,insert,update,delete'),
  'anon has no rights on ratings');

-- ---- 4. Signed-in users can't write directly (6) ---------------------------
-- Writes happen only through server functions written in later tasks.
select ok(not has_table_privilege('authenticated', 'public.event_private',
  'select,insert,update,delete,truncate,references,trigger'),
  'authenticated has no rights on event_private (not even read)');
select ok(not has_table_privilege('authenticated', 'public.check_in_attempts',
  'select,insert,update,delete,truncate,references,trigger'),
  'authenticated has no rights on check_in_attempts (not even read)');
select ok(not has_table_privilege('authenticated', 'public.events', 'insert,update,delete'),
  'authenticated can''t write events directly');
select ok(not has_table_privilege('authenticated', 'public.check_ins', 'insert,update,delete'),
  'authenticated can''t write check_ins directly');
select ok(not has_table_privilege('authenticated', 'public.ratings', 'insert,update,delete'),
  'authenticated can''t write ratings directly');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'insert,delete'),
  'authenticated can''t create or delete profiles directly');

-- ---- 5. Profiles: only display_name is updatable by users (5) --------------
select ok(has_column_privilege('authenticated', 'public.profiles', 'display_name', 'update'),
  'authenticated may update display_name');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'role', 'update'),
  'authenticated may not update role');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'is_tester', 'update'),
  'authenticated may not update is_tester');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'birthdate', 'update'),
  'authenticated may not update birthdate');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'id', 'update'),
  'authenticated may not update id');

-- ---- 5b. Profiles: birthdate can't be read by app users (2) ----------------
-- Read access is granted column by column, leaving birthdate out.
select ok(has_column_privilege('authenticated', 'public.profiles', 'display_name', 'select'),
  'authenticated may read display_name');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'birthdate', 'select'),
  'authenticated may not read birthdate');

-- ---- 6. Helper functions can't be run by anon (2) --------------------------
select ok(not has_function_privilege('anon', 'private.is_adult_user()', 'execute'),
  'anon can''t run private.is_adult_user()');
select ok(not has_function_privilege('anon', 'private.is_tester()', 'execute'),
  'anon can''t run private.is_tester()');

-- ---- 7. Catch-all checks over the whole schema (4) -------------------------
-- These don't name tables. They list everything that breaks a rule and expect
-- an empty list, so they also catch things added by later tasks.

-- Any table in `public` with row-level security OFF would be readable through
-- the Data API by whoever has grants on it. 'r' = normal table, 'p' = a
-- partitioned table.
select is_empty(
  $$ select c.relname::text
     from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p')
       and not c.relrowsecurity $$,
  'every table in public has RLS on (catches tables added later)');

-- Views run with their owner's rights by default, which skips RLS, so a view
-- in `public` could expose rows the policies hide. We use none. 'v' = view,
-- 'm' = materialized view (a saved copy of a query's results).
select is_empty(
  $$ select c.relname::text
     from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('v', 'm') $$,
  'there are no views in public');

-- No function that can change data may be run by a not-signed-in visitor.
-- "Can change data" is approximated by VOLATILE (provolatile = 'v'), the
-- Postgres default; read-only helpers are declared STABLE or IMMUTABLE.
-- has_function_privilege also counts rights anon gets through PUBLIC.
-- Functions that belong to an installed extension are skipped (pg_depend
-- type 'e'), because they aren't ours.
select is_empty(
  $$ select p.oid::regprocedure::text
     from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and p.provolatile = 'v'
       and has_function_privilege('anon', p.oid, 'execute')
       and not exists (
         select 1 from pg_depend d
         where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
       ) $$,
  'anon can''t run any write (volatile) function in public or private');

-- No app role holds TRUNCATE, REFERENCES or TRIGGER on any table in public.
-- TRUNCATE matters most: it empties a table and skips row-level security.
-- The named checks above cover only the two secret tables for these rights;
-- this one covers every table, including ones added later.
select is_empty(
  $$ select r.rolname || ' on ' || c.relname
     from pg_class c
     cross join (values ('anon'), ('authenticated')) as r (rolname)
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p')
       and has_table_privilege(r.rolname, c.oid, 'truncate,references,trigger') $$,
  'anon and authenticated have no TRUNCATE, REFERENCES or TRIGGER on any public table');

select * from finish();
rollback;
