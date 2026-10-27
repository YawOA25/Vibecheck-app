-- =============================================================================
-- Migration 19: "N here" and heads-up counts only look at the last 3 hours
-- (proposals VC-55 and VC-46, approved by the founder 2026-10-27,
-- "4-13 approve"; VC-55 "3-hour window, as recommended").
-- Follows 20261027130100 and 20261027120000, which are already on the dev
-- project, so this file replaces functions instead of editing those files.
--
-- VC-55, "N here", in plain words:
--   * While the event is on (up to its end time), "N here" counts the people
--     whose check-in was confirmed in the last 3 hours: the same 3-hour window
--     as the live score. "Confirmed" means the check-in itself or a later
--     re-check (check_ins.last_verified_at; the quiet GPS re-check before a
--     rating refreshes it). Someone who checked in at 9 PM and did nothing
--     since drops out of the count at midnight. Before, everyone who had
--     EVER checked in counted, so late in the night the number overstated
--     the crowd.
--   * Once the event's end time has passed, the app says "N were here"
--     (src/lib/vibe.ts, hereText). A 3-hour window would make that number
--     shrink to 0 over the next hours, which reads wrong. So after the end
--     time the count is everyone who checked in at any point in the night.
--     The switch happens at ends_at, the same moment the app switches its
--     words (app/event/[id].tsx, `ended`), so the number and the words agree
--     (apart from a few seconds if the phone's clock is off).
--   * Still a number only (VC-42): no names, no ids, no list.
--
-- VC-46, heads-up tags:
--   * get_event_heads_ups counts only +1s added in the last 3 hours, so a tag
--     like "Lines are long" fades out instead of staying up all night.
--   * Because each person has ONE row per tag (the table's key), a +1 older
--     than 3 hours used to block a fresh one ('already'). Now add_heads_up
--     refreshes such an old +1 to "now" and answers 'added'. A +1 that is
--     still counted (under 3 hours old) still answers 'already', so nobody
--     can count twice. submit_rating gets the same refresh for tags picked
--     while rating; that change is in 20261027140200_vibe_publish_gate.sql,
--     which replaces submit_rating anyway.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: the "N here" count (VC-42 count only, VC-55 window).
-- -----------------------------------------------------------------------------
create function private.event_here(p_event_id uuid, p_now timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  /*
    What it does: counts how many people are "here" at one event.
    Inputs: p_event_id (the event) and p_now (the moment; the app functions
      always pass the real time, tests pass a fixed one).
    Returns: a whole number (0 when nobody, or no such event):
      - up to the event's end time: people whose check-in was made by p_now
        and confirmed (checked in or re-checked) in the 3 hours up to p_now,
        3 hours exactly still counting;
      - after the end time: everyone who checked in by p_now, all night (the
        app then says "N were here").
    Why `security definer`: app users can read only their OWN check-in rows;
    this hands out a total only. It's in the private schema, so the app
    can't call it (or pick the clock) directly.
  */
  select coalesce((
    select count(*)::int
    from public.events e
    join public.check_ins c on c.event_id = e.id
    where e.id = p_event_id
      and c.first_at <= p_now
      and (
        -- After the end: the whole night ("N were here").
        p_now > e.ends_at
        -- While on: confirmed in the last 3 hours ("N here").
        or c.last_verified_at >= p_now - interval '3 hours'
      )
  ), 0);
$$;

comment on function private.event_here(uuid, timestamptz) is
  'VC-42 + VC-55: people checked in and confirmed in the 3 hours up to p_now while the event is on; everyone who checked in once it has ended. A number only.';

-- -----------------------------------------------------------------------------
-- event_vibe: the same as 20261027130100, but "here" now uses event_here.
-- (20261027140200 adds the publish gate on top; the app no longer calls this
-- directly, but the publisher does.)
-- -----------------------------------------------------------------------------
create or replace function private.event_vibe(p_event_id uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: works out an event's vibe FRESH, from every rating, as it
  stands at p_now.
  Inputs: p_event_id (the event) and p_now (the moment).
  Returns: JSON with
    state               'none', 'early', 'stale' or 'live'
    raters              how many people's visible ratings count (all night)
    here                the "N here" count (private.event_here, VC-55)
    score, label        live: the live score and its word; stale: the last
                        score (as it stood at the last rating) and its word;
                        none/early: null (no number until 5 ratings)
    night_average       stale only: the plain average of all visible ratings,
                        rounded to 1 decimal; otherwise null
    minutes_since_last  whole minutes since the newest visible rating (null
                        if none)
    reactions           stale and live: the reaction tally, most first;
                        otherwise []
  Never returns who rated or any single rating's row.
  NOTE: since 20261027140200 the app sees PUBLISHED snapshots of this
  (private.published_vibe), not this fresh version, so one new rating can't
  be spotted by polling.
*/
declare
  -- The fewest visible ratings before a number is shown (VC-05). One constant.
  c_min_raters constant integer := 5;
  -- No new rating for this long means 'stale'.
  c_stale_after constant interval := interval '90 minutes';
  v_raters integer;
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

  if v_raters = 0 then
    v_state := 'none';
  elsif v_raters < c_min_raters then
    v_state := 'early';
  elsif v_last <= p_now - c_stale_after then
    -- Quiet for 90 minutes or more: the score as it stood at the last rating.
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
    'here', private.event_here(p_event_id, p_now),
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
  'VC-B09 + VC-42 + VC-55: an event''s vibe computed fresh at p_now (state, raters, here, score, label, night_average when stale, minutes_since_last, reactions). Totals only. The app sees published snapshots instead (private.published_vibe).';

-- -----------------------------------------------------------------------------
-- add_heads_up: as in 20261027120000, plus the refresh of a +1 older than
-- 3 hours (VC-46).
-- -----------------------------------------------------------------------------
create or replace function public.add_heads_up(p_event_id uuid, p_tag text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: adds the caller's +1 to one heads-up tag at an event.
  Inputs: p_event_id (the event) and p_tag (one of the six tags).
  Returns: JSON with "status":
    'added'    the +1 was saved, or the caller's own +1 from more than 3
               hours ago was refreshed to now (it had stopped counting,
               VC-46);
    'already'  their +1 on this tag is under 3 hours old and still counts
               (nothing changes);
    'outside_window', 'not_checked_in', 'check_in_stale'
               see private.rating_gate.
  Why the same rules as rating: a heads-up is a claim about the party right
  now, so only guests who are there may make it (VC-05, VC-43).
*/
declare
  v_uid uuid := auth.uid();
  v_event public.events%rowtype;
  v_refusal jsonb;
  v_now timestamptz := now();
begin
  v_event := private.rating_event(p_event_id);
  if p_tag is null then
    raise exception 'That heads-up isn''t one we know.' using errcode = 'VCTAG';
  end if;
  perform private.check_heads_up_tags(array[p_tag]);

  -- Same per-person lock as submit_rating.
  perform pg_advisory_xact_lock(hashtext('vibecheck.rating:' || v_uid::text));

  v_refusal := private.rating_gate(v_uid, p_event_id, v_event.starts_at, v_event.ends_at);
  if v_refusal is not null then
    return v_refusal;
  end if;

  -- A new +1, or a refresh of the caller's own +1 when it is more than 3
  -- hours old (it no longer counts, VC-46). A +1 that still counts is left
  -- alone: the `where` makes the update do nothing, so no row comes back.
  insert into public.heads_up_votes as v (user_id, event_id, tag, created_at)
  values (v_uid, p_event_id, p_tag, v_now)
  on conflict (user_id, event_id, tag) do update
    set created_at = excluded.created_at
    where v.created_at < v_now - interval '3 hours';

  -- FOUND is true only when the insert added or refreshed a row.
  return jsonb_build_object('status', case when found then 'added' else 'already' end);
end;
$$;

comment on function public.add_heads_up(uuid, text) is
  'VC-43 + VC-46: the caller''s +1 on one heads-up tag (refreshed if over 3 hours old). Same rules as submit_rating. One row per person per tag per event.';

-- -----------------------------------------------------------------------------
-- get_event_heads_ups: as in 20261027120000, but only +1s from the last
-- 3 hours count (VC-46).
-- -----------------------------------------------------------------------------
create or replace function public.get_event_heads_ups(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: counts the heads-up tags at one event, over the last 3 hours.
  Input: p_event_id, the event.
  Returns: a JSON list, most +1s first, e.g.
    [{"tag": "lines_long", "count": 3, "mine": true}, ...]
  Only +1s added (or refreshed) in the 3 hours up to now count (3 hours
  exactly still counts), so a tag fades out when nobody repeats it (VC-46).
  Only tags with at least one counted +1 are listed. "mine" says whether the
  caller's own +1 is among the counted ones. Never says who else did.
  Rules: any signed-up adult who can see the event may read the counts
  (admins too). +1s from a guest whose rating here was hidden by an admin
  don't count.
  Raises: 42501 for non-adults, VCNFD for an event the caller can't see.
*/
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_event public.events%rowtype;
  v_result jsonb;
begin
  if v_uid is null or not private.is_adult_user() then
    raise exception 'Please sign in and finish setting up your profile first.'
      using errcode = '42501';
  end if;
  select * into v_event from public.events e where e.id = p_event_id;
  if not found or (v_event.is_test and not private.is_tester()) then
    raise exception 'That event doesn''t exist.' using errcode = 'VCNFD';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('tag', t.tag, 'count', t.n, 'mine', t.mine)
      order by t.n desc, t.tag
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select v.tag,
           count(*)::int as n,
           bool_or(v.user_id = v_uid) as mine
    from public.heads_up_votes v
    where v.event_id = p_event_id
      -- VC-46: only the last 3 hours.
      and v.created_at >= v_now - interval '3 hours'
      and v.created_at <= v_now
      -- Skip +1s from guests whose rating at this event is hidden.
      and not exists (
        select 1 from public.ratings r
        where r.user_id = v.user_id
          and r.event_id = v.event_id
          and r.hidden_at is not null
      )
    group by v.tag
  ) t;

  return v_result;
end;
$$;

comment on function public.get_event_heads_ups(uuid) is
  'VC-43 + VC-46: counts of heads-up tags at an event over the last 3 hours (most first), with "mine" for the caller. Excludes +1s from guests whose rating there is hidden.';

-- -----------------------------------------------------------------------------
-- Rights, restated so this file stands on its own.
-- -----------------------------------------------------------------------------
revoke execute on function private.event_here(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.event_vibe(uuid, timestamptz) from public, anon, authenticated;

revoke execute on function public.add_heads_up(uuid, text) from public, anon;
grant execute on function public.add_heads_up(uuid, text) to authenticated;

revoke execute on function public.get_event_heads_ups(uuid) from public, anon;
grant execute on function public.get_event_heads_ups(uuid) to authenticated;
