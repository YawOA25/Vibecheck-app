-- =============================================================================
-- Migration 6: lock a login after an under-18 answer (VC-30), plus a time-zone
-- fix for private.is_adult_user (cto follow-up from the VC-B03 review).
--
-- Plain-language background:
-- * Before this, the phone refused an under-18 birthdate by itself and never
--   told the server. Someone could then sign out, sign back in and simply type
--   an older year. Now EVERY answer goes to `complete_profile` and the server
--   decides.
-- * What the server does with an under-18 answer depends on the age, following
--   the legal-advisor's conditions (team/projects/vibecheck/legal/
--   vc30-minor-refusal-2026-10-26.md):
--     - under 13: the login itself (auth.users row, which holds the email) is
--       deleted at once, and nothing else is stored. US children's privacy law
--       (COPPA) says to keep nothing we don't need about a known child.
--     - 13 to 17: the login is kept, and a "refusal mark" is stored: ONLY the
--       login id, the time and the fixed reason 'under_18'. No birthdate, no
--       age, no email. Any later answer from that login is refused with the
--       code VCLCK, so retrying with another year doesn't work. The mark and
--       the login are deleted automatically after 12 months (see the cleanup
--       job at the bottom).
-- * Nothing else is written for a refused person: no profile, no other table.
-- * The birthdate is never put into an error message or a log line here.
--
-- Why `complete_profile` now RETURNS a value instead of raising an error for
-- under-18 answers: in Postgres, raising an error undoes everything the call
-- did. If the function stored the mark and then raised "under 18", the mark
-- would be undone too. So the refusal comes back as a normal answer
-- ('refused_locked' or 'refused_deleted') and the saved changes stay.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table: private.age_gate_refusals (the refusal marks)
-- In the `private` schema, which the app's Data API can't reach, and with every
-- right taken away from app users as a second lock. Only the server functions
-- below (running with the owner's rights) read or write it.
-- -----------------------------------------------------------------------------
create table private.age_gate_refusals (
  -- The login that answered under 18. Deleting the login deletes the mark
  -- (on delete cascade), which both the under-13 path and the 12-month
  -- cleanup rely on.
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- When the refusal happened. The 12-month cleanup counts from this.
  refused_at timestamptz not null default now(),
  -- Always 'under_18'. A fixed word on purpose: legal asked that the exact age
  -- (or an "under 13" flag) never be stored.
  reason text not null default 'under_18' check (reason = 'under_18')
);

comment on table private.age_gate_refusals is
  'VC-30: logins refused by the 18+ gate (ages 13-17). Only id, time and a fixed reason; no birthdate. Deleted with the login, and after 12 months.';
comment on column private.age_gate_refusals.user_id is 'The refused login (auth.users.id).';
comment on column private.age_gate_refusals.refused_at is 'When the under-18 answer was given. Cleanup counts from here.';
comment on column private.age_gate_refusals.reason is 'Always ''under_18''. The age itself is never stored.';

-- The cleanup job looks for old marks, so an index on the time keeps it fast.
create index age_gate_refusals_refused_at_idx on private.age_gate_refusals (refused_at);

-- Two locks: no rights for app users, and row-level security on with no
-- policy (which means "no rows for anyone but the owner").
revoke all on table private.age_gate_refusals from public, anon, authenticated;
alter table private.age_gate_refusals enable row level security;

-- -----------------------------------------------------------------------------
-- Helper: the retention period, in ONE place.
-- -----------------------------------------------------------------------------
create function private.age_refusal_retention()
returns interval
language sql
immutable
set search_path = ''
as $$
  /*
    What it does: says how long a refusal mark (and its login) is kept.
    Inputs: none.
    Returns: an interval, currently 12 months.
    Why a function: the legal-advisor suggested 12 months and the lawyer may
    change it. Changing this one line (in a new migration) changes the cleanup
    everywhere.
  */
  select interval '12 months';
$$;

comment on function private.age_refusal_retention() is
  'How long an age-gate refusal mark and its login are kept (VC-30, legal: 12 months).';

-- -----------------------------------------------------------------------------
-- Helper: the general "has reached this age" rule.
-- -----------------------------------------------------------------------------
create function private.is_at_least_age(p_birthdate date, p_today date, p_years integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  /*
    What it does: answers "on day p_today, has someone born on p_birthdate
    reached p_years years of age?"
    Inputs: p_birthdate, p_today, p_years (for example 13 or 18).
    Returns: true or false; false if any input is missing.
    Why: the same date maths as private.is_at_least_18 (leap-day babies count
    from 1 March in non-leap years), but for any age, because the gate now
    also needs "under 13".
    `make_interval(years => n)` builds "n years" from a number.
  */
  select coalesce(p_birthdate <= (p_today - make_interval(years => p_years))::date, false);
$$;

comment on function private.is_at_least_age(date, date, integer) is
  'True when someone born on p_birthdate is at least p_years old on p_today (same leap-day rule as is_at_least_18).';

-- -----------------------------------------------------------------------------
-- Fix (cto follow-up): private.is_adult_user used the UTC date.
-- It now uses the same New York date and the same rule as the sign-up gate,
-- so the two can never disagree (for example between 8 pm and midnight in
-- New York, when UTC is already "tomorrow").
-- `create or replace` keeps its existing rights and the policies that use it.
-- -----------------------------------------------------------------------------
create or replace function private.is_adult_user()
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
      -- Same rule and same "today" (New York date) as complete_profile.
      and private.is_at_least_18(p.birthdate, private.age_gate_today())
  );
$$;

comment on function private.is_adult_user() is
  'True when the caller has a profile and is 18 or older today (New York date, same rule as complete_profile). Used by RLS policies.';

-- -----------------------------------------------------------------------------
-- complete_profile, version 2.
-- The return type changes (void -> text), which `create or replace` can't do,
-- so the old version is dropped first. Its rights are set again below.
--
-- What it returns when it works normally:
--   'created'          the profile was made (18 or older)
--   'refused_locked'   13 to 17: refused, and the login is now locked
--   'refused_deleted'  under 13: refused, and the login was deleted
-- Errors (the call is undone; codes the app reads from `error.code`):
--   VCLCK  this login was refused before; no answer is accepted any more
--   VCDUP  this login already has a profile
--   VCDOB  birthdate missing, in the future, or before 1900
--   VCNAM  display name empty or longer than 40 characters
--   42501  not signed in, or the login no longer exists
-- (VCA18 from version 1 is no longer raised; the app still understands it.)
-- -----------------------------------------------------------------------------
drop function public.complete_profile(text, date);

create function public.complete_profile(p_display_name text, p_birthdate date)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: takes the signed-in person's name and date of birth and
  either creates their profile (18+) or refuses and records the refusal as
  the legal conditions say (see the top of this file).
  Inputs:
    p_display_name - the name other people will see (1 to 40 characters after
                     trimming spaces).
    p_birthdate    - their date of birth.
  Returns: 'created', 'refused_locked' or 'refused_deleted' (see above), or
  raises one of the listed error codes.
  Why `security definer`: app users can't write profiles, refusal marks or
  logins themselves. This function runs with the owner's rights and decides
  every value itself.
  Privacy rule: no message raised here contains the birthdate.
*/
declare
  -- The id of the person calling, read from their login token.
  v_user_id uuid := auth.uid();
  -- The name with spaces trimmed from both ends.
  v_name text := btrim(p_display_name);
  -- Today in New York (see the complete_profile migration).
  v_today date := private.age_gate_today();
begin
  -- 1. Must be signed in.
  if v_user_id is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;

  -- 2. Only one answer is handled at a time per login. Without this, someone
  --    could send an under-18 answer and an adult answer at the same instant
  --    and both might get through. pg_advisory_xact_lock makes the second
  --    call wait until the first one has finished; the lock is released when
  --    the call ends. The two numbers are just a label for "this login's age
  --    gate".
  perform pg_advisory_xact_lock(hashtext('vc_age_gate'), hashtext(v_user_id::text));

  -- 3. The login must still exist. A phone can hold a token for a login that
  --    was deleted a moment ago (the under-13 path), and the token stays
  --    valid for up to an hour.
  if not exists (select 1 from auth.users u where u.id = v_user_id) then
    raise exception 'Please sign in again.' using errcode = '42501';
  end if;

  -- 4. Refused before? Then no answer counts any more (VC-30).
  if exists (select 1 from private.age_gate_refusals r where r.user_id = v_user_id) then
    raise exception 'VibeCheck is for people 18 and older.' using errcode = 'VCLCK';
  end if;

  -- 5. One profile per login, so the birthdate can't be changed later.
  if exists (select 1 from public.profiles p where p.id = v_user_id) then
    raise exception 'Your profile is already set up.' using errcode = 'VCDUP';
  end if;

  -- 6. The birthdate must be a real past date (1900 catches typos like 0026).
  --    The message is fixed text: the date itself is never echoed back.
  if p_birthdate is null or p_birthdate > v_today or p_birthdate < date '1900-01-01' then
    raise exception 'Please enter a valid date of birth.' using errcode = 'VCDOB';
  end if;

  -- 7. The age checks come BEFORE the name check on purpose: an under-18
  --    answer must be recorded even if the name box was left empty.

  -- 7a. Under 13: delete the login straight away. That removes the email
  --     Supabase holds, and (by cascade) anything linked to it. Nothing else
  --     is stored, not even a mark. The person can come back with another
  --     email; legal accepted that trade-off.
  if not private.is_at_least_age(p_birthdate, v_today, 13) then
    delete from auth.users u where u.id = v_user_id;
    return 'refused_deleted';
  end if;

  -- 7b. 13 to 17: keep the login and store the refusal mark (id, time and
  --     the fixed reason only). Returning normally (not raising) is what
  --     keeps the mark saved; see the top of this file.
  if not private.is_at_least_18(p_birthdate, v_today) then
    insert into private.age_gate_refusals (user_id) values (v_user_id);
    return 'refused_locked';
  end if;

  -- 8. Adults only from here. The name must be 1 to 40 characters.
  if v_name is null or char_length(v_name) not between 1 and 40 then
    raise exception 'Please enter a name of 1 to 40 characters.' using errcode = 'VCNAM';
  end if;

  -- 9. Create the profile. role and is_tester take their safe defaults.
  insert into public.profiles (id, display_name, birthdate)
  values (v_user_id, v_name, p_birthdate);
  return 'created';
end;
$$;

comment on function public.complete_profile(text, date) is
  'VC-B03/VC-30: creates the caller''s profile if 18+ (New York date). Returns created | refused_locked (13-17, login locked) | refused_deleted (under 13, login deleted). Errors: VCLCK locked, VCDUP done, VCDOB bad date, VCNAM bad name, 42501 not signed in.';

-- Signed-in users only (two locks, as before).
revoke execute on function public.complete_profile(text, date) from public, anon;
grant execute on function public.complete_profile(text, date) to authenticated;

-- -----------------------------------------------------------------------------
-- age_gate_locked: lets the app ask "is MY login locked?"
-- -----------------------------------------------------------------------------
create function public.age_gate_locked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  /*
    What it does: answers "has the signed-in caller been refused by the age
    gate before?"
    Inputs: none; it uses auth.uid(), so people can only ask about themselves.
    Returns: true if a refusal mark exists for the caller, otherwise false.
    Why: after signing out and back in, or reinstalling the app, the phone
    has forgotten everything. This lets the app show the "sorry" screen again
    straight away instead of the form. It reveals nothing but a yes or no
    about the caller's own login.
  */
  select exists (
    select 1 from private.age_gate_refusals r where r.user_id = auth.uid()
  );
$$;

comment on function public.age_gate_locked() is
  'VC-30: true when the caller''s login was refused by the 18+ gate.';

revoke execute on function public.age_gate_locked() from public, anon;
grant execute on function public.age_gate_locked() to authenticated;

-- -----------------------------------------------------------------------------
-- Cleanup: delete refused logins (and so their marks) after 12 months.
-- -----------------------------------------------------------------------------
create function private.purge_expired_age_refusals(p_now timestamptz default now())
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: deletes every login whose refusal mark is older than the
  retention period (12 months). The mark goes with it (on delete cascade).
  Inputs: p_now - "now"; the tests pass a date in the future to check the
  rule without waiting a year. The scheduled job leaves it at the default.
  Returns: how many logins were deleted.
  Why: legal condition 3. We keep the mark only long enough to stop the
  "just try again" trick, then keep nothing.
  Safety: a login that somehow has a profile is never deleted here.
*/
declare
  v_count integer;
begin
  delete from auth.users u
  using private.age_gate_refusals r
  where r.user_id = u.id
    and r.refused_at < p_now - private.age_refusal_retention()
    and not exists (select 1 from public.profiles p where p.id = u.id);
  -- ROW_COUNT is how many rows the delete just removed.
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function private.purge_expired_age_refusals(timestamptz) is
  'VC-30: deletes logins (and their refusal marks) older than private.age_refusal_retention(). Run daily by pg_cron.';

-- Only the server (and the scheduled job, which runs as the owner) runs these.
revoke execute on function private.purge_expired_age_refusals(timestamptz) from public, anon, authenticated;
revoke execute on function private.age_refusal_retention() from public, anon, authenticated;
revoke execute on function private.is_at_least_age(date, date, integer) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- The daily schedule. pg_cron is Postgres's built-in timer, available on the
-- free Supabase plan. Supabase asks for it to live in pg_catalog.
-- cron.schedule with a job name replaces any job of the same name, so
-- running this again is safe.
-- 04:17 UTC daily: a quiet hour, and an odd minute so it doesn't collide
-- with other jobs that start on the hour.
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'vc-purge-expired-age-refusals',
  '17 4 * * *',
  'select private.purge_expired_age_refusals()'
);
