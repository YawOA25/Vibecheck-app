-- =============================================================================
-- Migration 10: cap "too far" GPS answers per event (proposal VC-36, the B06
-- review's debt item B06-D1, approved by the founder 2026-10-27).
--
-- Plain-language background:
-- * GPS check-in (migration 8, 20261026190000_check_in.sql) answers "too far"
--   when the phone is outside the party area. It never says HOW far, but
--   each "too far" still says "the pin is not here". Someone with a fake-GPS
--   app could make about 20 guesses an hour (the hourly limit) and slowly
--   narrow down where a private house party is.
-- * The fix: after 5 "too far" answers for one event, that person can't use
--   GPS for that event again, for the WHOLE event (not a rolling hour). The
--   answer becomes 'gps_locked' and the app offers the party code instead
--   (check_in_with_code, migration 9), which keeps working as before.
-- * Why the whole event and not an hour (unlike the party-code lock, which
--   is a rolling hour): an hourly reset would still let a patient guesser
--   make 5 new guesses every hour all night. A real guest who is truly at
--   the party has the party code at the door.
-- * Other people and other events are unaffected: the count is per person
--   AND per event.
--
-- What changes: only public.check_in, replaced with the same inputs and the
-- same answers plus one new step (4b below) and one new status. Applied
-- migrations are never edited; this file replaces the function instead.
-- `create or replace` keeps the existing grants (signed-in users only), and
-- they are restated at the bottom anyway so this file reads on its own.
-- The 'too_far' rows the cap counts are already stored with their event id
-- in public.check_in_attempts (still no coordinates, VC-20).
-- =============================================================================

create or replace function public.check_in(
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
    'gps_locked'         (VC-36) 5 'too far' answers for this event already:
                         GPS check-in is off for this person and this
                         event for good. The party code still works.
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
  v_too_far integer;
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

  -- 4b. The 'too far' cap (VC-36). After 5 'too far' answers for THIS
  --     event, GPS check-in stays off for this person and this event for
  --     the whole event (not a rolling hour). Why: each "too far" tells a
  --     fake-GPS user "the pin is not here", so unlimited tries would let
  --     them narrow down a private house party's pin. 5 is plenty for a
  --     real guest walking up to the door.
  --     Where this sits matters: it only counts PAST answers, and it runs
  --     before the weak-signal and distance checks, so the answer is the
  --     same wherever the phone is: a locked person learns nothing new,
  --     not even from inside the radius. It also runs inside the per-person
  --     lock above, so two taps at once cannot squeeze in a 6th distance
  --     check. The refusal is NOT recorded as an attempt: nothing was
  --     measured, and the party code (check_in_with_code) is unaffected.
  select count(*) into v_too_far
  from public.check_in_attempts a
  where a.user_id = v_uid
    and a.event_id = p_event_id
    and a.result = 'too_far';
  if v_too_far >= 5 then
    return jsonb_build_object('status', 'gps_locked');
  end if;

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
  'VC-B06 + VC-36: GPS check-in for signed-up adults. Compares the reading with the private pin/radius; stores only pass/fail, time and an accuracy band, never coordinates. After 5 too_far answers for an event, answers gps_locked for that event.';

-- Same rights as before: signed-in users may call it; anon may not.
revoke execute on function public.check_in(uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.check_in(uuid, double precision, double precision, double precision) to authenticated;
