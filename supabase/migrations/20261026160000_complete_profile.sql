-- =============================================================================
-- Migration 5: the 18+ gate and `complete_profile`.
-- Task: VC-B03 (email sign-in and 18+ gate). Proposal VC-10 (18+ app with a
-- date-of-birth gate).
--
-- Plain-language background:
-- * After someone signs in with their email code, Supabase has a login for
--   them (a row in auth.users) but NO profile yet. Without a profile they
--   can't see events (see private.is_adult_user in the profiles migration).
-- * The app then asks for a name and date of birth and calls
--   `complete_profile`. That function creates the profile ONLY if the person
--   is 18 or older. So the age rule lives here, on the server, where a
--   hand-made request can't skip it. The app checks the age too, but only to
--   show the answer faster; the server's answer is the one that counts.
--
-- The exact age rule (decided in VC-B03):
-- * "18 or older" means: the date 18 years before today is on or after the
--   birthdate. Postgres does this with `today - interval '18 years'`.
-- * Leap-day birthdays (29 February): in a year without 29 February, the
--   person turns 18 on 1 March, not 28 February. That is the stricter of the
--   two common readings, so we never let someone in a day early. It falls out
--   of the date maths above on its own (see the pgTAP tests).
-- * "Today" is the calendar date in America/New_York. The MVP runs in the DMV
--   (proposal VC-22, and NYC next), which is all one time zone. Using a fixed
--   zone means the phone can't move the date by claiming another time zone.
--   The app uses the same zone (src/lib/age.ts) so both always agree.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper 1: today's date for the age gate.
-- -----------------------------------------------------------------------------
create function private.age_gate_today()
returns date
language sql
stable
set search_path = ''
as $$
  /*
    What it does: returns today's calendar date in New York.
    Inputs: none (it reads the database clock).
    Returns: a date, for example 2026-10-26.
    Why: the database clock runs in UTC. From 8 pm in New York (in summer),
    UTC is already "tomorrow", which would let someone in a few hours before
    their 18th birthday really starts where they live.
    `stable` means "same answer within one statement", which is true here.
  */
  select (now() at time zone 'America/New_York')::date;
$$;

comment on function private.age_gate_today() is
  'Today''s date in America/New_York, the day the 18+ gate counts from (VC-B03).';

-- -----------------------------------------------------------------------------
-- Helper 2: the age rule itself, as pure date maths.
-- -----------------------------------------------------------------------------
create function private.is_at_least_18(p_birthdate date, p_today date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  /*
    What it does: answers "on day p_today, has a person born on p_birthdate
    turned 18?"
    Inputs: p_birthdate (date of birth), p_today (the day to check).
    Returns: true if 18 or older; false if younger or if either date is missing.
    Why a separate function: it has no clock in it, so the tests can feed it
    fixed dates (leap days, exactly 18, one day short) and get the same answer
    every day of the year.
    `immutable` means "same inputs, same answer, always".
  */
  -- Example: p_today = 2026-10-26 gives 2008-10-26. Born on or before that
  -- day means 18 or older. Born 2008-10-27 means 17 years and 364 days: no.
  -- Leap day: p_today = 2026-02-28 gives 2008-02-28, and 2008-02-29 is later,
  -- so a leap-day baby is still 17 on 28 Feb and turns 18 on 1 March.
  -- coalesce turns a missing date (NULL) into a firm "no".
  select coalesce(p_birthdate <= (p_today - interval '18 years')::date, false);
$$;

comment on function private.is_at_least_18(date, date) is
  'True when someone born on p_birthdate is 18 or older on p_today. Leap-day birthdays count from 1 March in non-leap years.';

-- Only the server uses these helpers (from inside complete_profile, which runs
-- with the owner's rights). Nobody in the app needs to call them.
revoke execute on function private.age_gate_today() from public, anon, authenticated;
revoke execute on function private.is_at_least_18(date, date) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- complete_profile: the only way a profile gets created.
--
-- Error codes the app can rely on. Postgres lets us pick our own 5-character
-- codes ("SQLSTATE"); the app reads them from `error.code` and shows a
-- friendly message (src/lib/auth-errors.ts). Our codes start with "VC" so they
-- can't be confused with Postgres's own:
--   VCA18  under 18: no profile is created
--   VCNAM  display name empty or longer than 40 characters
--   VCDOB  birthdate missing, in the future, or before 1900
--   VCDUP  this login already has a profile (the birthdate can't be re-entered)
--   42501  not signed in (Postgres's standard "insufficient privilege")
-- -----------------------------------------------------------------------------
create function public.complete_profile(p_display_name text, p_birthdate date)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: creates the signed-in person's profile with their display
  name and date of birth, but only if they are 18 or older today.
  Inputs:
    p_display_name - the name other people will see (spaces at the ends are
                     trimmed; 1 to 40 characters must remain).
    p_birthdate    - their date of birth.
  Returns: nothing when it works. When it refuses, it raises an error with one
  of the codes listed above, and NO profile is saved.
  Why `security definer`: app users have no INSERT right on profiles (so they
  can't write their own birthdate or make themselves an admin). This function
  runs with the owner's rights instead, and it decides every column itself:
  role is always 'user' and is_tester is always false.
  Why `set search_path = ''`: every table name inside is written out in full
  (public.profiles), so nobody can trick it with a look-alike table.
*/
declare
  -- The id of the person calling. auth.uid() reads it from their login token.
  v_user_id uuid := auth.uid();
  -- The name with spaces trimmed from both ends.
  v_name text := btrim(p_display_name);
  -- Today in New York (see the top of this file).
  v_today date := private.age_gate_today();
begin
  -- 1. Must be signed in. (anon can't run this function at all, but a token
  --    without a user id must not get through either.)
  if v_user_id is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;

  -- 2. One profile per login. Refusing here also means nobody can come back
  --    later and type a different birthdate.
  if exists (select 1 from public.profiles p where p.id = v_user_id) then
    raise exception 'Your profile is already set up.' using errcode = 'VCDUP';
  end if;

  -- 3. The name must be 1 to 40 characters after trimming (the same rule as
  --    the table's check constraint; checked here to give a clear message).
  if v_name is null or char_length(v_name) not between 1 and 40 then
    raise exception 'Please enter a name of 1 to 40 characters.' using errcode = 'VCNAM';
  end if;

  -- 4. The birthdate must be a real past date. 1900 is a generous floor that
  --    catches typos such as year 0026.
  if p_birthdate is null or p_birthdate > v_today or p_birthdate < date '1900-01-01' then
    raise exception 'Please enter a valid date of birth.' using errcode = 'VCDOB';
  end if;

  -- 5. The 18+ gate (proposal VC-10). Nothing has been written yet, so
  --    refusing here leaves no profile behind.
  if not private.is_at_least_18(p_birthdate, v_today) then
    raise exception 'VibeCheck is for people 18 and older.' using errcode = 'VCA18';
  end if;

  -- 6. All checks passed: create the profile. role and is_tester take their
  --    safe defaults ('user', false); the caller can't choose them.
  insert into public.profiles (id, display_name, birthdate)
  values (v_user_id, v_name, p_birthdate);
end;
$$;

comment on function public.complete_profile(text, date) is
  'Creates the caller''s profile if they are 18+ (New York date). Errors: VCA18 under 18, VCNAM bad name, VCDOB bad date, VCDUP already has a profile.';

-- Who may run it: signed-in users only. The default-privileges rule from the
-- profiles migration should already keep anon out, but we say it explicitly
-- (two locks), and the catch-all test in 001_security_setup checks it.
revoke execute on function public.complete_profile(text, date) from public, anon;
grant execute on function public.complete_profile(text, date) to authenticated;
