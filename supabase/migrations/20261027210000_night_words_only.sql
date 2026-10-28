-- =============================================================================
-- Migration 30: the "All night" view shows WORDS ONLY (cto review of VC-54).
-- Follows 20261027200000_score_visuals.sql, which is already on the dev
-- project, so this file replaces private.published_vibe instead of editing
-- that file.
--
-- The problem, in plain words: the night score was a plain average sent
-- together with its exact count ("112 ratings tonight"). Plain average x
-- count = the sum of every rating. Compare two snapshots whose counts differ
-- by one (an admin hiding a rating, or a guest editing theirs after the
-- night's 5 AM end, when no new ratings dilute the change) and the
-- difference in sums IS that one person's rating. The 0-or-5+ rule only
-- protects numbers within ONE snapshot, not across snapshots.
--
-- The fix: the app never gets the night's number.
--   * "night" keeps: label (the word: Quiet / Good / Hot / Fire), raters,
--     breakdown (the tile words) and over. "score" is gone.
--   * "night_average" (read by app builds from before VC-54 when quiet) is
--     always null now, so those builds stop showing a number.
--   * The word and tiles still follow the 0-or-5+ rule from 20261027200000
--     (they are left out whenever the night score would have been).
--   * The night score itself stays inside private.vibe_snapshots: the word
--     is worked out from it here and it never leaves the database.
-- A word is one of 4 buckets over 5+ ratings: one person's change moves the
-- word only at a bucket edge, and even then says only "up" or "down".
--
-- What this file changes: private.published_vibe(uuid, timestamptz) only.
-- =============================================================================

create or replace function private.published_vibe(p_event_id uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: the vibe the app shows, from the event's last published
  snapshot.
  Inputs: p_event_id (the event) and p_now (the moment; the app functions
    always pass the real time, tests pass a fixed one).
  Returns: JSON with
    state               'none'  no snapshot yet, or 0 raters in it;
                        'early' fewer than 5 raters in it (no number);
                        'stale' its newest rating is 90+ minutes old;
                        'live'  otherwise
    raters, here, score, label, minutes_since_last, reactions  (unchanged)
    night_average       always null since this file (older app builds read
                        it; the night's number never leaves the database)
  plus, only in 'live' and 'stale' (null otherwise):
    breakdown           VC-53 live tiles: {crowd, music, energy} words
    night               VC-54 "All night", WORDS ONLY:
                          label      the night's vibe word, or null when
                                     withheld (the 0-or-5+ rule)
                          raters     how many ratings the night holds
                          breakdown  the night's tile words, or null
                          over       true once the night's 5 AM New York
                                     has passed ("LAST NIGHT'S VIBE")
  Why: between publishes every answer is the same, so polling can't reveal
  one new rating (VC-51); and no average is ever sent next to its exact
  count for the night, so snapshots can't be subtracted (cto, VC-54).
*/
declare
  c_min_raters constant integer := 5;
  c_stale_after constant interval := interval '90 minutes';
  v_snap private.vibe_snapshots%rowtype;
  v_starts_at timestamptz;
  v_state text;
  v_shown boolean;
begin
  select * into v_snap from private.vibe_snapshots s where s.event_id = p_event_id;

  if not found or v_snap.raters = 0 then
    v_state := 'none';
  elsif v_snap.raters < c_min_raters then
    v_state := 'early';
  elsif v_snap.scored_at <= p_now - c_stale_after then
    v_state := 'stale';
  else
    v_state := 'live';
  end if;
  -- A number, the tiles, the tally and the night only in live and stale.
  v_shown := v_state in ('live', 'stale');

  select e.starts_at into v_starts_at from public.events e where e.id = p_event_id;

  return jsonb_build_object(
    'state', v_state,
    'raters', coalesce(v_snap.raters, 0),
    'here', private.event_here(p_event_id, p_now),
    'score', case when v_shown then v_snap.score end,
    'label', private.vibe_label(case when v_shown then v_snap.score end),
    -- Never sent any more (see the file header).
    'night_average', null,
    'minutes_since_last',
      case when v_snap.scored_at is not null
           then greatest(0, floor(extract(epoch from (p_now - v_snap.scored_at)) / 60))::int end,
    'reactions', case when v_shown then v_snap.reactions else '[]'::jsonb end,
    'breakdown', case when v_shown then private.vibe_breakdown(
        v_snap.crowd_average, v_snap.music_average, v_snap.energy_average) end,
    'night', case when v_shown then jsonb_build_object(
        -- The word only: night_average is null whenever the rule withheld it.
        'label', private.vibe_label(v_snap.night_average),
        'raters', coalesce(v_snap.night_raters, 0),
        'breakdown', private.vibe_breakdown(
          v_snap.night_crowd_average, v_snap.night_music_average, v_snap.night_energy_average),
        'over', p_now >= private.night_end(v_starts_at)) end
  );
end;
$$;

comment on function private.published_vibe(uuid, timestamptz) is
  'VC-51 + VC-53 + VC-54: the vibe the app sees, from the last published snapshot (state, raters, here, score, label, minutes_since_last, reactions, live tile words, and the "All night" view as words only). night_average is always null (cto: no night number leaves the database).';

-- "create or replace" keeps the old rights; say it again so this file stands
-- on its own: the app can never call this helper directly.
revoke execute on function private.published_vibe(uuid, timestamptz) from public, anon, authenticated;
