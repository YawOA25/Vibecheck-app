-- =============================================================================
-- Migration (Q8a debt): match login ids in the sign-in history without
-- caring about capital letters.
--
-- Plain-language background:
-- * 20261028210000_delete_login_traces.sql deletes a login's sign-in history
--   (auth.audit_log_entries, auth.flow_state). It finds audit entries by
--   comparing the login id written in each entry's JSON with the login's id.
-- * Postgres writes ids in lower case ("29a0..."), and so does Supabase
--   today. But the comparison was exact text, so an entry that ever held the
--   same id in CAPITALS ("29A0...") would not match:
--     - delete_login_traces would leave that entry behind (it holds the
--       email and IP address);
--     - the one-time sweep would think a LIVE user's entry was orphaned and
--       delete it (it compared capitals with the lower-case auth.users id).
--   Harmless today (no capitals exist), but cheap to make airtight.
--
-- What this migration does:
--   1. delete_login_traces again, with lower() on both sides of every id
--      comparison (the email comparisons already used lower()). Same
--      inputs, same result for lower-case ids, same rights.
--   2. The sweep becomes a locked-down helper,
--      private.sweep_orphan_login_traces(), also lower()-wrapped, so a test
--      can check it; it is run once here (re-running it is safe: it only
--      removes rows whose login is gone).
-- No table changes. No data changes beyond history rows of deleted logins.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The shared helper, with case-proof id matching.
-- -----------------------------------------------------------------------------
create or replace function private.delete_login_traces(p_user_id uuid)
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
  Q8a: ids are compared in lower case on BOTH sides, so an entry that wrote
    the id in capitals is still found.
  Why security definer: app users can't touch the auth schema.
*/
declare
  -- The login's email, trimmed and lowercased (null if already gone).
  v_email text;
  -- The login's id as lower-case text (uuid::text is already lower case;
  -- lower() keeps the rule obvious and symmetric).
  v_id text;
begin
  if p_user_id is null then
    return;
  end if;
  v_id := lower(p_user_id::text);
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = p_user_id;

  -- Audit entries look like {"actor_id", "actor_username" (the email),
  -- "traits": {"user_id", "user_email"}, ...}; any of them may be present.
  delete from auth.audit_log_entries a
  where lower(a.payload ->> 'actor_id') = v_id
     or lower(a.payload -> 'traits' ->> 'user_id') = v_id
     or (v_email is not null and (
           lower(a.payload ->> 'actor_username') = v_email
        or lower(a.payload -> 'traits' ->> 'user_email') = v_email));

  -- flow_state.user_id is a real uuid column: no text case to worry about.
  delete from auth.flow_state f where f.user_id = p_user_id;
end;
$$;

comment on function private.delete_login_traces(uuid) is
  'VC-75 cto fix (Q8a: ids matched case-insensitively): deletes a login''s audit-log entries (by id or email) and flow_state rows. Call just before deleting the login.';

revoke execute on function private.delete_login_traces(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. The orphan sweep, as a helper, with case-proof id matching.
-- -----------------------------------------------------------------------------
create function private.sweep_orphan_login_traces()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: removes sign-in history rows whose login no longer exists.
    An audit entry is removed only when BOTH hold:
      a. it names at least one real login id (a well-formed uuid, any
         capitals, that is not all zeros), and
      b. NONE of the ids it names (actor_id, traits.user_id) is a login that
         still exists, compared in lower case on both sides (Q8a).
    flow_state rows are removed when their login is gone.
  Why the all-zeros rule (cto, VC-75): Supabase records admin and service
    actions with actor_id 00000000-0000-0000-0000-000000000000. That id is
    never in auth.users, so without rules a and b an admin action ABOUT a
    live user would look orphaned and be deleted.
  Inputs: none. Returns: how many rows were removed (audit + flow_state).
  Why security definer: app users can't touch the auth schema.
*/
declare
  v_audit integer;
  v_flow integer;
begin
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
      where lower(u.id::text) in (lower(a.payload ->> 'actor_id'),
                                  lower(a.payload -> 'traits' ->> 'user_id'))
    );
  get diagnostics v_audit = row_count;

  delete from auth.flow_state f
  where f.user_id is not null
    and not exists (select 1 from auth.users u where u.id = f.user_id);
  get diagnostics v_flow = row_count;

  return v_audit + v_flow;
end;
$$;

comment on function private.sweep_orphan_login_traces() is
  'Q8a: removes audit-log and flow_state rows whose login no longer exists (ids matched case-insensitively; all-zeros admin id ignored).';

revoke execute on function private.sweep_orphan_login_traces() from public, anon, authenticated;

-- Run the sweep once now (safe to repeat).
select private.sweep_orphan_login_traces();
