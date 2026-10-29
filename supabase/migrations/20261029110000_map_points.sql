-- =============================================================================
-- Migration: the map view's data (VC-79, founder approved 2026-10-28;
-- design/vc79-map-spec.md, with the founder's change of the same day).
--
-- What it adds:
--   1. public.area_centroids: one fixed centre point (and circle size) per
--      area label in the admin form's list (src/data/dmv-areas.ts), including
--      the Baltimore and Richmond ones (VC-62). These are PUBLIC facts: the
--      commonly cited centre of each neighbourhood, approximate, the same for
--      every event in that area. No app user can read the table directly;
--      only get_map_points reads it.
--   2. private.map_settings: ONE row holding the "venue pins for staff
--      picks" switch, OFF. The founder hasn't decided yet whether staff picks
--      may show an exact venue pin, so every event is drawn as an area circle
--      for now. Turning pins on is meant to be a one-line migration that the
--      cto reviews:
--        update private.map_settings set staff_pick_pins = true;
--   3. public.get_map_points(...): what the map draws, for the same date
--      window as the Tonight list.
--
-- Privacy (the important part):
--   - With the switch OFF (now), the only coordinates that ever leave the
--     database are area centres from area_centroids. event_private (where the
--     party really is) is never read: the one place that reads it sits inside
--     a CASE that only runs when the switch is on, and Postgres doesn't run
--     the inside of a CASE branch that isn't taken.
--   - With the switch ON, only staff picks WITH a ticket link get a venue
--     point (rounded to 4 decimals, about 11 m); house parties always stay
--     area circles. A staff pick without a ticket link stays a circle too, so
--     a wrong "source" pick can't expose someone's home.
--   - Circles are at least 600 m across the radius, so a circle never
--     narrows a party down to a street.
--   - Area labels not in the table (typed as free text by an admin) come back
--     with NO coordinates at all (kind 'none'), so the app can say "N events
--     aren't on the map. See the list".
--
-- Rate limit: none, on purpose, matching the other read functions
-- (get_events_vibe, the events table itself). Like them it caps the size of
-- one answer (300 rows, plus one extra row that only says "there are more").
--
-- Error codes:
--   42501  not signed in, or not a signed-up adult (anon can't even call it)
--   22023  the window is missing a required edge
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Area centres
-- -----------------------------------------------------------------------------
create table public.area_centroids (
  -- Exactly as guests see it and as events.area_label holds it, e.g. "Shaw, DC".
  label text primary key,
  -- The neighbourhood's commonly cited centre, in degrees (approximate).
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  -- How big the circle is drawn, in metres. Never under 600 (privacy floor):
  -- 600 for compact areas (Shaw, U Street), up to 2000 for spread-out ones
  -- (Fairfax, Tysons, Midlothian).
  radius_m integer not null check (radius_m between 600 and 5000)
);

comment on table public.area_centroids is
  'VC-79: one public, approximate centre point and circle size per area label, for the map. Read only by get_map_points; no app access.';
comment on column public.area_centroids.radius_m is
  'Circle radius in metres, 600 or more (privacy floor; spread-out areas get more).';

-- Public facts, but the app never reads the table itself: only the map
-- function does (so the join to events happens on the server).
revoke all on table public.area_centroids from public, anon, authenticated;
alter table public.area_centroids enable row level security;

-- Seed: every label in src/data/dmv-areas.ts (a Jest test fails if one is
-- missing here). Centres are the commonly cited neighbourhood centres
-- (approximate, a few hundred metres at most from any official point).
insert into public.area_centroids (label, lat, lng, radius_m) values
  -- DC
  ('Adams Morgan, DC',            38.9215, -77.0422,  600),
  ('Anacostia, DC',               38.8628, -76.9850,  900),
  ('Brookland, DC',               38.9339, -76.9947,  800),
  ('Capitol Hill, DC',            38.8867, -76.9970, 1000),
  ('Columbia Heights, DC',        38.9285, -77.0325,  700),
  ('Dupont Circle, DC',           38.9096, -77.0434,  600),
  ('Foggy Bottom, DC',            38.9007, -77.0505,  600),
  ('Georgetown, DC',              38.9097, -77.0654,  800),
  ('H Street, DC',                38.9002, -76.9900,  600),
  ('Logan Circle, DC',            38.9096, -77.0296,  600),
  ('Mount Pleasant, DC',          38.9310, -77.0384,  600),
  ('Navy Yard, DC',               38.8764, -77.0030,  600),
  ('NoMa, DC',                    38.9070, -77.0030,  600),
  ('Penn Quarter/Chinatown, DC',  38.8990, -77.0219,  600),
  ('Petworth, DC',                38.9420, -77.0240,  800),
  ('Shaw, DC',                    38.9123, -77.0219,  600),
  ('Southwest Waterfront, DC',    38.8775, -77.0145,  600),
  ('The Wharf, DC',               38.8798, -77.0255,  600),
  ('U Street, DC',                38.9170, -77.0290,  600),
  ('Union Market, DC',            38.9085, -76.9975,  600),
  -- Maryland
  ('Bethesda, MD',                38.9847, -77.0947, 1200),
  ('College Park, MD',            38.9807, -76.9369, 1200),
  ('Hyattsville, MD',             38.9559, -76.9455, 1000),
  ('Largo, MD',                   38.8976, -76.8303, 1500),
  ('National Harbor, MD',         38.7826, -77.0170,  800),
  ('Rockville, MD',               39.0840, -77.1528, 2000),
  ('Silver Spring, MD',           38.9907, -77.0261, 1200),
  ('Takoma Park, MD',             38.9779, -77.0075, 1000),
  ('Wheaton, MD',                 39.0398, -77.0553, 1200),
  -- Baltimore (VC-62)
  ('Canton, MD',                  39.2810, -76.5780,  700),
  ('Downtown Baltimore, MD',      39.2904, -76.6122,  900),
  ('Federal Hill, MD',            39.2790, -76.6110,  600),
  ('Fells Point, MD',             39.2830, -76.5920,  600),
  ('Mount Vernon (Baltimore), MD',39.2980, -76.6150,  600),
  -- Virginia
  ('Ballston, VA',                38.8823, -77.1110,  700),
  ('Clarendon, VA',               38.8868, -77.0953,  600),
  ('Courthouse, VA',              38.8910, -77.0850,  600),
  ('Crystal City/National Landing, VA', 38.8570, -77.0510, 900),
  ('Del Ray, VA',                 38.8270, -77.0590,  800),
  ('Fairfax, VA',                 38.8462, -77.3064, 2000),
  ('Falls Church, VA',            38.8823, -77.1711, 1500),
  ('Old Town Alexandria, VA',     38.8048, -77.0469,  900),
  ('Reston, VA',                  38.9586, -77.3570, 2000),
  ('Rosslyn, VA',                 38.8966, -77.0720,  600),
  ('Shirlington, VA',             38.8417, -77.0880,  600),
  ('Tysons, VA',                  38.9187, -77.2311, 2000),
  -- Richmond area (VC-62)
  ('Downtown Richmond, VA',       37.5407, -77.4360, 1000),
  ('Midlothian, VA',              37.5057, -77.6491, 2000),
  ('Scott''s Addition, VA',       37.5710, -77.4710,  700),
  ('Shockoe Bottom, VA',          37.5330, -77.4290,  600),
  ('The Fan, VA',                 37.5500, -77.4650,  900);

-- -----------------------------------------------------------------------------
-- 2. The venue-pin switch (OFF)
-- -----------------------------------------------------------------------------
create table private.map_settings (
  -- Always true: the primary key plus this check allow exactly one row.
  id boolean primary key default true check (id),
  -- false: every event is an area circle (the default while the founder
  -- decides). true: staff picks with a ticket link get a venue pin.
  staff_pick_pins boolean not null default false
);

comment on table private.map_settings is
  'VC-79: the single map settings row. staff_pick_pins (default false) is the switch for exact venue pins on staff picks; changing it needs a migration and cto review.';

revoke all on table private.map_settings from public, anon, authenticated;
alter table private.map_settings enable row level security;

insert into private.map_settings (id, staff_pick_pins) values (true, false);

-- -----------------------------------------------------------------------------
-- 3. get_map_points
-- -----------------------------------------------------------------------------
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
  vibe_word text
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
  Raises: 42501 for non-adults, 22023 for a missing window edge.
  Why security definer: the caller can't read area_centroids (or
    event_private) at all; this function joins them on the server and hands
    back only what the map may show. It applies the events read rule itself
    (adults only; test events only for testers and admins).
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
  )
  select
    pt.id,
    pt.title,
    pt.area_label,
    pt.starts_at,
    pt.ends_at,
    pt.source,
    pt.is_test,
    -- A venue only when its point was found; otherwise the area (or none).
    case when pt.v_lat is not null then 'venue'
         when pt.c_lat is not null then 'area'
         else 'none' end,
    coalesce(pt.v_lat, pt.c_lat),
    case when pt.v_lat is not null then pt.v_lng else pt.c_lng end,
    -- The privacy floor again, in case a row ever slipped under 600.
    case when pt.v_lat is null and pt.c_lat is not null
         then greatest(600, pt.c_radius) end,
    pt.starts_at <= now(),
    pt.starts_at <= now() and pt.ends_at > now(),
    -- The word only after the start; 'Early' when there are ratings but too
    -- few for a word; null when nobody has rated yet.
    case when pt.starts_at <= now() then (
      select case when v.vibe ->> 'label' is not null then v.vibe ->> 'label'
                  when v.vibe ->> 'state' = 'early' then 'Early'
             end
      from (select private.published_vibe(pt.id, now()) as vibe) v
    ) end
  from pointed pt
  order by pt.starts_at, pt.id;
end;
$$;

comment on function public.get_map_points(timestamptz, timestamptz, timestamptz) is
  'VC-79: the map''s points for one date window: area centres only (radius 600 m or more) while private.map_settings.staff_pick_pins is false; adults only; test events only for testers and admins; at most 301 rows.';

-- Only signed-in users may call it (it checks for an adult itself).
revoke execute on function public.get_map_points(timestamptz, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_map_points(timestamptz, timestamptz, timestamptz)
  to authenticated;
