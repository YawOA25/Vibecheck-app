-- =============================================================================
-- Migration: every path that deletes a login also deletes its sign-in
-- history (cto must-fix on VC-74/VC-75).
--
-- Plain-language background:
-- * Supabase Auth keeps a sign-in history next to each login: the audit log
--   (auth.audit_log_entries; each entry can hold the email and IP address)
--   and half-finished sign-ins (auth.flow_state). Neither is linked to the
--   login with "on delete cascade", so deleting the login leaves them behind.
-- * delete_account (VC-B13) already cleaned them up, but three other paths
--   deleted logins without doing so: the under-13 refusal and the "no email"
--   refusal in complete_profile, and the 12-month cleanup. A child's email
--   could survive in the audit log, the very thing VC-74 exists to prevent.
--
-- What this migration does:
--   1. private.delete_login_traces(user id): ONE helper that deletes a
--      login's audit-log entries (matched by its id OR its email) and its
--      flow_state rows. Callers run it just BEFORE deleting the login, so it
--      can still read the email.
--   2. complete_profile, the 12-month cleanup and delete_account now all call
--      it. (Same bodies as 20261028130000_age_refusal_hmac.sql otherwise.)
--   3. A one-time sweep removes history rows already left behind by logins
--      that no longer exist.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The shared helper.
-- -----------------------------------------------------------------------------
create function private.delete_login_traces(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: deletes a login's sign-in history: audit-log entries that
    name it (by id, or by its email), and its half-finished sign-ins.
  Input: p_user_id, the login about to be deleted. Call this BEFORE deleting
    the login: the email is read from auth.users. (Called after, it still
    removes everything matched by id.)
  Returns: nothing.
  Why: these rows have no cascade, and they hold the plain email and the IP
    address. Every path that deletes a login must remove them (cto, VC-75).
  Why security definer: app users can't touch the auth schema.
*/
declare
  -- The login's email, trimmed and lowercased (null if already gone).
  v_email text;
begin
  if p_user_id is null then
    return;
  end if;
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = p_user_id;

  -- Audit entries look like {"actor_id", "actor_username" (the email),
  -- "traits": {"user_id", "user_email"}, ...}; any of them may be present.
  delete from auth.audit_log_entries a
  where a.payload ->> 'actor_id' = p_user_id::text
     or a.payload -> 'traits' ->> 'user_id' = p_user_id::text
     or (v_email is not null and (
           lower(a.payload ->> 'actor_username') = v_email
        or lower(a.payload -> 'traits' ->> 'user_email') = v_email));

  delete from auth.flow_state f where f.user_id = p_user_id;
end;
$$;

comment on function private.delete_login_traces(uuid) is
  'VC-75 cto fix: deletes a login''s audit-log entries (by id or email) and flow_state rows. Call just before deleting the login.';

revoke execute on function private.delete_login_traces(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2a. complete_profile (version 4): both refusal paths that delete the login
-- now delete its sign-in history first.
-- -----------------------------------------------------------------------------
create or replace function public.complete_profile(p_display_name text, p_birthdate date)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: takes the signed-in person's name and date of birth and
  either creates their profile (18+) or refuses and records the refusal.
  Inputs:
    p_display_name - the name other people will see (1 to 40 characters after
                     trimming spaces).
    p_birthdate    - their date of birth. Since VC-74 the app asks for it
                     BEFORE the email, and sends it here only for 18+ dates;
                     this check stays the one that counts.
  Returns: 'created', 'refused_locked' (13-17) or 'refused_deleted' (under
  13), or raises VCLCK / VCDUP / VCDOB / VCNAM / 42501 (see the VC-30
  migration for each).
  Privacy rule: no message raised here contains the birthdate or the email.
*/
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(p_display_name);
  v_today date := private.age_gate_today();
  -- The caller's email fingerprint (null if the login has no email).
  v_hmac text;
begin
  -- 1. Must be signed in.
  if v_user_id is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;

  -- 2. One answer at a time per login (see VC-30).
  perform pg_advisory_xact_lock(hashtext('vc_age_gate'), hashtext(v_user_id::text));

  -- 3. The login must still exist (a deleted login's token can live an
  --    hour). Its email is fingerprinted at once; the plain email is never
  --    stored anywhere by this function.
  select private.age_refusal_email_hmac(u.email) into v_hmac
  from auth.users u where u.id = v_user_id;
  if not found then
    raise exception 'Please sign in again.' using errcode = '42501';
  end if;

  -- 4. Refused before? This compares the EMAIL's fingerprint, so it also
  --    catches a new login made with the same email after the old one was
  --    deleted (VC-75). Same wording as before.
  if v_hmac is not null
     and exists (select 1 from private.age_gate_refusals r where r.email_hmac = v_hmac) then
    raise exception 'VibeCheck is for people 18 and older.' using errcode = 'VCLCK';
  end if;

  -- 5. One profile per login, so the birthdate can't be changed later.
  if exists (select 1 from public.profiles p where p.id = v_user_id) then
    raise exception 'Your profile is already set up.' using errcode = 'VCDUP';
  end if;

  -- 6. The birthdate must be a real past date (fixed message, no date in it).
  if p_birthdate is null or p_birthdate > v_today or p_birthdate < date '1900-01-01' then
    raise exception 'Please enter a valid date of birth.' using errcode = 'VCDOB';
  end if;

  -- 7a. Under 13: delete the login at once and keep nothing (VC-30).
  if not private.is_at_least_age(p_birthdate, v_today, 13) then
    -- Sign-in history first (it holds the email; see the top of this file).
    perform private.delete_login_traces(v_user_id);
    delete from auth.users u where u.id = v_user_id;
    return 'refused_deleted';
  end if;

  -- 7b. 13 to 17: keep the login (so the person can still see the "sorry"
  --     screen and ask to be deleted) and store the fingerprint mark.
  --     Returning normally (not raising) keeps the mark saved.
  if not private.is_at_least_18(p_birthdate, v_today) then
    if v_hmac is null then
      -- No email to fingerprint (not possible with email sign-in): nothing
      -- could hold the lock, so keep nothing at all, as for under 13.
      perform private.delete_login_traces(v_user_id);
      delete from auth.users u where u.id = v_user_id;
      return 'refused_deleted';
    end if;
    -- "on conflict do nothing": a mark for this email already exists only
    -- if step 4 missed it in a race, and then the older mark stands.
    insert into private.age_gate_refusals (email_hmac) values (v_hmac)
    on conflict (email_hmac) do nothing;
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

-- -----------------------------------------------------------------------------
-- 2b. The 12-month cleanup: each expired login's history goes with it.
-- -----------------------------------------------------------------------------
create or replace function private.purge_expired_age_refusals(p_now timestamptz default now())
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: removes everything about refusals older than the retention
    period (12 months):
      a. any login WITHOUT a profile whose email matches an expired mark
         (the locked login, if the person never deleted it);
      b. the expired marks themselves.
  Inputs: p_now - "now"; tests pass a later date. The daily job uses the
    default.
  Returns: how many marks were removed.
  Safety: a login with a profile is never deleted here.
*/
declare
  v_cutoff timestamptz := p_now - private.age_refusal_retention();
  v_key text;
  v_count integer;
  -- One expired, profile-less login at a time (see step a).
  v_login uuid;
begin
  -- Nothing expired: stop early, without even reading the key.
  if not exists (select 1 from private.age_gate_refusals r where r.refused_at < v_cutoff) then
    return 0;
  end if;

  -- Read the key once, then fingerprint each profile-less login with it.
  v_key := private.age_refusal_hmac_key();

  -- a. Logins first, while the marks that identify them still exist. Each
  --    login's sign-in history (which holds its email) goes with it.
  for v_login in
    select u.id from auth.users u
    where not exists (select 1 from public.profiles p where p.id = u.id)
      and exists (
        select 1 from private.age_gate_refusals r
        where r.refused_at < v_cutoff
          and r.email_hmac = private.hmac_email(u.email, v_key)
      )
  loop
    perform private.delete_login_traces(v_login);
    delete from auth.users u where u.id = v_login;
  end loop;

  -- b. Then the marks.
  delete from private.age_gate_refusals r where r.refused_at < v_cutoff;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function private.purge_expired_age_refusals(timestamptz) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2c. delete_account: uses the shared helper (before the login delete).
-- -----------------------------------------------------------------------------
create or replace function public.delete_account(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: deletes one person's account and every personal row tied to
    it, then fixes the published scores of the events they rated.
  Input: p_user_id, the person to delete. Only the delete-account Edge
    Function calls this, with the id from the person's own verified token.
  Returns: {"deleted": true, "events_republished": N}.
  Since VC-75: a login locked by the 18+ gate (13-17) can be deleted too.
    Its refusal mark is an email fingerprint, not linked to the login, so it
    stays for its 12 months and the same email is still refused if it comes
    back. Nothing else about the person is kept.
  Raises: 22023 (no id), VCNFD (no such login).
*/
declare
  v_events uuid[];
  v_event uuid;
  v_republished integer := 0;
begin
  if p_user_id is null then
    raise exception 'No account given.' using errcode = '22023';
  end if;

  -- a. The per-person rating lock (no rating can sneak in meanwhile).
  perform pg_advisory_xact_lock(hashtext('vibecheck.rating:' || p_user_id::text));

  -- Hold the login row; a second, racing deletion waits and then gets VCNFD.
  perform 1 from auth.users u where u.id = p_user_id for update;
  if not found then
    raise exception 'That account no longer exists.' using errcode = 'VCNFD';
  end if;

  -- b. The events this person rated, sorted (fixed lock order below).
  select coalesce(array_agg(distinct r.event_id order by r.event_id), '{}')
  into v_events
  from public.ratings r
  where r.user_id = p_user_id;

  -- c. Moderation log: no identity left behind.
  update private.moderation_log m
  set target_user_id = null, note = null
  where m.target_user_id = p_user_id;
  update private.moderation_log m
  set admin_id = null
  where m.admin_id = p_user_id;

  -- d. Sign-in history with no cascade (holds the email and IP address),
  --    through the shared helper, while the login (and so its email) is
  --    still there to match on.
  perform private.delete_login_traces(p_user_id);

  -- e. The login; cascades remove the profile and every personal row.
  delete from auth.users u where u.id = p_user_id;

  -- f. Fix the scores, after the rows are gone (lock order).
  foreach v_event in array v_events loop
    if exists (select 1 from private.vibe_snapshots s where s.event_id = v_event) then
      perform private.republish_vibe_after_moderation(v_event);
      v_republished := v_republished + 1;
    end if;
  end loop;

  return jsonb_build_object('deleted', true, 'events_republished', v_republished);
end;
$$;

-- Rights again, explicitly (create or replace keeps them; two locks).
revoke execute on function public.complete_profile(text, date) from public, anon;
grant execute on function public.complete_profile(text, date) to authenticated;
revoke execute on function public.delete_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 3. One-time sweep: history rows whose login no longer exists. A row is
-- removed only when BOTH hold:
--   a. it names at least one real login id (a well-formed uuid that is not
--      all zeros), and
--   b. NONE of the ids it names (actor_id, traits.user_id) is a login that
--      still exists.
-- Why the all-zeros case matters (cto): Supabase records admin and service
-- actions with actor_id 00000000-0000-0000-0000-000000000000. That id is
-- never in auth.users, so without these two rules an admin action ABOUT a
-- live user (traits.user_id = that user) would look "orphaned" and be
-- deleted. Rows naming no real id at all are left alone.
-- -----------------------------------------------------------------------------
delete from auth.audit_log_entries a
where (
    (a.payload ->> 'actor_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and a.payload ->> 'actor_id' <> '00000000-0000-0000-0000-000000000000')
    or
    (a.payload -> 'traits' ->> 'user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and a.payload -> 'traits' ->> 'user_id' <> '00000000-0000-0000-0000-000000000000')
  )
  and not exists (
    select 1 from auth.users u
    where u.id::text in (a.payload ->> 'actor_id', a.payload -> 'traits' ->> 'user_id')
  );

delete from auth.flow_state f
where f.user_id is not null
  and not exists (select 1 from auth.users u where u.id = f.user_id);
