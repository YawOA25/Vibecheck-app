-- =============================================================================
-- Migration 15: the live vibe score (task VC-B09) and the "74 here" headcount
-- (proposal VC-42, approved by the founder 2026-10-27: COUNT ONLY, with B09;
-- no guest list and no names).
--
-- Plain-language background:
-- * Guests rate an event in 3 taps (task VC-B08, the ratings table). This
--   file turns those ratings into the one number everyone sees: the live
--   vibe score, from 0 to 10, with a word next to it (Quiet, Good, Hot,
--   Fire). The event page shows it with a meter; the Tonight list shows it
--   on each card.
-- * The functions here only hand out TOTALS (a score, a count, a tally of
--   reactions), never a row, a name or a user id. Totals are not perfect
--   privacy: someone who keeps polling can see the score and count change
--   when one new rating arrives and roughly work out that rating. That is an
--   accepted risk for the party test.
-- * NOTE: 20261027130100_vibe_score_privacy.sql (cto review) replaces
--   private.vibe_score_at and private.event_vibe below: never a number from
--   fewer than 5 ratings, night_average only when stale, and no exact
--   last_rating_at. Read that file for the current rules.
--
-- The maths (team/projects/vibecheck/mvp-plan.md, "Vibe score"):
--   one rating's score  (crowd + music + energy - 3) / 6 x 10, already stored
--                       in ratings.score (0 to 10; all "Good" is 5.0);
--   live score          a weighted average of the visible ratings saved in
--                       the last 3 hours. weight = 0.5 ^ (age in minutes / 30):
--                       a rating counts half as much every 30 minutes, so
--                       the score follows the party as it changes. Rounded
--                       to 1 decimal at the very end. "Saved" means the last
--                       save (updated_at), so an updated rating is fresh again;
--   labels              under 4 Quiet, 4 to 6.9 Good, 7 to 8.4 Hot, 8.5 and up
--                       Fire (worked out on the ROUNDED score, so the number
--                       and the word on screen always agree);
--   states              'none'   no visible ratings at all;
--                       'early'  fewer than 5 visible ratings: no number is
--                                given out at all. This also protects privacy:
--                                with 1 rating, "the score" WOULD be that
--                                person's rating;
--                       'stale'  no new rating for 90 minutes or more: shows the
--                                last score, the night's plain average and how
--                                long it's been quiet;
--                       'live'   otherwise.
--   hidden ratings      an admin can hide an abusive rating (hidden_at). Hidden
--                       ratings count nowhere: not in the score, the count,
--                       the average or the reaction tally.
--
-- The headcount (VC-42): how many people have checked in to the event. Just a
-- number ("74 here"). No names, no photos, no list.
--
-- Why the clock is a parameter only on the PRIVATE function: tests need to fix
-- "now" to check the maths exactly. The app's functions always use the real
-- time. If the app could pass any time, someone could ask for the score one
-- second before and one second after each rating and work out single people's
-- ratings exactly; refusing that makes it much harder (see the polling note
-- above for what is still possible).
--
-- Errors raised (same codes as the rating functions):
--   42501  not signed in, no profile, or under 18
--   VCNFD  no such event (or a test event and the caller isn't a tester)
--   22023  too many events asked for at once (more than 100)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: the word for a score.
-- -----------------------------------------------------------------------------
create function private.vibe_label(p_score numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  /*
    What it does: turns a score (already rounded to 1 decimal) into its word.
    Input: p_score, 0 to 10, or null.
    Returns: 'Quiet' (under 4), 'Good' (4 to 6.9), 'Hot' (7 to 8.4) or
      'Fire' (8.5 and up); null when there is no score.
    Why one function: the app shows the server's word, so the boundaries live
    in exactly one place (the app keeps the same list in src/lib/rating.ts,
    vibeLabel, only as a fallback).
  */
  select case
    when p_score is null then null
    when p_score < 4 then 'Quiet'
    when p_score < 7 then 'Good'
    when p_score < 8.5 then 'Hot'
    else 'Fire'
  end;
$$;

comment on function private.vibe_label(numeric) is
  'VC-B09: Quiet (<4), Good (4-6.9), Hot (7-8.4) or Fire (8.5+) for a score rounded to 1 decimal.';

-- -----------------------------------------------------------------------------
-- Helper: the weighted score at one moment.
-- -----------------------------------------------------------------------------
create function private.vibe_score_at(p_event_id uuid, p_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  /*
    What it does: the live score of one event as it stood at the moment p_at.
    Inputs: p_event_id (the event) and p_at (the moment to score at).
    Returns: the weighted average of the visible ratings saved in the 3 hours
      up to p_at (3 hours ago exactly still counts), rounded to 1 decimal; null
      when there are none. Ratings saved after p_at are ignored.
    The weight: 0.5 ^ (age in minutes / 30). A rating 30 minutes old counts
    half as much as a brand-new one, 60 minutes old a quarter, and so on.
    Why `security definer`: it reads every guest's rating, which app users
    can't. It's in the private schema, so the app can't call it directly.
  */
  select round(
    (sum(w.weight * r.score) / nullif(sum(w.weight), 0))::numeric,
    1
  )
  from public.ratings r
  -- The weight for this rating, from its age in minutes at p_at.
  cross join lateral (
    select power(0.5::double precision,
                 extract(epoch from (p_at - r.updated_at)) / 60.0 / 30.0)::numeric as weight
  ) w
  where r.event_id = p_event_id
    and r.hidden_at is null
    and r.updated_at <= p_at
    and r.updated_at >= p_at - interval '3 hours';
$$;

comment on function private.vibe_score_at(uuid, timestamptz) is
  'VC-B09: weighted average (weight 0.5^(age min/30)) of visible ratings saved in the 3 hours up to p_at, rounded to 1 decimal; null if none.';

-- -----------------------------------------------------------------------------
-- The core: everything the meter shows, for one event at one moment.
-- -----------------------------------------------------------------------------
create function private.event_vibe(p_event_id uuid, p_now timestamptz)
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
    state               'none', 'early', 'stale' or 'live' (see the header)
    raters              how many people's visible ratings count (all night)
    here                how many people checked in (VC-42 count only)
    score, label        live: the live score and its word; stale: the last
                        score (as it stood at the last rating) and its word;
                        none/early: null (no number until 5 ratings)
    night_average       stale and live: the plain average of all visible
                        ratings, rounded to 1 decimal; otherwise null
    last_rating_at      when the newest visible rating was saved (null if none)
    minutes_since_last  whole minutes since then (null if none), so the app
                        can say "updated 4 min ago" without trusting the
                        phone's clock
    reactions           stale and live: the reaction tally, most first, e.g.
                        [{"reaction": "fire", "count": 4}]; otherwise []
                        (with 1 to 4 raters a tally could give away one
                        person's reaction)
  Never returns who rated or any single rating.
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

  -- The reaction tally, only once there are enough raters (see above).
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
    'night_average', case when v_state in ('stale', 'live') then v_average end,
    'last_rating_at', v_last,
    'minutes_since_last',
      case when v_last is not null
           then floor(extract(epoch from (p_now - v_last)) / 60)::int end,
    'reactions', v_reactions
  );
end;
$$;

comment on function private.event_vibe(uuid, timestamptz) is
  'VC-B09 + VC-42: an event''s vibe at p_now (state, raters, here, score, label, night_average, last_rating_at, minutes_since_last, reactions). Totals only.';

-- -----------------------------------------------------------------------------
-- Helper: may the caller see this event's vibe?
-- -----------------------------------------------------------------------------
create function private.can_see_event(p_event_id uuid)
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
    event and the caller is a tester (the same rule as the events table's
    read policy); false otherwise.
*/
begin
  return exists (
    select 1 from public.events e
    where e.id = p_event_id
      and (not e.is_test or private.is_tester())
  );
end;
$$;

comment on function private.can_see_event(uuid) is
  'VC-B09: true when the event exists for the caller (test events only for testers).';

-- -----------------------------------------------------------------------------
-- get_event_vibe: the event page's meter.
-- -----------------------------------------------------------------------------
create function public.get_event_vibe(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: the live vibe of one event, right now.
  Input: p_event_id, the event.
  Returns: the JSON from private.event_vibe (state, raters, here, score,
    label, night_average, last_rating_at, minutes_since_last, reactions).
    The app asks again every 20 seconds while the event page is open.
  Rules: any signed-up adult who can see the event (admins too).
  Raises: 42501 for non-adults, VCNFD for an event the caller can't see.
  Why `security definer`: the score is built from everyone's ratings, which
  app users can't read; this hands out totals only.
*/
begin
  if auth.uid() is null or not private.is_adult_user() then
    raise exception 'Please sign in and finish setting up your profile first.'
      using errcode = '42501';
  end if;
  if not private.can_see_event(p_event_id) then
    raise exception 'That event doesn''t exist.' using errcode = 'VCNFD';
  end if;
  return private.event_vibe(p_event_id, now());
end;
$$;

comment on function public.get_event_vibe(uuid) is
  'VC-B09 + VC-42: the live vibe (totals only) of one event for the event page. Adults only; VCNFD for events the caller can''t see.';

-- -----------------------------------------------------------------------------
-- get_events_vibe: the Tonight list's scores, in one call.
-- -----------------------------------------------------------------------------
create function public.get_events_vibe(p_event_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: the live vibe of several events at once, for the Tonight list
  (one call instead of one per card).
  Input: p_event_ids, the events on the list (at most 100, the list's size).
  Returns: a JSON list, one item per event the caller can see, each the
    private.event_vibe JSON plus "event_id". Events that don't exist or that
    the caller can't see (test events for non-testers) are simply left out,
    so the list never errors because one event was removed. Repeated ids
    appear once.
  Raises: 42501 for non-adults, 22023 for more than 100 ids.
*/
begin
  if auth.uid() is null or not private.is_adult_user() then
    raise exception 'Please sign in and finish setting up your profile first.'
      using errcode = '42501';
  end if;
  if coalesce(cardinality(p_event_ids), 0) > 100 then
    raise exception 'Too many events at once.' using errcode = '22023';
  end if;

  return coalesce(
    (select jsonb_agg(private.event_vibe(ids.id, now()) || jsonb_build_object('event_id', ids.id))
     from (select distinct u.id from unnest(p_event_ids) u(id)) ids
     where ids.id is not null and private.can_see_event(ids.id)),
    '[]'::jsonb
  );
end;
$$;

comment on function public.get_events_vibe(uuid[]) is
  'VC-B09 + VC-42: the live vibe (totals only) of up to 100 events for the Tonight list; skips events the caller can''t see.';

-- -----------------------------------------------------------------------------
-- Who may run what: signed-in users may call the two public functions (the
-- checks inside decide the rest); anon can't; nobody from the app can call
-- the private helpers (in particular event_vibe, which takes a clock).
-- -----------------------------------------------------------------------------
revoke execute on function public.get_event_vibe(uuid) from public, anon;
grant execute on function public.get_event_vibe(uuid) to authenticated;

revoke execute on function public.get_events_vibe(uuid[]) from public, anon;
grant execute on function public.get_events_vibe(uuid[]) to authenticated;

revoke execute on function private.vibe_label(numeric) from public, anon, authenticated;
revoke execute on function private.vibe_score_at(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.event_vibe(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.can_see_event(uuid) from public, anon, authenticated;
