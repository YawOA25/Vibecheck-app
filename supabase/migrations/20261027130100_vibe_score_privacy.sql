-- =============================================================================
-- Migration 16: privacy fixes to the live vibe score (task VC-B09, cto review).
-- Follows 20261027130000_vibe_score.sql, which is already on the dev project,
-- so this file REPLACES two of its functions instead of editing that file.
--
-- What changes, in plain words:
--   1. Never a number from fewer than 5 ratings. Before, the 5-rating minimum
--      counted the whole night, but the score used only the last 3 hours.
--      So 5 ratings at 8 PM and 1 at 11:30 PM gave a "live" score that was
--      exactly that one person's rating. Now, if the 3-hour window holds
--      fewer than 5 visible ratings, the score uses the 5 newest visible
--      ratings instead (still weighted by age). The stale score ("the score
--      at the last rating") follows the same rule, because it uses the same
--      function.
--   2. night_average is sent only in the 'stale' state (as the plan says).
--      Sent while live, next to the exact rater count, it gave away each new
--      rating by subtraction: (new average x new count) - (old average x old
--      count) = the new rating.
--   3. The exact time of the newest rating (last_rating_at) is no longer
--      sent. minutes_since_last is enough for "updated 4 min ago", and an
--      exact time helps tie a rating to a person seen tapping their phone.
--
-- What is still possible (an accepted risk for the party test): someone who
-- keeps polling can see the live score and the rater count change when ONE
-- new rating arrives, and from that work out roughly what that rating was.
-- The changes above make this harder, but no live average can fully stop it.
-- Nobody can ever learn WHO rated from these functions: they return no names
-- or ids.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The weighted score at one moment, now with the 5-rating floor.
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
    Returns: the weighted average, rounded to 1 decimal, of
      - the visible ratings saved in the 3 hours up to p_at (3 hours ago
        exactly still counts), when there are at least 5 of them;
      - otherwise the 5 newest visible ratings saved up to p_at, wherever
        they fall in the night;
      and null when fewer than 5 visible ratings exist up to p_at at all.
      Ratings saved after p_at are ignored.
    The weight: 0.5 ^ (age in minutes / 30), so a rating counts half as much
    every 30 minutes.
    Why the 5-rating floor: a score made from 1 rating IS that person's
    rating, so a number always needs at least 5. NOTE: the age weighting
    used here for the 5 newest still let one fresh rating outweigh older
    ones; 20261027130200_vibe_score_floor_plain_average.sql replaces this
    function with a plain average of the 5 newest in that case.
    Why `security definer`: it reads every guest's rating, which app users
    can't. It's in the private schema, so the app can't call it directly.
  */
  with visible as (
    -- Every visible rating up to p_at, newest first (rn 1 = newest).
    select r.score,
           r.updated_at,
           row_number() over (order by r.updated_at desc, r.id desc) as rn
    from public.ratings r
    where r.event_id = p_event_id
      and r.hidden_at is null
      and r.updated_at <= p_at
  ),
  used as (
    -- The 3-hour window, plus the 5 newest. When the window already has 5 or
    -- more, the 5 newest are inside it, so this is just the window. When it
    -- has fewer, the window is part of the 5 newest, so this is the 5 newest.
    select v.score, v.updated_at
    from visible v
    where v.updated_at >= p_at - interval '3 hours'
       or v.rn <= 5
  )
  select case
    -- Fewer than 5 visible ratings in total: no number at all.
    when (select count(*) from visible) < 5 then null
    else (
      select round((sum(w.weight * u.score) / nullif(sum(w.weight), 0))::numeric, 1)
      from used u
      -- The weight for this rating, from its age in minutes at p_at.
      cross join lateral (
        select power(0.5::double precision,
                     extract(epoch from (p_at - u.updated_at)) / 60.0 / 30.0)::numeric as weight
      ) w
    )
  end;
$$;

comment on function private.vibe_score_at(uuid, timestamptz) is
  'VC-B09: weighted average (weight 0.5^(age min/30)) of visible ratings saved in the 3 hours up to p_at, or of the 5 newest if the window has fewer than 5; null with fewer than 5 visible ratings. Rounded to 1 decimal.';

-- -----------------------------------------------------------------------------
-- The core, now without night_average while live and without last_rating_at.
-- -----------------------------------------------------------------------------
create or replace function private.event_vibe(p_event_id uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: works out an event's vibe as it stands at p_now.
  Inputs: p_event_id (the event) and p_now (the moment; the public functions
    always pass the real time, tests pass a fixed one).
  Returns: JSON with
    state               'none', 'early', 'stale' or 'live'
    raters              how many people's visible ratings count (all night)
    here                how many people checked in (VC-42 count only)
    score, label        live: the live score and its word; stale: the last
                        score (as it stood at the last rating) and its word;
                        none/early: null (no number until 5 ratings)
    night_average       stale only: the plain average of all visible ratings,
                        rounded to 1 decimal; otherwise null (see the header:
                        sent while live it gave away each new rating)
    minutes_since_last  whole minutes since the newest visible rating (null
                        if none), so the app can say "updated 4 min ago"
                        without trusting the phone's clock. The exact time
                        is not sent.
    reactions           stale and live: the reaction tally, most first, e.g.
                        [{"reaction": "fire", "count": 4}]; otherwise []
  Never returns who rated or any single rating's row.
*/
declare
  -- The fewest visible ratings before a number is shown (VC-05). One constant.
  c_min_raters constant integer := 5;
  -- No new rating for this long means 'stale'.
  c_stale_after constant interval := interval '90 minutes';
  v_raters integer;
  v_here integer;
  v_last timestamptz;
  v_average numeric;
  v_score numeric;
  v_state text;
  v_reactions jsonb := '[]'::jsonb;
begin
  -- Totals over every visible rating saved up to p_now.
  select count(*)::int, max(r.updated_at), round(avg(r.score), 1)
  into v_raters, v_last, v_average
  from public.ratings r
  where r.event_id = p_event_id
    and r.hidden_at is null
    and r.updated_at <= p_now;

  -- VC-42: the headcount. Only a number; nobody's name or id leaves here.
  select count(*)::int into v_here
  from public.check_ins c
  where c.event_id = p_event_id
    and c.first_at <= p_now;

  if v_raters = 0 then
    v_state := 'none';
  elsif v_raters < c_min_raters then
    v_state := 'early';
  elsif v_last <= p_now - c_stale_after then
    -- Quiet for 90 minutes or more: show the score as it stood at the last
    -- rating (the live score would fade towards nothing).
    v_state := 'stale';
    v_score := private.vibe_score_at(p_event_id, v_last);
  else
    v_state := 'live';
    v_score := private.vibe_score_at(p_event_id, p_now);
  end if;

  -- The reaction tally, only once there are enough raters.
  if v_state in ('stale', 'live') then
    select coalesce(
      jsonb_agg(jsonb_build_object('reaction', t.reaction, 'count', t.n)
                order by t.n desc, t.reaction),
      '[]'::jsonb
    )
    into v_reactions
    from (
      select r.reaction, count(*)::int as n
      from public.ratings r
      where r.event_id = p_event_id
        and r.hidden_at is null
        and r.updated_at <= p_now
        and r.reaction is not null
      group by r.reaction
    ) t;
  end if;

  return jsonb_build_object(
    'state', v_state,
    'raters', v_raters,
    'here', v_here,
    'score', v_score,
    'label', private.vibe_label(v_score),
    'night_average', case when v_state = 'stale' then v_average end,
    'minutes_since_last',
      case when v_last is not null
           then floor(extract(epoch from (p_now - v_last)) / 60)::int end,
    'reactions', v_reactions
  );
end;
$$;

comment on function private.event_vibe(uuid, timestamptz) is
  'VC-B09 + VC-42: an event''s vibe at p_now (state, raters, here, score, label, night_average when stale, minutes_since_last, reactions). Totals only.';

-- "create or replace" keeps the old rights, but say it again so this file
-- stands on its own: the app can never call these helpers directly.
revoke execute on function private.vibe_score_at(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.event_vibe(uuid, timestamptz) from public, anon, authenticated;
