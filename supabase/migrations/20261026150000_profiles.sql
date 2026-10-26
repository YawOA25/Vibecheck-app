-- =============================================================================
-- Migration 1 of 4: the `private` helper schema and the `profiles` table.
-- Task: VC-B02 (schema and row-level security).
--
-- Plain-language background (read this first):
-- * Supabase exposes the `public` schema to the app through its Data API. The
--   app signs in as the database role `authenticated` (signed-in user) or
--   `anon` (not signed in). Those two roles are what every rule below limits.
-- * Row-level security (RLS) means "even if a role may read a table, it only
--   sees the rows a policy allows". A table with RLS on and NO policy shows
--   nothing to app users at all.
-- * Grants decide which tables and columns a role may touch at all. Supabase
--   gives `anon` and `authenticated` broad grants on new tables by default, so
--   every table here first revokes everything and then grants back only what
--   the app needs. Two locks are better than one.
-- * The `private` schema is NOT exposed by the Data API, so helper functions
--   placed there can be used inside policies but can't be called by the app
--   directly.
-- =============================================================================

-- The schema for helper functions that the app must not call directly.
create schema if not exists private;
comment on schema private is
  'Helper functions used by row-level security policies. Not exposed through the Data API.';

-- Signed-in users need USAGE on the schema so policies that call these helpers
-- work while their queries run. USAGE alone does not let them call anything;
-- each function grants EXECUTE separately below.
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Table: profiles
-- One row per person who finished sign-up (email code, then name and date of
-- birth). The row is created later by the `complete_profile` function (task
-- VC-B03), which refuses anyone under 18. So "has a profile" means "passed the
-- age gate".
-- -----------------------------------------------------------------------------
create table public.profiles (
  -- Same id as the Supabase login (auth.users). Deleting the login deletes the
  -- profile too (on delete cascade), which account deletion relies on.
  id uuid primary key references auth.users (id) on delete cascade,
  -- The name other people may see. 1 to 40 characters after trimming spaces.
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 40),
  -- Date of birth, used only for the 18+ rule. Never shown to other people.
  birthdate date not null,
  -- 'user' for everyone; 'admin' for the team members who create events.
  role text not null default 'user'
    check (role in ('user', 'admin')),
  -- Testers may use the tester check-in, but only on test events (VC-B07).
  is_tester boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per signed-up person (18+ only). Users read (all but birthdate) and rename their own row; role, tester flag and birthdate are server-only.';
comment on column public.profiles.id is 'The Supabase login id (auth.users.id).';
comment on column public.profiles.display_name is 'Public display name, 1-40 characters.';
comment on column public.profiles.birthdate is 'Date of birth for the 18+ gate. Private.';
comment on column public.profiles.role is '''user'' or ''admin''. Set only by SQL run by the team, never by the app.';
comment on column public.profiles.is_tester is 'True for test accounts (home testing, App Review). Set only by SQL run by the team.';
comment on column public.profiles.created_at is 'When the profile was created.';

-- Lock 1: grants. Remove Supabase's default broad access, then give back only:
--   * signed-in users may read the listed profile COLUMNS (RLS narrows the rows
--     to their own). birthdate is left out on purpose: even if a future policy
--     lets people see each other's profiles, birthdates can't leak. The app
--     must therefore name the columns it wants (`.select('id, display_name')`);
--     `select *` is refused because it includes birthdate.
--   * they may change ONLY the display_name column. Trying to change role,
--     is_tester, birthdate or id fails with "permission denied".
-- No INSERT or DELETE for the app: rows are created by complete_profile and
-- removed by account deletion, both of which run with server rights.
revoke all on table public.profiles from anon, authenticated;
grant select (id, display_name, role, is_tester, created_at)
  on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;

-- Lock 2: row-level security. Turn it on, then allow each user their own row only.
alter table public.profiles enable row level security;

-- Policy: a signed-in user can read only their own profile.
-- `(select auth.uid())` is the id of the person making the request. Wrapping it
-- in a sub-select lets Postgres work it out once per query instead of per row.
create policy "Users read their own profile"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

-- Policy: a signed-in user can update only their own profile, and can't move
-- the row to someone else's id ("with check" tests the row after the change).
create policy "Users update their own profile"
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Lock 3: a trigger, as a backstop in case a future grant is added by mistake.
-- If the app's roles (anon or authenticated) try to change a server-only column,
-- the update is refused. Server functions run as the table owner, so they are
-- not blocked by this check.
create function private.protect_profile_server_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
/*
  What it does: stops app users from changing server-only profile columns
  (id, role, is_tester, birthdate, created_at).
  Input: the old and new versions of the row being updated (Postgres passes
  them in automatically as OLD and NEW).
  Returns: the new row unchanged when the update is allowed.
  Why: column grants already block these columns. This trigger is a second
  lock so one wrong GRANT in the future can't let someone make themselves an
  admin or change their age.
*/
begin
  -- `current_user` is the database role running the update. For requests from
  -- the app it is 'authenticated' (or 'anon'). Server functions run as the owner.
  if current_user in ('anon', 'authenticated')
     and (
       new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.is_tester is distinct from old.is_tester
       or new.birthdate is distinct from old.birthdate
       or new.created_at is distinct from old.created_at
     ) then
    -- 42501 is Postgres's standard "insufficient privilege" error code.
    raise exception 'Only the server can change id, role, is_tester, birthdate or created_at'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function private.protect_profile_server_fields() is
  'Trigger backstop: app roles may not change id, role, is_tester, birthdate or created_at on profiles.';

create trigger protect_profile_server_fields
  before update on public.profiles
  for each row
  execute function private.protect_profile_server_fields();

-- -----------------------------------------------------------------------------
-- Helper functions for policies on other tables.
-- They are `security definer`, which means they run with the owner's rights, so
-- they can look at the caller's profile without tripping over the profiles RLS.
-- `set search_path = ''` makes every name inside fully spelled out
-- (public.profiles), so nobody can trick the function with a look-alike table.
-- -----------------------------------------------------------------------------

create function private.is_adult_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  /*
    What it does: answers "is the person making this request a signed-up
    adult?" (they have a profile and are 18 or older today).
    Inputs: none; it uses auth.uid(), the id of the signed-in caller.
    Returns: true or false (false when not signed in or no profile).
    Why: only signed-up adults may see events. Checking the birthdate again
    here (not only at sign-up) costs nothing and keeps the rule in one place.
  */
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      -- 18th birthday on or before today. The date is in the database's time
      -- zone (UTC); VC-B03 decides the exact time-zone rule at sign-up.
      and p.birthdate <= (current_date - interval '18 years')::date
  );
$$;

comment on function private.is_adult_user() is
  'True when the caller has a profile and is 18 or older today. Used by RLS policies.';

create function private.is_tester()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  /*
    What it does: answers "is the person making this request a tester?"
    Inputs: none; it uses auth.uid().
    Returns: true only when the caller's profile has is_tester = true.
    Why: testers (and the Apple reviewer account) may see test events, while
    everyone else sees only real events.
  */
  select coalesce(
    (select p.is_tester from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

comment on function private.is_tester() is
  'True when the caller''s profile is marked as a tester. Used by RLS policies.';

-- Functions are executable by everyone (PUBLIC) by default in Postgres.
-- Take that away, then allow only signed-in users (their policies need it).
revoke execute on function private.is_adult_user() from public, anon;
revoke execute on function private.is_tester() from public, anon;
revoke execute on function private.protect_profile_server_fields() from public, anon, authenticated;
grant execute on function private.is_adult_user() to authenticated;
grant execute on function private.is_tester() to authenticated;

-- Safety default for FUTURE functions in `public` (the server functions that
-- later tasks add, such as check_in and submit_rating).
-- Supabase's starting setup says "every new function in public may be run by
-- anon and authenticated". That is the wrong default for us: a forgotten
-- REVOKE would let a not-signed-in visitor call a write function. This line
-- changes the default so new functions created by the `postgres` role (which
-- runs our migrations) are NOT runnable by anon. Each later function then
-- grants EXECUTE to `authenticated` on purpose.
-- Note: Postgres only lets a per-schema rule remove privileges that the same
-- kind of rule added, so the "from public" part may have no effect there; the
-- catch-all pgTAP test in 001_security_setup.test.sql is the real guard and
-- fails if anon (directly or through PUBLIC) can run any write function.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon;
