-- =============================================================================
-- Migration 17: the 5-rating floor uses a PLAIN average (task VC-B09, second
-- cto review). Follows 20261027130100_vibe_score_privacy.sql, which is already
-- on the dev project, so this file replaces private.vibe_score_at again
-- instead of editing that file.
--
-- The problem, in plain words: when the last 3 hours hold fewer than 5
-- ratings, 130100 used the 5 newest ratings but still weighted them by age.
-- A brand-new rating then counts about 30 times more than ratings 3 hours
-- older, so one guest's 0 next to four old 10s gave 0.3: in effect that one
-- guest's rating.
--
-- The fix: in that case the score is the plain (unweighted) average of the 5
-- newest visible ratings, so each of the 5 counts the same (the example above
-- now gives 8.0). With 5 or more ratings in the 3-hour window, nothing
-- changes: the age-weighted average of the window. The stale score uses the
-- same function, so it follows the same rule.
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
        ago exactly still counts): their age-weighted average, weight =
        0.5 ^ (age in minutes / 30), so a rating counts half as much every
        30 minutes;
      - fewer than 5 in that window: the PLAIN average of the 5 newest
        visible ratings saved up to p_at, each counting the same;
      - fewer than 5 visible ratings up to p_at at all: null (no number).
      Ratings saved after p_at are ignored.
    Why a plain average for the floor: weighting by age would let one fresh
    rating outweigh four older ones, so the number would really be that one
    person's rating. Counting the 5 equally means no single rating decides it.
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
    -- Otherwise: the age-weighted average of the window.
    else (
      select round((sum(w.weight * u.score) / nullif(sum(w.weight), 0))::numeric, 1)
      from in_window u
      -- The weight for this rating, from its age in minutes at p_at.
      cross join lateral (
        select power(0.5::double precision,
                     extract(epoch from (p_at - u.updated_at)) / 60.0 / 30.0)::numeric as weight
      ) w
    )
  end;
$$;

comment on function private.vibe_score_at(uuid, timestamptz) is
  'VC-B09: age-weighted average (0.5^(age min/30)) of visible ratings in the 3 hours up to p_at when there are 5+; otherwise the plain average of the 5 newest; null with fewer than 5 visible ratings. Rounded to 1 decimal.';

-- "create or replace" keeps the old rights; say it again so this file stands
-- on its own: the app can never call this helper directly.
revoke execute on function private.vibe_score_at(uuid, timestamptz) from public, anon, authenticated;
