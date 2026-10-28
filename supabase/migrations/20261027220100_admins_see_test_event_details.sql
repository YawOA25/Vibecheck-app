-- =============================================================================
-- Migration: admins can also load a test event's vibe and heads-ups
-- (VC-63b, cto review fix).
--
-- The problem: 20261027220000_admins_read_test_events.sql let admins READ
-- test events, so the founder can now open "Jessy + Friends". But the
-- helper private.can_see_event() (first made in 20261027130000_vibe_score.sql)
-- still let only testers through. It guards get_event_vibe,
-- get_event_heads_ups and get_events_vibe (and the report and moderation
-- calls). So on a test event an admin would get "event not found" (VCNFD)
-- on the event page's vibe and heads-up cards, and the list would quietly
-- leave out the event's score.
--
-- The fix: the helper now uses private.can_read_test_events() (tester OR
-- admin), the same rule as the events read policy. "create or replace"
-- keeps the function's owner and grants exactly as they were (nobody but
-- the server functions may call it), and its security settings are
-- written out unchanged below.
--
-- What does NOT change: plain users still get VCNFD for a test event
-- (pgTAP test 024 proves it). Check-in and rating stay tester-only.
-- =============================================================================

create or replace function private.can_see_event(p_event_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: says whether the caller may see an event at all.
  Input: p_event_id.
  Returns: true when the event exists and is either a real event, or a test
    event and the caller is a tester or an admin (the same rule as the
    events table's read policy, VC-63b); false otherwise.
  Why: the server functions that show an event's vibe, heads-ups and
    reports must agree with what the caller can see in the list.
*/
begin
  return exists (
    select 1 from public.events e
    where e.id = p_event_id
      and (not e.is_test or private.can_read_test_events())
  );
end;
$$;

comment on function private.can_see_event(uuid) is
  'VC-B09, VC-63b: true when the event exists for the caller (test events only for testers and admins).';
