-- =============================================================================
-- Migration 11: admins can see an event's party code again (proposal VC-35,
-- approved by the founder 2026-10-27).
--
-- Plain-language background:
-- * Each event has a secret 6-character party code (event_private, which no
--   app user can read). Until now an admin saw it only once: right after
--   creating the event, or right after "Get a new code". On the night, the
--   host may need it again (to write a new card, or read it out).
-- * This adds one small door, public.get_event_code(event_id), that hands
--   the CURRENT code to admins and refuses everyone else, the same way
--   create_event and update_event do (private.is_admin(), migration 7).
--
-- Safety rules:
-- * `security definer` (runs with the owner's rights, needed to read
--   event_private) with an empty search_path, so nobody can trick it into
--   using a look-alike table or function from another schema.
-- * The admin check comes first. Non-admins (including testers who aren't
--   admins) get error 42501 before anything is read. anon (not signed in)
--   can't even call it (grants at the bottom).
-- * Nothing is logged: no RAISE NOTICE, and the code is never put in an
--   error message. It is only the return value, to the admin who asked.
--
-- Error codes the app reads from `error.code`:
--   42501  not signed in, or not an admin
--   VCNFD  no event with that id
-- =============================================================================

create function public.get_event_code(p_event_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: returns an event's current party code, for admins only.
  Input: p_event_id, the event's id.
  Returns: the 6-character code, e.g. 'K7MX2Q' (the newest one, if it was
  rotated).
  Why: hosts need the code again on the night, and event_private is
  unreadable to every app user by design (VC-20). This lets admins, and only
  admins, read that one value.
*/
declare
  v_code text;
begin
  -- 1. Admins only. Checked before reading anything, so a refused caller
  --    can't even learn whether the event exists.
  if not private.is_admin() then
    raise exception 'Only admins can see the party code.' using errcode = '42501';
  end if;

  -- 2. Read the current code. Every event made by create_event has one.
  select ep.check_in_code into v_code
  from public.event_private ep
  where ep.event_id = p_event_id;
  if v_code is null then
    raise exception 'That event doesn''t exist.' using errcode = 'VCNFD';
  end if;

  return v_code;
end;
$$;

comment on function public.get_event_code(uuid) is
  'VC-35: admins only. Returns an event''s current party code. Refuses everyone else with 42501. Never logs.';

-- Who may run it: take away the default "everyone may run it", then let
-- signed-in users CALL it (the admin check inside decides). anon can't.
revoke execute on function public.get_event_code(uuid) from public, anon;
grant execute on function public.get_event_code(uuid) to authenticated;
