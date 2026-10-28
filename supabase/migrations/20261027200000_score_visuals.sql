-- =============================================================================
-- Migration 29: the data behind the new score visuals (VC-53 breakdown
-- tiles and VC-54 "Live / All night" switch). Approved by the founder
-- 2026-10-27 (decision list item 13, then "approve as recommended": the
-- switch says "All night" and the night ends at 5 AM New York).
-- Follows 20261027150000_vibe_publish_fixes.sql and 20261027180000, which
-- are already on the dev project, so this file replaces functions instead of
-- editing those files. (VC-52, the arc gauge, is app-only: no data change.)
--
-- VC-53, in plain words: under the score the app shows 3 small tiles,
-- Crowd / Music / Energy, each ONE WORD (Quiet / Good / Packed, Meh / Good /
-- Fire, Low / Good / Fire). The word comes from the average of that row's
-- taps (1, 2 or 3) over EXACTLY the ratings and weights behind the score on
-- screen. The averages are stored in the published snapshot and never leave
-- the database: the app only ever gets the words.
--
-- VC-54, in plain words: "All night" is the plain average of this event's
-- visible ratings over its night (the night ends at 5 AM New York after the
-- event starts), plus its own 3 tiles and a "112 ratings tonight" count.
--
-- Privacy, in plain words (cto verifies before merge):
--   1. Everything new is frozen in the PUBLISHED snapshot, like the score
--      (VC-51 / VC-64): it only changes when 3+ new people have rated, so a
--      tile or the night score can never move because of one new rating.
--   2. Tiles and the night view only exist when the main score shows (5+
--      raters). In 'none' and 'early' the server sends neither.
--   3. Tiles are words (3 coarse buckets), never numbers.
--   4. The night score reuses the night-average rule from 20261027150000
--      ("keep it only when the score leaves out 0 or 5+ ratings"), made
--      exact for two sets. The live score uses set B (its 3-hour window, or
--      the 5 newest); the night uses set A (the night's ratings). Comparing
--      the two numbers (or tiles) can only reveal the ratings that are in
--      one set and not the other. So the night score and its tiles are kept
--      only when BOTH "in A but not B" and "in B but not A" hold 0 or 5+
--      ratings. Then any difference is an average of at least 5 people, the
--      same floor as the score itself. ("In B but not A" is new: it happens
--      when an event's ratings carry on after 5 AM.)
--   The old "night average" (shown when quiet) now IS the night score, so
--   the app never gets two different averages to compare.
--
-- Why the night has no START bound: a rating can only be saved from 30
-- minutes before the event starts, so every rating this event has belongs
-- to its night. Only the 5 AM end needs checking (events can run past it).
--
-- What this file changes:
--   private.night_end(timestamptz)              new: the 5 AM that ends a night
--   private.vibe_live_set(uuid, timestamptz)    new: the ratings (and weights)
--                                               behind the live score
--   private.vibe_score_at(uuid, timestamptz)    now built on vibe_live_set
--                                               (same results)
--   private.vibe_word(numeric, text, text, text)  new: average -> one word
--   private.vibe_breakdown(numeric x3)          new: the 3 tile words as JSON
--   private.vibe_snapshots                      + live and night row averages,
--                                               + night_raters
--   private.publish_event_vibe()                stores them (rule 4 above)
--   private.published_vibe()                    sends "breakdown" and "night"
-- Unchanged: get_event_vibe / get_events_vibe (they read published_vibe),
-- submit_rating, the 3-rater gate, and every JSON key the app read before
-- ("night_average" stays for older app builds, stale only).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- night_end: the 5 AM New York that ends the event night p_at falls in.
-- -----------------------------------------------------------------------------
create function private.night_end(p_at timestamptz)
returns timestamptz
language sql
immutable
security definer
set search_path = ''
as $$
  /*
    What it does: finds when the event night containing p_at ends.
    An event night runs from 5 AM to 5 AM New York time (VC-54), so for an
    event starting 10 PM Friday the night ends 5 AM Saturday, and for one
    starting 2 AM Saturday it also ends 5 AM Saturday.
    Input: p_at, a moment (we pass the event's start).
    Returns: the next 5 AM New York after the night began, as a timestamptz.
    How: the same steps as private.night_start (step back 5 hours on the New
    York clock and keep the date), then the NEXT day at 05:00. 5 AM is never
    a daylight-saving change hour, so it is never ambiguous.
  */
  select (((((p_at at time zone 'America/New_York') - interval '5 hours')::date + 1)
           + time '05:00') at time zone 'America/New_York');
$$;

comment on function private.night_end(timestamptz) is
  'VC-54: 5 AM New York that ends the event night containing p_at (the "All night" view stops there).';

-- -----------------------------------------------------------------------------
-- vibe_live_set: the exact ratings behind the live score, with their weights.
-- -----------------------------------------------------------------------------
create function private.vibe_live_set(p_event_id uuid, p_at timestamptz)
returns table (rating_id bigint, weight numeric)
language sql
stable
security definer
set search_path = ''
as $$
  /*
    What it does: lists the ratings the live score uses at the moment p_at,
    and how much each one counts. The rule is the one from
    20261027140000_vibe_min_weight.sql, unchanged:
      - fewer than 5 visible ratings up to p_at: nothing (no score at all);
      - 5 or more saved in the 3 hours up to p_at: those, each weighing
        max(0.25, 0.5 ^ (age in minutes / 30));
      - otherwise: the 5 newest visible ratings, each weighing 1.
    Inputs: p_event_id (the event) and p_at (the moment).
    Returns: one row per rating used: its id and its weight.
    Why one function: the score, the VC-53 tiles and the VC-54 privacy check
    must all use EXACTLY the same set, or the tiles could describe people the
    score leaves out. Private schema: the app can never call it.
  */
  with visible as (
    -- Every visible rating up to p_at, newest first (rn 1 = newest).
    select r.id,
           r.updated_at,
           row_number() over (order by r.updated_at desc, r.id desc) as rn
    from public.ratings r
    where r.event_id = p_event_id
      and r.hidden_at is null
      and r.updated_at <= p_at
  ),
  counts as (
    -- How many in total, and how many inside the 3-hour window.
    select count(*) as total,
           count(*) filter (where v.updated_at >= p_at - interval '3 hours') as in_window
    from visible v
  )
  select v.id,
         case
           when c.in_window >= 5 then
             -- The bigger of the halving weight and the 0.25 floor (VC-50).
             greatest(
               0.25::double precision,
               power(0.5::double precision,
                     extract(epoch from (p_at - v.updated_at)) / 60.0 / 30.0)
             )::numeric
           else 1::numeric
         end
  from visible v
  cross join counts c
  where c.total >= 5
    and (
      (c.in_window >= 5 and v.updated_at >= p_at - interval '3 hours')
      or (c.in_window < 5 and v.rn <= 5)
    );
$$;

comment on function private.vibe_live_set(uuid, timestamptz) is
  'VC-53: the ratings (id, weight) behind the live score at p_at: the 3-hour window with weights max(0.25, 0.5^(age/30)) when it holds 5+, else the 5 newest at weight 1; none under 5 visible ratings.';

-- -----------------------------------------------------------------------------
-- vibe_score_at: the same answers as before, now built on vibe_live_set so
-- the score and the tiles can never use different ratings.
-- -----------------------------------------------------------------------------
create or replace function private.vibe_score_at(p_event_id uuid, p_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  /*
    What it does: the live score of one event as it stood at the moment p_at.
    Inputs: p_event_id (the event) and p_at (the moment to score at).
    Returns: the weighted average of the ratings private.vibe_live_set picks
      (see there for the rule), rounded to 1 decimal; null when it picks none
      (fewer than 5 visible ratings).
    Why `security definer`: it reads every guest's rating, which app users
    can't. It's in the private schema, so the app can't call it directly.
  */
  select round((sum(s.weight * r.score) / nullif(sum(s.weight), 0))::numeric, 1)
  from private.vibe_live_set(p_event_id, p_at) s
  join public.ratings r on r.id = s.rating_id;
$$;

comment on function private.vibe_score_at(uuid, timestamptz) is
  'VC-B09 + VC-50 + VC-53: weighted average of the ratings private.vibe_live_set picks at p_at, rounded to 1 decimal; null with fewer than 5 visible ratings.';

-- -----------------------------------------------------------------------------
-- vibe_word: one row's average -> one of three words.
-- -----------------------------------------------------------------------------
create function private.vibe_word(p_average numeric, p_low text, p_mid text, p_top text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  /*
    What it does: turns a row's average tap (1 to 3) into its tile word.
    Inputs: p_average (null = no word), then the row's three words.
    Returns: p_low under 1.67, p_mid from 1.67 to 2.33, p_top above 2.33
      (the design spec's thirds); null when p_average is null.
    Why round to 2 decimals first: averages like 1, 2, 2 give 1.6667, which
    the spec means as "1.67" (the middle), not just under it.
  */
  select case
    when p_average is null then null
    when round(p_average, 2) < 1.67 then p_low
    when round(p_average, 2) <= 2.33 then p_mid
    else p_top
  end;
$$;

comment on function private.vibe_word(numeric, text, text, text) is
  'VC-53: a row''s average (1-3) to its tile word: low < 1.67 <= middle <= 2.33 < top (rounded to 2 decimals first).';

-- -----------------------------------------------------------------------------
-- vibe_breakdown: the 3 tile words as the JSON the app reads.
-- -----------------------------------------------------------------------------
create function private.vibe_breakdown(p_crowd numeric, p_music numeric, p_energy numeric)
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  /*
    What it does: builds the tiles' answer from the three row averages.
    Inputs: the crowd, music and energy averages (1 to 3).
    Returns: e.g. {"crowd": "packed", "music": "fire", "energy": "good"},
      words only; null if any average is missing (no tiles at all).
    The words (lower case keys; the app shows them with a capital):
      crowd   quiet / good / packed
      music   meh   / good / fire
      energy  low   / good / fire
  */
  select case
    when p_crowd is null or p_music is null or p_energy is null then null
    else jsonb_build_object(
      'crowd', private.vibe_word(p_crowd, 'quiet', 'good', 'packed'),
      'music', private.vibe_word(p_music, 'meh', 'good', 'fire'),
      'energy', private.vibe_word(p_energy, 'low', 'good', 'fire')
    )
  end;
$$;

comment on function private.vibe_breakdown(numeric, numeric, numeric) is
  'VC-53: {crowd, music, energy} tile words from the three row averages (words only); null if any is missing.';

-- -----------------------------------------------------------------------------
-- The snapshot gets the row averages (live and night) and the night count.
-- They stay inside the database: published_vibe sends words only.
-- -----------------------------------------------------------------------------
alter table private.vibe_snapshots
  add column crowd_average numeric,
  add column music_average numeric,
  add column energy_average numeric,
  add column night_raters integer check (night_raters >= 0),
  add column night_crowd_average numeric,
  add column night_music_average numeric,
  add column night_energy_average numeric;

comment on column private.vibe_snapshots.night_average is
  'VC-54: the "All night" score: plain average of the night''s visible ratings (ending 5 AM NY), only when the live score''s set and the night''s set differ by 0 or 5+ ratings each way. Also sent as night_average when stale.';
comment on column private.vibe_snapshots.crowd_average is 'VC-53: weighted average crowd tap (1-3) over the live score''s ratings; null without a score. Never sent: the app gets a word.';
comment on column private.vibe_snapshots.music_average is 'VC-53: as crowd_average, for music.';
comment on column private.vibe_snapshots.energy_average is 'VC-53: as crowd_average, for energy.';
comment on column private.vibe_snapshots.night_raters is 'VC-54: how many visible ratings the night holds ("112 ratings tonight").';
comment on column private.vibe_snapshots.night_crowd_average is 'VC-54: plain average crowd tap over the night''s ratings; kept under the same rule as night_average. Never sent: the app gets a word.';
comment on column private.vibe_snapshots.night_music_average is 'VC-54: as night_crowd_average, for music.';
comment on column private.vibe_snapshots.night_energy_average is 'VC-54: as night_crowd_average, for energy.';

-- -----------------------------------------------------------------------------
-- publish_event_vibe: as in 20261027150000, plus the tiles and the night.
-- -----------------------------------------------------------------------------
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
    the time of the save, an admin republish passes now() or the snapshot's
    own moment, tests pass a fixed one).
  Returns: nothing.
  Rules:
    - takes the per-event publish lock (the same one submit_rating takes);
    - never replaces a newer snapshot with an older one (20261027150000);
    - the live tiles (VC-53) use exactly the ratings and weights behind the
      score (private.vibe_live_set), and only when there is a score;
    - the night (VC-54) is the event's visible ratings up to p_at and before
      the 5 AM that ends its night. Its score and tiles are kept only when
      there is a live score, the night holds 5+ ratings, and the live set and
      the night set differ by 0 or 5+ ratings in EACH direction (see the
      file header, rule 4). Its count is always kept.
  Why `security definer`: it reads every rating and writes the private
    table. It's in the private schema, so the app can't call it directly.
*/
declare
  v_vibe jsonb;
  v_score numeric;
  v_last timestamptz;
  v_scored_at timestamptz;
  v_night_end timestamptz;
  -- Live row averages (set B).
  v_crowd numeric;
  v_music numeric;
  v_energy numeric;
  -- The night (set A).
  v_night_raters integer;
  v_night_score numeric;
  v_night_crowd numeric;
  v_night_music numeric;
  v_night_energy numeric;
  -- How many ratings are in only one of the two sets.
  v_night_only integer;
  v_live_only integer;
  v_night_ok boolean;
begin
  -- One publisher per event at a time. Released when the transaction ends.
  perform pg_advisory_xact_lock(hashtext('vibecheck.vibe_publish:' || p_event_id::text));

  -- Everything the meter shows, worked out fresh at p_at.
  v_vibe := private.event_vibe(p_event_id, p_at);
  v_score := (v_vibe ->> 'score')::numeric;

  -- The newest included rating (for "updated N min ago" and 'stale').
  select max(r.updated_at) into v_last
  from public.ratings r
  where r.event_id = p_event_id
    and r.hidden_at is null
    and r.updated_at <= p_at;

  -- Which moment the score was worked out at: event_vibe scores a quiet
  -- ('stale') event at its last rating, otherwise at p_at.
  v_scored_at := case when v_vibe ->> 'state' = 'stale' then v_last else p_at end;

  -- The 5 AM New York that ends this event's night.
  select private.night_end(e.starts_at) into v_night_end
  from public.events e
  where e.id = p_event_id;

  -- VC-53: the live tiles' averages, over exactly the score's ratings and
  -- weights. Only when there is a score (no tiles in 'none' or 'early').
  if v_score is not null then
    select sum(s.weight * r.crowd) / nullif(sum(s.weight), 0),
           sum(s.weight * r.music) / nullif(sum(s.weight), 0),
           sum(s.weight * r.energy) / nullif(sum(s.weight), 0)
    into v_crowd, v_music, v_energy
    from private.vibe_live_set(p_event_id, v_scored_at) s
    join public.ratings r on r.id = s.rating_id;
  end if;

  -- VC-54: the night's count, plain average and plain row averages.
  select count(*)::int, round(avg(r.score), 1), avg(r.crowd), avg(r.music), avg(r.energy)
  into v_night_raters, v_night_score, v_night_crowd, v_night_music, v_night_energy
  from public.ratings r
  where r.event_id = p_event_id
    and r.hidden_at is null
    and r.updated_at <= p_at
    and r.updated_at < v_night_end;

  -- Rule 4: count the ratings in only one of the two sets. A full outer join
  -- of the two id lists: a missing side means "only in the other set".
  select count(*) filter (where b.rating_id is null)::int,
         count(*) filter (where a.id is null)::int
  into v_night_only, v_live_only
  from (
    select r.id
    from public.ratings r
    where r.event_id = p_event_id
      and r.hidden_at is null
      and r.updated_at <= p_at
      and r.updated_at < v_night_end
  ) a
  full outer join (
    select s.rating_id from private.vibe_live_set(p_event_id, v_scored_at) s
  ) b on b.rating_id = a.id;

  v_night_ok := v_score is not null
    and v_night_raters >= 5
    and (v_night_only = 0 or v_night_only >= 5)
    and (v_live_only = 0 or v_live_only >= 5);

  insert into private.vibe_snapshots as s
    (event_id, published_at, scored_at, raters, score, night_average, reactions,
     crowd_average, music_average, energy_average,
     night_raters, night_crowd_average, night_music_average, night_energy_average)
  values (
    p_event_id,
    p_at,
    v_last,
    (v_vibe ->> 'raters')::int,
    v_score,
    case when v_night_ok then v_night_score end,
    coalesce(v_vibe -> 'reactions', '[]'::jsonb),
    -- Stored to 2 decimals: all the word needs (private.vibe_word).
    round(v_crowd, 2),
    round(v_music, 2),
    round(v_energy, 2),
    v_night_raters,
    case when v_night_ok then round(v_night_crowd, 2) end,
    case when v_night_ok then round(v_night_music, 2) end,
    case when v_night_ok then round(v_night_energy, 2) end
  )
  on conflict (event_id) do update
    set published_at = excluded.published_at,
        scored_at = excluded.scored_at,
        raters = excluded.raters,
        score = excluded.score,
        night_average = excluded.night_average,
        reactions = excluded.reactions,
        crowd_average = excluded.crowd_average,
        music_average = excluded.music_average,
        energy_average = excluded.energy_average,
        night_raters = excluded.night_raters,
        night_crowd_average = excluded.night_crowd_average,
        night_music_average = excluded.night_music_average,
        night_energy_average = excluded.night_energy_average
    -- Never go back to an older snapshot (20261027150000).
    where s.published_at <= excluded.published_at;
end;
$$;

comment on function private.publish_event_vibe(uuid, timestamptz) is
  'VC-51 + VC-53 + VC-54: saves the event''s vibe at p_at as its published snapshot (totals only) under the per-event lock, never over a newer one; adds the live tile averages (same set as the score) and the night (to 5 AM NY), whose score and tiles are kept only when the live and night sets differ by 0 or 5+ ratings each way.';

-- -----------------------------------------------------------------------------
-- published_vibe: as in 20261027140200, plus "breakdown" and "night".
-- -----------------------------------------------------------------------------
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
  Returns: JSON with the keys the app already read:
    state               'none'  no snapshot yet, or 0 raters in it;
                        'early' fewer than 5 raters in it (no number);
                        'stale' its newest rating is 90+ minutes old;
                        'live'  otherwise
    raters, here, score, label, minutes_since_last, reactions  (unchanged)
    night_average       stale only: the night score (older app builds show
                        it as "night average"; null when withheld)
  plus, new (only in 'live' and 'stale'; null otherwise):
    breakdown           VC-53 live tiles: {crowd, music, energy} words
    night               VC-54 "All night":
                          score, label  the night score and its word, or
                                        null when withheld (privacy rule)
                          raters        how many ratings the night holds
                          breakdown     the night's tile words, or null
                          over          true once the night's 5 AM New York
                                        has passed ("LAST NIGHT'S VIBE")
  Why: between publishes every answer is the same, so polling can't reveal
  one new rating (VC-51). Never returns who rated, any single rating, or any
  average behind a tile.
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
    'night_average', case when v_state = 'stale' then v_snap.night_average end,
    'minutes_since_last',
      case when v_snap.scored_at is not null
           then greatest(0, floor(extract(epoch from (p_now - v_snap.scored_at)) / 60))::int end,
    'reactions', case when v_shown then v_snap.reactions else '[]'::jsonb end,
    'breakdown', case when v_shown then private.vibe_breakdown(
        v_snap.crowd_average, v_snap.music_average, v_snap.energy_average) end,
    'night', case when v_shown then jsonb_build_object(
        'score', v_snap.night_average,
        'label', private.vibe_label(v_snap.night_average),
        'raters', coalesce(v_snap.night_raters, 0),
        'breakdown', private.vibe_breakdown(
          v_snap.night_crowd_average, v_snap.night_music_average, v_snap.night_energy_average),
        'over', p_now >= private.night_end(v_starts_at)) end
  );
end;
$$;

comment on function private.published_vibe(uuid, timestamptz) is
  'VC-51 + VC-53 + VC-54: the vibe the app sees, from the last published snapshot (state, raters, here, score, label, night_average when stale, minutes_since_last, reactions, and in live/stale the tile words and the "All night" view). Totals and words only.';

-- -----------------------------------------------------------------------------
-- Snapshots saved before this file: their night averages followed the older,
-- one-way rule, and they have no tiles. Clear the night average to be safe;
-- the next publish at each event fills everything under the new rules.
-- (Republishing now could release ratings waiting below the 3-rater gate.)
-- -----------------------------------------------------------------------------
update private.vibe_snapshots set night_average = null;

-- -----------------------------------------------------------------------------
-- Rights: none of the private helpers can be called from the app.
-- "create or replace" keeps old rights; say them again so this file stands on
-- its own.
-- -----------------------------------------------------------------------------
revoke execute on function private.night_end(timestamptz) from public, anon, authenticated;
revoke execute on function private.vibe_live_set(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.vibe_score_at(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.vibe_word(numeric, text, text, text) from public, anon, authenticated;
revoke execute on function private.vibe_breakdown(numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function private.publish_event_vibe(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.published_vibe(uuid, timestamptz) from public, anon, authenticated;
