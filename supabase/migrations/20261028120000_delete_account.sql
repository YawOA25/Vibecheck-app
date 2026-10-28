-- =============================================================================
-- Migration: account deletion (task VC-B13). Apple requires that people can
-- delete their account from inside the app.
--
-- How deletion works, end to end:
--   1. The app's Settings screen asks twice, then calls the `delete-account`
--      Edge Function (supabase/functions/delete-account) with the person's
--      login token.
--   2. The Edge Function checks that token with Supabase Auth and takes the
--      user id ONLY from it (never from anything the app sends), then calls
--      public.delete_account(that id) with the service role. The service key
--      lives only in the Edge Function's Supabase secrets.
--   3. public.delete_account (this file) does everything in ONE transaction,
--      so it all happens or none of it does:
--        a. waits for the person's rating lock, so they can't save a rating
--           halfway through;
--        b. notes which events they rated (those scores must be fixed);
--        c. blanks them out of the moderation log (see below);
--        d. deletes their auth.users row. Every personal table points at it
--           with "on delete cascade" (profiles; and through profiles:
--           check_ins, check_in_attempts, ratings, heads_up_votes,
--           tag_reports (reports they made), heads_up_bans, and the age-gate
--           mark), so one delete removes them all. Columns that only say
--           which ADMIN did something (events.created_by,
--           hidden_event_tags.hidden_by, heads_up_bans.banned_by,
--           moderation_log.admin_id) are set to null instead, so the
--           decision stays but the person doesn't;
--        e. deletes their auth sign-in history (audit log, PKCE state),
--           which holds their email and IP address and has no cascade;
--        f. republishes each affected event's score (see "Scores" below).
--   4. The app then signs out on the phone and clears what it kept locally.
--
-- Who can call it: ONLY the service role (the Edge Function). Signed-in app
-- users and anon can't run it at all, so nobody can pass someone else's id.
-- pgTAP test 027 proves that; the Edge Function's own test proves it uses the
-- token's id.
--
-- Moderation log ("keeps no personal identity once the user is gone"):
-- rows ABOUT the person (target_user_id) lose the id AND the admin's free
-- note, because a note like "this is Ava's ex" could name them. The action,
-- the reason code and the time stay, so the record of what was decided
-- remains. Rows where the person was the ADMIN lose the admin id only; their
-- note is about another guest's rating, not about them.
--
-- Scores (the founder's rule: stay private AND correct): the deleted
-- person's ratings must stop counting, so each event they rated is
-- republished. It goes through the SAME path an admin hide uses,
-- private.republish_vibe_after_moderation, rather than calling
-- publish_event_vibe "as of now", because:
--   * publishing as of now could release 1 or 2 OTHER guests' ratings that
--     are still waiting below the 3-rater publish gate (VC-51/VC-64). The
--     score would then move by exactly those ratings, which tells a watcher
--     roughly what those 1 or 2 people gave. A single waiting rating must
--     never be published on its own;
--   * that path re-makes the snapshot as of its OWN earlier moment while 1 or
--     2 ratings are waiting (so they keep waiting), and as of now otherwise
--     (0 waiting, or 3+, which the gate would publish anyway);
--   * it takes the per-event publish lock, the same lock submit_rating takes.
-- Accepted limit (the same as an admin hide, already in the README): the
-- change in the score shows roughly what the deleted rating was. The person
-- has left, and their rating can't be tied back to them any more.
-- Lock order (lesson from VC-47): rows are deleted FIRST, then each event's
-- publish lock is taken, in event-id order. submit_rating holds a rating row
-- and then waits for the publish lock, so taking locks the other way round
-- could deadlock; the fixed order also stops two deletions blocking each
-- other.
--
-- Not deleted on purpose:
--   * a login locked by the 18+ gate (ages 13-17, VC-30). Its only stored
--     mark is the login id and a time, kept 12 months so "type an older year"
--     doesn't work, then purged automatically. Deleting the login here would
--     delete the mark early. Refused with code VCLCK. Those logins can't
--     reach Settings anyway (they only see the "sorry" screen). Open question
--     for legal: whether such a person may still ask for early deletion.
--   * events an admin created: they are public listings, not personal data.
--     Only the creator link is blanked.
--
-- Errors raised:
--   22023  no user id given
--   VCNFD  no such login (already deleted)
--   VCLCK  the login is locked by the 18+ gate (see above)
-- =============================================================================

create function public.delete_account(p_user_id uuid)
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
    Function calls this, with the id it read from the person's own verified
    login token.
  Returns: {"deleted": true, "events_republished": N}, N being how many of
    the person's rated events had a published score that was refreshed.
  Why `security definer`: it has to delete from auth.users and the private
    tables, which no app role may touch. search_path is empty so every name
    below is written out in full and can't be swapped for a look-alike.
  Raises: 22023 (no id), VCNFD (no such login), VCLCK (locked by the 18+
    gate; see the file header).
*/
declare
  v_events uuid[];
  v_event uuid;
  v_republished integer := 0;
begin
  if p_user_id is null then
    raise exception 'No account given.' using errcode = '22023';
  end if;

  -- a. The same per-person lock submit_rating takes first. While we hold it,
  --    this person can't save or update a rating, so the event list below
  --    can't miss one.
  perform pg_advisory_xact_lock(hashtext('vibecheck.rating:' || p_user_id::text));

  -- `for update` holds the login row, so two deletions of the same person
  -- can't both run (the second waits, then finds nothing: VCNFD).
  perform 1 from auth.users u where u.id = p_user_id for update;
  if not found then
    raise exception 'That account no longer exists.' using errcode = 'VCNFD';
  end if;

  -- The 18+ gate's lock mark must live out its 12 months (file header).
  if exists (select 1 from private.age_gate_refusals a where a.user_id = p_user_id) then
    raise exception 'This account can''t be deleted from the app.' using errcode = 'VCLCK';
  end if;

  -- b. The events whose score this person's ratings fed, sorted so the
  --    publish locks below are always taken in the same order.
  select coalesce(array_agg(distinct r.event_id order by r.event_id), '{}')
  into v_events
  from public.ratings r
  where r.user_id = p_user_id;

  -- c. Moderation log: no identity left behind (file header).
  update private.moderation_log m
  set target_user_id = null, note = null
  where m.target_user_id = p_user_id;
  update private.moderation_log m
  set admin_id = null
  where m.admin_id = p_user_id;

  -- d. The login itself. The cascades remove the profile and every personal
  --    row; admin-only links become null (file header).
  delete from auth.users u where u.id = p_user_id;

  -- e. Sign-in history with no cascade: the auth audit log (each entry holds
  --    the email and IP address) and any half-finished PKCE sign-in.
  delete from auth.audit_log_entries a
  where a.payload ->> 'actor_id' = p_user_id::text
     or a.payload -> 'traits' ->> 'user_id' = p_user_id::text;
  delete from auth.flow_state f where f.user_id = p_user_id;

  -- f. Fix the scores, AFTER the rows are gone (lock order, file header).
  --    The helper does nothing for an event with no published score yet.
  foreach v_event in array v_events loop
    if exists (select 1 from private.vibe_snapshots s where s.event_id = v_event) then
      perform private.republish_vibe_after_moderation(v_event);
      v_republished := v_republished + 1;
    end if;
  end loop;

  return jsonb_build_object('deleted', true, 'events_republished', v_republished);
end;
$$;

comment on function public.delete_account(uuid) is
  'VC-B13: deletes one account and all its personal rows in one transaction, blanks it out of the moderation log, then republishes the scores of the events it rated (holding back waiting ratings below the gate). Service role only (the delete-account Edge Function).';

-- Only the service role (the Edge Function) may run it. Revoking from public
-- also removes the default "anyone may run a new function" right, so anon and
-- signed-in app users can't call it, even with their own id.
revoke execute on function public.delete_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;
