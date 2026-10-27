-- =============================================================================
-- Migration 8: GPS check-in (task VC-B06, proposals VC-20 and VC-05).
--
-- Plain-language background:
-- * When a guest taps "I'm here", the app reads the phone's location ONCE and
--   sends it here with the event id. This function compares it with the
--   party's secret pin and radius (public.event_private, which no app user
--   can read) and answers "passed" or why not.
-- * Privacy rule (VC-20): the phone's latitude and longitude are used for
--   the distance sum and then thrown away. They are never written to any
--   table, never put in an error message, and never logged (no RAISE NOTICE).
--   What IS kept: pass/fail, the time, and a rough accuracy band such as
--   "25-75m" (public.check_in_attempts), plus the check-in itself
--   (public.check_ins: who, which event, when).
-- * The answer never says HOW far away someone is. A distance would let a
--   person with a fake-GPS app find a house party's pin in a few tries.
--
-- The rules (team/projects/vibecheck/mvp-plan.md, "Check-in rules"):
--   window    from 30 minutes before the start to 60 minutes after the end,
--             both edges included;
--   weak      accuracy worse than 300 m -> 'weak_signal' (the app offers the
--             party code instead);
--   distance  pass when distance <= radius + allowance, where the allowance
--             is the phone's reported accuracy, capped at 75 m. (A phone that
--             says "I'm within 40 m of this spot" gets 40 m of slack; nobody
--             gets more than 75 m.);
--   limits    at most 20 attempts an hour per person (any event), and
--             check-ins to at most 8 different events in 24 hours. Several
--             events a night is fine (founder rule, VC-05);
--   repeat    checking in again to the same event is fine: it keeps the
--             first check-in time and refreshes last_verified_at (the rating
--             step, VC-B08, needs a check within the last 45 minutes);
--   test      test events can only be checked in to by testers; to everyone
--             else they don't exist (same as the events RLS rule, VC-B02).
--
-- Answers are returned (not raised) so the attempt row is kept: an error
-- would roll back the insert, and the hourly limit would stop counting.
-- Errors are raised only when nothing should be recorded:
--   42501  not signed in, no profile, or under 18
--   VCNFD  no such event (or a test event and the caller isn't a tester)
--   VCGPS  the reading itself is broken (missing or impossible numbers)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: distance between two points on Earth, in metres.
-- -----------------------------------------------------------------------------
create function private.distance_m(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
strict
set search_path = ''
as $$
  /*
    What it does: works out how far apart two map points are, in metres,
    along the Earth's surface.
    Inputs: two points as latitude and longitude in degrees.
    Returns: the distance in metres (null if any input is null).
    How: the "haversine" formula, the standard way to measure distance on a
    sphere. 6371008.8 m is the Earth's mean radius. At party distances (a few
    hundred metres) it is accurate to well under a metre, which is far finer
    than any phone's GPS. `least(1, ...)` guards against a rounding error
    pushing the value just over 1, which asin can't take.
    Why not PostGIS: one formula is all we need, and it keeps the database
    free of an extra extension.
  */
  select 2 * 6371008.8 * asin(least(1.0, sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2))
      * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  )));
$$;

comment on function private.distance_m(double precision, double precision, double precision, double precision) is
  'VC-B06: great-circle (haversine) distance in metres between two lat/lng points.';

-- -----------------------------------------------------------------------------
-- Helper: turn an exact GPS accuracy into a rough band.
-- -----------------------------------------------------------------------------
create function private.accuracy_bucket(p_accuracy_m double precision)
returns text
language sql
immutable
set search_path = ''
as $$
  /*
    What it does: sorts a GPS accuracy (in metres) into one of four bands.
    Input: p_accuracy_m, how sure the phone is about its position (smaller
    is better; "20" means "within about 20 m").
    Returns: '0-25m', '25-75m', '75-300m' or '300m+' (null for null input).
    Why bands: we want to learn how often GPS is weak indoors without
    keeping exact numbers about anyone's phone (VC-20). The bands line up
    with the rules: up to 75 m counts as allowance in full, over 300 m is
    "weak signal".
  */
  select case
    when p_accuracy_m is null then null
    when p_accuracy_m < 25 then '0-25m'
    when p_accuracy_m < 75 then '25-75m'
    when p_accuracy_m <= 300 then '75-300m'
    else '300m+'
  end;
$$;

comment on function private.accuracy_bucket(double precision) is
  'VC-B06: GPS accuracy band (0-25m, 25-75m, 75-300m, 300m+) stored instead of exact numbers.';

-- -----------------------------------------------------------------------------
-- check_in: "I'm here" with GPS.
-- -----------------------------------------------------------------------------
create function public.check_in(
  p_event_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: decides whether the caller is at the event right now, using
  one location reading from their phone, and records the outcome.
  Inputs:
    p_event_id    which event they say they're at
    p_lat, p_lng  the phone's position in degrees (used, never stored)
    p_accuracy_m  the phone's own accuracy estimate in metres
  Returns: a small JSON answer. "status" is one of:
    'passed'             checked in. Also: first_at (first check-in time) and
                         already_checked_in (true on a repeat check).
    'too_far'            outside the party area. No distance is given.
    'weak_signal'        accuracy worse than 300 m; offer the party code.
    'outside_window'     too early or too late. Also: reason ('too_early' or
                         'too_late'), opens_at and closes_at.
    'too_many_attempts'  20 tries in the last hour. Also: retry_after_minutes.
    'too_many_events'    already checked in to 8 other events in 24 hours.
  Why `security definer`: the app can't read the secret pin or write the
  check-in tables. This function runs with the owner's rights, but only for
  a signed-up adult, and only ever reveals pass/fail.
*/
declare
  v_uid uuid := auth.uid();
  v_event public.events%rowtype;
  v_private public.event_private%rowtype;
  v_now timestamptz := now();
  v_opens_at timestamptz;
  v_closes_at timestamptz;
  v_bucket text;
  v_tries integer;
  v_oldest_try timestamptz;
  v_already boolean;
  v_other_events integer;
  v_first_at timestamptz;
begin
  -- 1. Signed-up adults only. Not signed in, no profile (never finished the
  --    age gate) or under 18: refused. anon can't even call this (grants
  --    at the bottom); this check is the second lock.
  if v_uid is null or not private.is_adult_user() then
    raise exception 'Please sign in and finish setting up your profile first.'
      using errcode = '42501';
  end if;

  -- 2. The reading must make sense. NaN ("not a number") and infinity fail
  --    the "between" tests in Postgres, so they are refused here too.
  --    The message never repeats the numbers (privacy).
  if p_lat is null or p_lng is null or p_accuracy_m is null
     or p_lat not between -90 and 90
     or p_lng not between -180 and 180
     or p_accuracy_m < 0
     or p_accuracy_m = 'NaN'::double precision then
    raise exception 'We couldn''t read your location. Please try again.'
      using errcode = 'VCGPS';
  end if;

  -- 3. Find the event. Test events exist only for testers (VC-B02): to
  --    anyone else the answer is the same as "no such event", so the app
  --    can't even learn that a test event exists.
  select * into v_event from public.events e where e.id = p_event_id;
  if not found or (v_event.is_test and not private.is_tester()) then
    raise exception 'That event doesn''t exist.' using errcode = 'VCNFD';
  end if;
  select * into v_private from public.event_private ep where ep.event_id = p_event_id;
  if not found then
    -- Every event made through create_event has a pin; this only catches
    -- hand-made rows without one.
    raise exception 'That event doesn''t exist.' using errcode = 'VCNFD';
  end if;

  -- 4. One check-in at a time per person. Two taps at once could otherwise
  --    both slip under the limits below. The lock is released when this
  --    call ends. `hashtext` turns the text into the number the lock needs.
  perform pg_advisory_xact_lock(hashtext('vibecheck.check_in:' || v_uid::text));

  -- 5. Hourly limit: at most 20 attempts in the last 60 minutes, counting
  --    every event and every kind of attempt (GPS and, later, codes). A
  --    refused-for-limit call is NOT recorded, so waiting always works.
  select count(*), min(a.at) into v_tries, v_oldest_try
  from public.check_in_attempts a
  where a.user_id = v_uid
    and a.at > v_now - interval '1 hour';
  if v_tries >= 20 then
    return jsonb_build_object(
      'status', 'too_many_attempts',
      -- Minutes until the oldest attempt in the hour stops counting
      -- (rounded up, at least 1).
      'retry_after_minutes',
      greatest(1, ceil(extract(epoch from (v_oldest_try + interval '1 hour' - v_now)) / 60)::int)
    );
  end if;

  v_bucket := private.accuracy_bucket(p_accuracy_m);

  -- 6. The event window: 30 minutes before the start to 60 minutes after
  --    the end, both edges included.
  v_opens_at := v_event.starts_at - interval '30 minutes';
  v_closes_at := v_event.ends_at + interval '60 minutes';
  if v_now < v_opens_at or v_now > v_closes_at then
    insert into public.check_in_attempts (user_id, event_id, result, accuracy_bucket)
    values (v_uid, p_event_id, 'outside_window', v_bucket);
    return jsonb_build_object(
      'status', 'outside_window',
      'reason', case when v_now < v_opens_at then 'too_early' else 'too_late' end,
      'opens_at', v_opens_at,
      'closes_at', v_closes_at
    );
  end if;

  -- 7. The 8-events limit, checked BEFORE the distance so this answer
  --    never hints at whether the reading was close. A repeat check-in to
  --    an event they're already in is always allowed.
  select exists (
    select 1 from public.check_ins c where c.user_id = v_uid and c.event_id = p_event_id
  ) into v_already;
  if not v_already then
    select count(*) into v_other_events
    from public.check_ins c
    where c.user_id = v_uid
      and c.first_at > v_now - interval '24 hours';
    if v_other_events >= 8 then
      return jsonb_build_object('status', 'too_many_events');
    end if;
  end if;

  -- 8. Weak signal: the phone itself says it could be more than 300 m off,
  --    so a pass or fail would be a guess. Checked before the distance, so
  --    a vague reading reveals nothing about where the pin is.
  if p_accuracy_m > 300 then
    insert into public.check_in_attempts (user_id, event_id, result, accuracy_bucket)
    values (v_uid, p_event_id, 'weak_signal', v_bucket);
    return jsonb_build_object('status', 'weak_signal');
  end if;

  -- 9. The distance rule: within the radius plus the phone's accuracy,
  --    with that allowance capped at 75 m.
  if private.distance_m(p_lat, p_lng, v_private.lat, v_private.lng)
     > v_private.radius_m + least(p_accuracy_m, 75) then
    insert into public.check_in_attempts (user_id, event_id, result, accuracy_bucket)
    values (v_uid, p_event_id, 'too_far', v_bucket);
    return jsonb_build_object('status', 'too_far');
  end if;

  -- 10. Passed. Record the attempt, then create the check-in, or refresh
  --     it on a repeat (first_at and method stay as they were).
  insert into public.check_in_attempts (user_id, event_id, result, accuracy_bucket)
  values (v_uid, p_event_id, 'passed', v_bucket);

  insert into public.check_ins as c (user_id, event_id, method, first_at, last_verified_at)
  values (v_uid, p_event_id, 'gps', v_now, v_now)
  on conflict (user_id, event_id) do update
    set last_verified_at = excluded.last_verified_at
  returning c.first_at into v_first_at;

  return jsonb_build_object(
    'status', 'passed',
    'first_at', v_first_at,
    'already_checked_in', v_already
  );
end;
$$;

comment on function public.check_in(uuid, double precision, double precision, double precision) is
  'VC-B06: GPS check-in for signed-up adults. Compares the reading with the private pin/radius; stores only pass/fail, time and an accuracy band, never coordinates.';

-- -----------------------------------------------------------------------------
-- Who may run what. Take away the default "everyone may run it", then:
-- * check_in: signed-in users only (the adult check inside decides the rest).
--   anon (not signed in) can't call it at all.
-- * the helpers: nobody from the app; check_in uses them with owner rights.
-- -----------------------------------------------------------------------------
revoke execute on function public.check_in(uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.check_in(uuid, double precision, double precision, double precision) to authenticated;

revoke execute on function private.distance_m(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke execute on function private.accuracy_bucket(double precision) from public, anon, authenticated;
