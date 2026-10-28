-- =============================================================================
-- Migration: admins can read test events (VC-63b, founder bug report
-- 2026-10-27: "when i create an event it doesnt not appesar on the screen").
--
-- The problem: the founder (role admin, not a tester) created "Jessy +
-- Friends" with the test switch on. The events read rule from
-- 20261026150100_events.sql only let TESTERS read test events, so the
-- founder's own new event was hidden from the founder.
--
-- The fix:
--   1. A new helper, private.can_read_test_events(): true for testers AND
--      for admins. (We add a new helper instead of letting signed-in users
--      run private.is_admin() directly: that one stays locked, as set in
--      20261026180000_admin_events.sql.)
--   2. The events read rule is replaced with one that uses the helper.
--
-- What does NOT change: plain users still never see test events (pgTAP test
-- 024 proves it), and the tester-only check-in, rating and scoring rules stay
-- tester-only. Admins can now SEE a test event; they can't check in to one
-- unless they are also testers.
-- =============================================================================

create function private.can_read_test_events()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  /*
    What it does: answers "may the person making this request see test
    events?"
    Inputs: none; it uses auth.uid(), the id of the signed-in caller.
    Returns: true when the caller's profile is a tester OR has role 'admin';
    false for everyone else, including people with no profile.
    Why: admins create the test events, so they must be able to see them
    (VC-63b). It is "security definer" so it can read the caller's profile
    row whatever the profile table's own rules say, like private.is_tester().
  */
  select coalesce(
    (select p.is_tester or p.role = 'admin' from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

comment on function private.can_read_test_events() is
  'True when the caller is a tester or an admin. Used by the events read rule (VC-63b).';

-- Functions are runnable by everyone by default in Postgres. Take that away,
-- then allow only signed-in users, because the read rule below runs as them.
revoke execute on function private.can_read_test_events() from public, anon;
grant execute on function private.can_read_test_events() to authenticated;

-- Swap the read rule. Drop and create happen in this one migration (one
-- transaction), so there is no moment with no rule at all.
drop policy "Adults read events; testers also read test events" on public.events;

-- Signed-up adults see real events; testers and admins also see test events.
-- `(select ...)` makes Postgres work each helper out once per query, not
-- once per row (Supabase's advice for fast rules).
create policy "Adults read events; testers and admins also read test events"
  on public.events
  for select
  to authenticated
  using (
    (select private.is_adult_user())
    and (not is_test or (select private.can_read_test_events()))
  );
