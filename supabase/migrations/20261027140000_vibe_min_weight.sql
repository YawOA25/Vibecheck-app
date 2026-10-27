-- =============================================================================
-- Migration 18: a minimum weight of 0.25 inside the live-score window
-- (proposal VC-50, approved by the founder 2026-10-27, "4-13 approve").
-- Follows 20261027130200_vibe_score_floor_plain_average.sql, which is already
-- on the dev project, so this file replaces private.vibe_score_at again
-- instead of editing that file.
--
-- The problem, in plain words: a rating's weight halves every 30 minutes, so
-- a rating 2 hours old counts only 1/16 as much as a brand-new one. After a
-- quiet spell, ONE new rating could then outweigh a whole room of earlier
-- ones (10 now next to five 0s from 2 hours ago gave 7.6), and that one
-- guest's rating more or less WAS the score.
--
-- The fix: inside the 3-hour window no rating counts less than 0.25 (a
-- quarter of a brand-new one). So:
--     weight = max(0.25, 0.5 ^ (age in minutes / 30))
-- Ratings up to 60 minutes old are unchanged (1 down to 0.25); older ones in
-- the window stay at 0.25 instead of fading towards nothing. The example
-- above now gives 10 / (1 + 5 x 0.25) = 4.4.
--
-- Unchanged: the 3-hour window itself (older ratings still count zero), the
-- 5-rating floor (fewer than 5 in the window: the plain average of the 5
-- newest, from 130200), and "no number from fewer than 5 ratings at all".
-- =============================================================================

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
    Returns, rounded to 1 decimal:
      - 5 or more visible ratings saved in the 3 hours up to p_at (3 hours
        ago exactly still counts): their age-weighted average, with
        weight = max(0.25, 0.5 ^ (age in minutes / 30)). A rating counts half
        as much every 30 minutes, but never less than a quarter (VC-50);
      - fewer than 5 in that window: the PLAIN average of the 5 newest
        visible ratings saved up to p_at, each counting the same (130200);
      - fewer than 5 visible ratings up to p_at at all: null (no number).
      Ratings saved after p_at are ignored.
    Why the 0.25 floor: without it one fresh rating after a lull could be
    worth 16 or more older ones, so the "crowd's" score would really be one
    person's rating. With it, one new rating is worth at most 4 older ones.
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
  in_window as (
    -- The ratings inside the 3-hour window.
    select v.score, v.updated_at
    from visible v
    where v.updated_at >= p_at - interval '3 hours'
  )
  select case
    -- Fewer than 5 visible ratings in total: no number at all.
    when (select count(*) from visible) < 5 then null
    -- Too few in the window: the plain average of the 5 newest.
    when (select count(*) from in_window) < 5 then (
      select round(avg(v.score), 1) from visible v where v.rn <= 5
    )
    -- Otherwise: the age-weighted average of the window, weights floored at 0.25.
    else (
      select round((sum(w.weight * u.score) / nullif(sum(w.weight), 0))::numeric, 1)
      from in_window u
      -- The weight for this rating, from its age in minutes at p_at. `greatest`
      -- picks the bigger of the two: the halving weight, or the 0.25 floor.
      cross join lateral (
        select greatest(
                 0.25::double precision,
                 power(0.5::double precision,
                       extract(epoch from (p_at - u.updated_at)) / 60.0 / 30.0)
               )::numeric as weight
      ) w
    )
  end;
$$;

comment on function private.vibe_score_at(uuid, timestamptz) is
  'VC-B09 + VC-50: age-weighted average (weight max(0.25, 0.5^(age min/30))) of visible ratings in the 3 hours up to p_at when there are 5+; otherwise the plain average of the 5 newest; null with fewer than 5 visible ratings. Rounded to 1 decimal.';

-- "create or replace" keeps the old rights; say it again so this file stands
-- on its own: the app can never call this helper directly.
revoke execute on function private.vibe_score_at(uuid, timestamptz) from public, anon, authenticated;
