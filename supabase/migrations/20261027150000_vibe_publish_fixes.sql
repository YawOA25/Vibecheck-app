-- =============================================================================
-- Migration 21: two privacy fixes to the published vibe (VC-51, cto review).
-- Follows 20261027140200_vibe_publish_gate.sql, which is already on the dev
-- project, so this file replaces private.publish_event_vibe instead of
-- editing that file.
--
-- Fix 1, in plain words: publishing could go BACKWARDS.
--   publish_event_vibe didn't take the per-event lock that submit_rating
--   takes, and its save always overwrote the stored snapshot. If an admin
--   ran it by hand (after hiding a rating) at the same moment as a guest's
--   rating published, the older snapshot could land last and replace the
--   newer one. The next publish would then differ from what people saw by a
--   single rater: exactly the leak VC-51 exists to stop.
--   Now the function takes the same per-event lock itself (Postgres lets one
--   transaction take a lock it already holds, so submit_rating, which holds
--   it, is fine), and a snapshot only replaces one that is not newer.
--
-- Fix 2, in plain words: the night average could give away the OLDEST rating.
--   Left over from B09. Example: 6 raters, fewer than 5 of them in the last
--   3 hours. The shown score is the plain average of the 5 newest, and when
--   quiet the night average of all 6 is shown too. Then
--       6 x night average - 5 x score = the oldest person's rating.
--   Rounding to 1 decimal blurs this by at most about 0.55, but one rating
--   moves in steps of 1.67, so the rating can be read off exactly.
--   The general rule: the difference between the two numbers reveals the
--   ratings that are in the night average but NOT in the score. If that is
--   1 to 4 ratings, it is one person's rating or the average of very few.
--   So the night average is now kept only when the score leaves out NO
--   ratings (then both describe the same people) or 5 or more (then the
--   difference is an average of at least 5, the same floor as the score
--   itself). Otherwise it is left out and the app shows just "Quiet for
--   ...". We chose this over "only with 10+ raters" because it is exact: a
--   10-rater rule still leaks when, say, 11 of 12 are in the window and all
--   weigh the 0.25 floor (then the score is a plain average of 11).
--   Existing snapshots' night averages are cleared, to be safe; the next
--   publish at each event sets them under the new rule. (Republishing now
--   instead could publish a single pending rating, so we don't.)
--
-- Accepted limit (not fixed here, stated in the README): hiding a rating and
-- republishing changes the snapshot by that one rating, so anyone watching
-- can see roughly what the hidden rating was. It's the abuser's rating, and
-- only admins hide.
-- =============================================================================

create or replace function private.publish_event_vibe(p_event_id uuid, p_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: freezes the event's vibe as it stands at p_at and saves it as
  the event's published snapshot, unless a NEWER snapshot is already saved.
  Inputs: p_event_id (the event) and p_at (the moment; submit_rating passes
    the time of the save, an admin passes now(), tests pass a fixed one).
  Returns: nothing.
  Rules:
    - takes the per-event publish lock (the same one submit_rating takes),
      so two publishes for one event never run at the same time;
    - never replaces a newer snapshot with an older one (fix 1 above);
    - keeps the night average only when the score leaves out none, or 5 or
      more, of the night's visible ratings (fix 2 above).
  Why `security definer`: it reads every rating and writes the private
    table. It's in the private schema, so the app can't call it directly.
*/
declare
  v_vibe jsonb;
  v_last timestamptz;
  v_average numeric;
  v_raters integer;
  v_scored_at timestamptz;
  v_in_window integer;
  v_used integer;
  v_left_out integer;
begin
  -- One publisher per event at a time. Released when the transaction ends.
  perform pg_advisory_xact_lock(hashtext('vibecheck.vibe_publish:' || p_event_id::text));

  -- Everything the meter shows, worked out fresh at p_at.
  v_vibe := private.event_vibe(p_event_id, p_at);

  -- The newest included rating, the plain night average and the count.
  select max(r.updated_at), round(avg(r.score), 1), count(*)::int
  into v_last, v_average, v_raters
  from public.ratings r
  where r.event_id = p_event_id
    and r.hidden_at is null
    and r.updated_at <= p_at;

  -- Which moment the score was worked out at: event_vibe scores a quiet
  -- ('stale') event at its last rating, otherwise at p_at.
  v_scored_at := case when v_vibe ->> 'state' = 'stale' then v_last else p_at end;

  -- How many ratings the score used (private.vibe_score_at's rule): the
  -- 3-hour window when it holds 5 or more, otherwise the 5 newest.
  select count(*)::int into v_in_window
  from public.ratings r
  where r.event_id = p_event_id
    and r.hidden_at is null
    and r.updated_at <= v_scored_at
    and r.updated_at >= v_scored_at - interval '3 hours';
  v_used := case when v_in_window >= 5 then v_in_window else least(5, v_raters) end;
  -- The ratings in the night average but not in the score.
  v_left_out := v_raters - v_used;

  insert into private.vibe_snapshots as s
    (event_id, published_at, scored_at, raters, score, night_average, reactions)
  values (
    p_event_id,
    p_at,
    v_last,
    (v_vibe ->> 'raters')::int,
    (v_vibe ->> 'score')::numeric,
    -- Fix 2: only when the difference can't single out 1 to 4 ratings.
    case when v_left_out = 0 or v_left_out >= 5 then v_average end,
    coalesce(v_vibe -> 'reactions', '[]'::jsonb)
  )
  on conflict (event_id) do update
    set published_at = excluded.published_at,
        scored_at = excluded.scored_at,
        raters = excluded.raters,
        score = excluded.score,
        night_average = excluded.night_average,
        reactions = excluded.reactions
    -- Fix 1: never go back to an older snapshot.
    where s.published_at <= excluded.published_at;
end;
$$;

comment on function private.publish_event_vibe(uuid, timestamptz) is
  'VC-51: saves the event''s vibe at p_at as its published snapshot (totals only), under the per-event lock, never over a newer one; night_average only when the score leaves out 0 or 5+ ratings.';

-- Fix 2 for snapshots saved before this file: clear their night averages.
-- The next publish at each event sets them again under the new rule.
update private.vibe_snapshots set night_average = null;

-- "create or replace" keeps the old rights; say it again so this file stands
-- on its own: the app can never call this helper directly.
revoke execute on function private.publish_event_vibe(uuid, timestamptz) from public, anon, authenticated;
