-- =============================================================================
-- Migration: the map's published score (VC-83 map v2, Batch 1; founder
-- approved the mock 2026-10-29; design/vc83-map-v2-spec.md, "cto review
-- (2026-10-29)" point 3).
--
-- What it changes: public.get_map_points(timestamptz, timestamptz,
-- timestamptz) gets two more columns at the end:
--   vibe_score  the score from the event's last PUBLISHED snapshot, rounded
--               to 1 decimal (e.g. 8.4). Only once the event has started AND
--               the snapshot is 'live' or 'stale' (5+ raters). Null before
--               the start, with nobody rated, or with 1-4 raters.
--   vibe_stale  true when that score is 'stale' (its newest rating is 90+
--               minutes old), so the app doesn't pulse it. False otherwise.
-- Everything else is copied unchanged from 20261029110000_map_points.sql:
-- area centres only while the staff-pick pin switch is off (it stays off),
-- a venue point only for a staff pick with a ticket link and the switch on,
-- circles 600 m or more, test events only for testers and admins, adults
-- only, at most 301 rows, empty search_path, anon refused.
--
-- Why return the score here instead of the app joining get_events_vibe
-- (cto, 2026-10-29): this function already calls private.published_vibe for
-- the word, so the number comes from the SAME call and the same snapshot (a
-- word and a number can't come from two different publishes). The join
-- would also have sent the rater count and the live headcount ("here") to a
-- screen that must never show them. This function sends neither.
--
-- Privacy: the score is the same published number the event page already
-- shows; it changes only when publish_event_vibe writes a new snapshot
-- (after 2+ different people rate), never per rating, so polling the map
-- learns nothing the list doesn't already say.
--
-- Why drop and recreate: Postgres can't change a function's returned
-- columns with "create or replace". Dropping also drops its grants, so they
-- are given again at the bottom. Older app builds simply ignore the two
-- extra columns.
-- =============================================================================

drop function public.get_map_points(timestamptz, timestamptz, timestamptz);

create function public.get_map_points(
  p_ends_after timestamptz,
  p_starts_from timestamptz,
  p_starts_before timestamptz
)
returns table (
  event_id uuid,
  title text,
  area_label text,
  starts_at timestamptz,
  ends_at timestamptz,
  source text,
  is_test boolean,
  kind text,
  lat double precision,
  lng double precision,
  radius_m integer,
  has_started boolean,
  is_live boolean,
  vibe_word text,
  vibe_score numeric,
  vibe_stale boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: lists what the map draws for one date window.
  Inputs (the same window as the Tonight list, src/lib/date-filter.ts
    filterWindow):
    p_ends_after     only events that end after this moment (required)
    p_starts_from    only events starting at or after this (null = no limit)
    p_starts_before  only events starting before this (required)
  Returns: one row per event the caller may see (soonest first, then by id),
    at most 301 rows: the app shows 300, and a 301st row only means "there
    are more, narrow the dates". Each row:
      event_id, title, area_label, starts_at, ends_at, source, is_test
                   public facts the Tonight list already shows
      kind         'area'  a circle around the area's centre (every event
                           while the venue-pin switch is off)
                   'venue' a staff pick's venue (only with the switch on)
                   'none'  the area isn't in area_centroids (free text): no
                           coordinates, shown in the list only
      lat, lng     the area centre ('area'), the venue rounded to 4 decimals
                   ('venue'), or null ('none')
      radius_m     the circle's radius, 600 or more ('area'); null otherwise
      has_started  true once starts_at has passed
      is_live      started and not ended yet
      vibe_word    only once started: the published word ("Hot", "Fire",
                   ...), 'Early' with too few ratings for a word, or null
                   when nobody has rated yet. Always null before the start
                   (VC-61: nothing about ratings shows early).
      vibe_score   (VC-83) only once started and only with a published
                   'live' or 'stale' snapshot (5+ raters): its score rounded
                   to 1 decimal. Null otherwise.
      vibe_stale   (VC-83) true only when that score is 'stale'.
    No rater count and no headcount: the map must never show them.
  Raises: 42501 for non-adults, 22023 for a missing window edge.
  Why security definer: the caller can't read area_centroids (or
    event_private, or the snapshots) at all; this function joins them on the
    server and hands back only what the map may show. It applies the events
    read rule itself (adults only; test events only for testers and admins).
*/
declare
  -- Read once. While false, event_private is never touched (see the CASE).
  v_pins boolean := coalesce(
    (select s.staff_pick_pins from private.map_settings s where s.id), false);
begin
  if auth.uid() is null or not private.is_adult_user() then
    raise exception 'Please sign in and finish setting up your profile first.'
      using errcode = '42501';
  end if;
  if p_ends_after is null or p_starts_before is null then
    raise exception 'The map needs a date window.' using errcode = '22023';
  end if;

  return query
  with picked as (
    -- The events in the window that the caller may see (the same rules as
    -- the events table's read policy), soonest first, capped at 301.
    select e.id, e.title, e.area_label, e.starts_at, e.ends_at, e.source,
           e.is_test, e.ticket_url
    from public.events e
    where e.ends_at > p_ends_after
      and e.starts_at < p_starts_before
      and (p_starts_from is null or e.starts_at >= p_starts_from)
      and (not e.is_test or private.can_read_test_events())
    order by e.starts_at, e.id
    limit 301
  ),
  placed as (
    -- How each event is drawn. A venue point is only possible with the
    -- switch on AND a staff pick AND a ticket link (the second guard).
    select p.*, c.lat as c_lat, c.lng as c_lng, c.radius_m as c_radius,
           (v_pins and p.source = 'staff_pick' and p.ticket_url is not null) as venue
    from picked p
    left join public.area_centroids c on c.label = btrim(p.area_label)
  ),
  pointed as (
    select pl.*,
           -- The venue point. These subqueries sit in CASE branches that only
           -- run when pl.venue is true, i.e. never while the switch is off.
           -- Rounded to 4 decimals (about 11 m): the venue, not a spot in it.
           case when pl.venue then (
             select round(ep.lat::numeric, 4)::double precision
             from public.event_private ep where ep.event_id = pl.id
           ) end as v_lat,
           case when pl.venue then (
             select round(ep.lng::numeric, 4)::double precision
             from public.event_private ep where ep.event_id = pl.id
           ) end as v_lng
    from placed pl
  ),
  vibed as (
    -- The published vibe, read ONCE per started event (the word, the score
    -- and the stale flag all come from this one snapshot). Before the start
    -- the lateral subquery returns no row, so vibe stays null.
    select pt.*, v.vibe
    from pointed pt
    left join lateral (
      select private.published_vibe(pt.id, now()) as vibe
      where pt.starts_at <= now()
    ) v on true
  )
  select
    vb.id,
    vb.title,
    vb.area_label,
    vb.starts_at,
    vb.ends_at,
    vb.source,
    vb.is_test,
    -- A venue only when its point was found; otherwise the area (or none).
    case when vb.v_lat is not null then 'venue'
         when vb.c_lat is not null then 'area'
         else 'none' end,
    coalesce(vb.v_lat, vb.c_lat),
    case when vb.v_lat is not null then vb.v_lng else vb.c_lng end,
    -- The privacy floor again, in case a row ever slipped under 600.
    case when vb.v_lat is null and vb.c_lat is not null
         then greatest(600, vb.c_radius) end,
    vb.starts_at <= now(),
    vb.starts_at <= now() and vb.ends_at > now(),
    -- The word only after the start (vibe is null before it); 'Early' when
    -- there are ratings but too few for a word; null when nobody rated yet.
    case when vb.vibe ->> 'label' is not null then vb.vibe ->> 'label'
         when vb.vibe ->> 'state' = 'early' then 'Early'
    end,
    -- The number only for 'live' and 'stale' (5+ raters: the floor lives in
    -- published_vibe, which also nulls the score in every other state).
    -- Rounded to 1 decimal, the way the app writes it ("8.4").
    case when vb.vibe ->> 'state' in ('live', 'stale')
         then round((vb.vibe ->> 'score')::numeric, 1) end,
    coalesce(vb.vibe ->> 'state' = 'stale', false)
  from vibed vb
  order by vb.starts_at, vb.id;
end;
$$;

comment on function public.get_map_points(timestamptz, timestamptz, timestamptz) is
  'VC-79 + VC-83: the map''s points for one date window: area centres only (radius 600 m or more) while private.map_settings.staff_pick_pins is false; adults only; test events only for testers and admins; at most 301 rows. Once started: the published vibe word, and the published score (1 decimal) only for live or stale snapshots (5+ raters). Never a rater count or headcount.';

-- Only signed-in users may call it (it checks for an adult itself). The drop
-- above removed the old grants, so they are given again here.
revoke execute on function public.get_map_points(timestamptz, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_map_points(timestamptz, timestamptz, timestamptz)
  to authenticated;
