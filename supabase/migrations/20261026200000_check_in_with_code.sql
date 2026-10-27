-- =============================================================================
-- Migration 9: party-code check-in and the tester check-in (task VC-B07).
--
-- Plain-language background:
-- * Indoors, a phone's GPS is often too weak to prove someone is at the party
--   (B06 answers 'weak_signal'). The fallback: the host shows a 6-character
--   party code on a card at the party (event_private.check_in_code, made by
--   create_event and replaceable with update_event's "rotate code"). A guest
--   who types the right code, while the event is on, is checked in exactly as
--   if GPS had passed, except check_ins.method is 'code'. Ratings (VC-B08)
--   only look at check_ins, so both ways count the same.
-- * Testers (profiles.is_tester, e.g. the Apple reviewer account) can check
--   in to TEST events with one tap, with no GPS and no code, so App Review
--   and our own testing work from anywhere. On a real event the server
--   refuses it, so a tester can never move a real party's score.
--
-- The rules for the party code:
--   on/off    the code works only when the admin turned it on for the event
--             (events.code_check_in_enabled);
--   window    the same window as GPS: 30 minutes before the start to 60
--             minutes after the end, both edges included. Outside it, the
--             code isn't even compared, so a guess there teaches nothing;
--   lock      5 wrong codes for one event within 60 minutes lock code entry
--             for that person and that event. DECISION (VC-B07): the lock is
--             a rolling 60-minute cool-down, not a lock for the whole event.
--             Why: mvp-plan.md says "five wrong codes in an hour"; a real
--             guest who mistypes 5 times can try again later instead of
--             being shut out of the party for good; and it still stops
--             guessing (32^6 = about a billion codes, at most 5 tries an
--             hour). While locked, even the RIGHT code is refused, otherwise
--             the lock would not stop a guesser. Each wrong try stops
--             counting 60 minutes after it was made;
--   limits    the B06 limits apply to codes too: 20 attempts an hour per
--             person (GPS and codes together), and at most 8 different
--             events in 24 hours;
--   repeat    typing the code again for an event you're already in is fine:
--             it keeps the first check-in time and method, and refreshes
--             last_verified_at (same as a repeat GPS check);
--   rotation  the code is read fresh from event_private on every try, so
--             after "rotate code" the old code is simply wrong.
--
-- Privacy (VC-20): the typed code is compared and then thrown away. It is
-- never written to a table (check_in_attempts keeps only the result and the
-- time), never repeated in an error message, and never logged. The real
-- code is never returned to the caller.
--
-- Constant-time comparison: a normal "=" on text can stop at the first
-- different letter, so in theory a guesser could time the answers to learn
-- letters one by one. private.codes_match looks at all 6 letters every time.
-- (Network delays dwarf this, and the 5-try lock already stops guessing; it
-- is cheap extra care.)
--
-- Answers are returned (not raised) when an attempt row must be kept;
-- errors are raised only when nothing should be recorded:
--   42501  not signed in, no profile, under 18 (and, for the tester
--          check-in, not a tester)
--   VCNFD  no such event (or a test event and the caller isn't a tester)
--   VCCOD  the text can't be a party code (not 6 letters/digits); not
--          counted as a wrong try, since it can never be right
--   VCOVR  tester check-in on a real (non-test) event
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: compare two party codes without stopping early.
-- -----------------------------------------------------------------------------
create function private.codes_match(p_typed text, p_real text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
/*
  What it does: says whether the typed code equals the real code, taking
  the same time whichever letter is wrong.
  Inputs: p_typed (already cleaned up: capitals, 6 characters) and p_real
  (the code from event_private).
  Returns: true when they are the same, false otherwise (also for null).
  How: for each position it XORs ("#") the two letters' character numbers.
  XOR is 0 only when the letters match. It ORs ("|") all those results
  together, so the total is 0 only if every letter matched. All 6 letters
  are always looked at; there is no early exit.
*/
declare
  v_diff integer := 0;
begin
  -- Codes are always 6 characters (a check on event_private and on the
  -- input guarantees it), so the length itself is no secret.
  if p_typed is null or p_real is null or length(p_typed) <> length(p_real) then
    return false;
  end if;
  for i in 1 .. length(p_real) loop
    v_diff := v_diff | (ascii(substr(p_typed, i, 1)) # ascii(substr(p_real, i, 1)));
  end loop;
  return v_diff = 0;
end;
$$;

comment on function private.codes_match(text, text) is
  'VC-B07: constant-time comparison of a typed party code with the real one.';

-- -----------------------------------------------------------------------------
-- check_in_with_code: "GPS not working? Enter the party code".
-- -----------------------------------------------------------------------------
create function public.check_in_with_code(p_event_id uuid, p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: checks the caller in to an event when they type the right
  party code during the event, and records the outcome.
  Inputs:
    p_event_id  which event they say they're at
    p_code      what they typed. Spaces and dashes are ignored and small
                letters count as capitals ("k7mx-2q" is "K7MX2Q").
  Returns: a small JSON answer. "status" is one of:
    'passed'             checked in (method 'code'). Also: first_at and
                         already_checked_in (true on a repeat).
    'wrong_code'         not the code. Also: tries_left (1 to 4).
    'locked'             5 wrong codes in the last 60 minutes (this answer
                         also comes back on the 5th wrong try). Also:
                         retry_after_minutes.
    'code_off'           the party code isn't switched on for this event.
    'outside_window'     too early or too late. Also: reason ('too_early' or
                         'too_late'), opens_at and closes_at.
    'too_many_attempts'  20 tries (GPS and code) in the last hour. Also:
                         retry_after_minutes.
    'too_many_events'    already checked in to 8 other events in 24 hours.
  Why `security definer`: the app can't read event_private (where the code
  lives) or write the check-in tables. This runs with the owner's rights,
  only for a signed-up adult, and only ever says right or wrong.
*/
declare
  v_uid uuid := auth.uid();
  v_event public.events%rowtype;
  v_real_code text;
  v_code text;
  v_now timestamptz := now();
  v_opens_at timestamptz;
  v_closes_at timestamptz;
  v_tries integer;
  v_oldest_try timestamptz;
  v_wrong integer;
  v_oldest_wrong timestamptz;
  v_already boolean;
  v_other_events integer;
  v_first_at timestamptz;
begin
  -- 1. Signed-up adults only (anon can't even call this; see the grants).
  if v_uid is null or not private.is_adult_user() then
    raise exception 'Please sign in and finish setting up your profile first.'
      using errcode = '42501';
  end if;

  -- 2. Clean up what was typed: drop spaces and dashes, make capitals.
  --    Anything that still isn't 6 letters/digits can never be right, so it
  --    is refused without counting as a wrong try. The message never
  --    repeats what was typed.
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[[:space:]-]', '', 'g'));
  if v_code !~ '^[A-Z0-9]{6}$' then
    raise exception 'Party codes are 6 letters and numbers. Check the card and try again.'
      using errcode = 'VCCOD';
  end if;

  -- 3. Find the event. Test events exist only for testers, exactly as in
  --    check_in (B06).
  select * into v_event from public.events e where e.id = p_event_id;
  if not found or (v_event.is_test and not private.is_tester()) then
    raise exception 'That event doesn''t exist.' using errcode = 'VCNFD';
  end if;
  select ep.check_in_code into v_real_code
  from public.event_private ep where ep.event_id = p_event_id;
  if not found then
    raise exception 'That event doesn''t exist.' using errcode = 'VCNFD';
  end if;

  -- 4. One check-in at a time per person, GPS or code: the same lock key as
  --    check_in, so two quick taps can't both slip under the limits.
  perform pg_advisory_xact_lock(hashtext('vibecheck.check_in:' || v_uid::text));

  -- 5. Hourly limit shared with GPS: 20 attempts in the last 60 minutes,
  --    any event. Not recorded, so waiting always works.
  select count(*), min(a.at) into v_tries, v_oldest_try
  from public.check_in_attempts a
  where a.user_id = v_uid
    and a.at > v_now - interval '1 hour';
  if v_tries >= 20 then
    return jsonb_build_object(
      'status', 'too_many_attempts',
      'retry_after_minutes',
      greatest(1, ceil(extract(epoch from (v_oldest_try + interval '1 hour' - v_now)) / 60)::int)
    );
  end if;

  -- 6. The admin hasn't switched the party code on for this event. Not
  --    recorded and not compared: nothing typed here can be right.
  if not v_event.code_check_in_enabled then
    return jsonb_build_object('status', 'code_off');
  end if;

  -- 7. The lock: 5 wrong codes for this event in the last 60 minutes. Even
  --    the right code is refused until the oldest of them is an hour old.
  select count(*), min(a.at) into v_wrong, v_oldest_wrong
  from public.check_in_attempts a
  where a.user_id = v_uid
    and a.event_id = p_event_id
    and a.result = 'bad_code'
    and a.at > v_now - interval '1 hour';
  if v_wrong >= 5 then
    return jsonb_build_object(
      'status', 'locked',
      'retry_after_minutes',
      greatest(1, ceil(extract(epoch from (v_oldest_wrong + interval '1 hour' - v_now)) / 60)::int)
    );
  end if;

  -- 8. The event window (same as GPS). Outside it the code isn't compared.
  v_opens_at := v_event.starts_at - interval '30 minutes';
  v_closes_at := v_event.ends_at + interval '60 minutes';
  if v_now < v_opens_at or v_now > v_closes_at then
    insert into public.check_in_attempts (user_id, event_id, result, accuracy_bucket)
    values (v_uid, p_event_id, 'outside_window', null);
    return jsonb_build_object(
      'status', 'outside_window',
      'reason', case when v_now < v_opens_at then 'too_early' else 'too_late' end,
      'opens_at', v_opens_at,
      'closes_at', v_closes_at
    );
  end if;

  -- 9. The 8-events limit, before the comparison (as GPS checks it before
  --    the distance). A repeat for an event they're already in is fine.
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

  -- 10. Compare. A wrong code is recorded (only "bad_code" and the time,
  --     never what was typed). The 5th wrong one in an hour locks entry.
  if not private.codes_match(v_code, v_real_code) then
    insert into public.check_in_attempts (user_id, event_id, result, accuracy_bucket)
    values (v_uid, p_event_id, 'bad_code', null);
    if v_wrong + 1 >= 5 then
      return jsonb_build_object(
        'status', 'locked',
        -- The oldest wrong try in the hour (or this one, if it's the only
        -- one, which can't happen at 5 but keeps the sum safe).
        'retry_after_minutes',
        greatest(1, ceil(extract(epoch from (coalesce(v_oldest_wrong, v_now) + interval '1 hour' - v_now)) / 60)::int)
      );
    end if;
    return jsonb_build_object('status', 'wrong_code', 'tries_left', 5 - (v_wrong + 1));
  end if;

  -- 11. Right code. Record the attempt (no GPS, so no accuracy band), then
  --     create the check-in with method 'code', or refresh it on a repeat
  --     (first_at and method stay as they were).
  insert into public.check_in_attempts (user_id, event_id, result, accuracy_bucket)
  values (v_uid, p_event_id, 'passed', null);

  insert into public.check_ins as c (user_id, event_id, method, first_at, last_verified_at)
  values (v_uid, p_event_id, 'code', v_now, v_now)
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

comment on function public.check_in_with_code(uuid, text) is
  'VC-B07: party-code check-in for signed-up adults. Constant-time compare with event_private; window, 5-wrong-an-hour lock, B06 limits; stores only result and time, never the typed code.';

-- -----------------------------------------------------------------------------
-- tester_check_in: one-tap check-in for testers, on test events only.
-- -----------------------------------------------------------------------------
create function public.tester_check_in(p_event_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: checks a tester in to a TEST event with no GPS and no code.
  Inputs: p_event_id, the test event.
  Returns: the same JSON answers as check_in for the rules that still
  apply: 'passed' (with first_at and already_checked_in), 'outside_window',
  'too_many_attempts' or 'too_many_events'.
  Why: Apple's reviewer and our testers aren't at a real party, but need to
  try check-in and rating. Only the proof-of-presence step is skipped; the
  window and limits stay, so test runs behave like the real thing (for App
  Review, make a test event that is on during the review).
  Safety: refused (VCOVR) on any real event, and refused (42501) for anyone
  who isn't a tester, so it can never touch a real party's score.
*/
declare
  v_uid uuid := auth.uid();
  v_event public.events%rowtype;
  v_now timestamptz := now();
  v_opens_at timestamptz;
  v_closes_at timestamptz;
  v_tries integer;
  v_oldest_try timestamptz;
  v_already boolean;
  v_other_events integer;
  v_first_at timestamptz;
begin
  -- 1. Signed-up adults only.
  if v_uid is null or not private.is_adult_user() then
    raise exception 'Please sign in and finish setting up your profile first.'
      using errcode = '42501';
  end if;

  -- 2. Testers only. is_tester can't be set from the app (B02 trigger),
  --    only by the team in the database.
  if not private.is_tester() then
    raise exception 'Only testers can use the tester check-in.' using errcode = '42501';
  end if;

  -- 3. The event must exist, and must be a test event.
  select * into v_event from public.events e where e.id = p_event_id;
  if not found then
    raise exception 'That event doesn''t exist.' using errcode = 'VCNFD';
  end if;
  if not v_event.is_test then
    raise exception 'The tester check-in works only on test events.' using errcode = 'VCOVR';
  end if;

  -- 4. Same per-person lock and hourly limit as check_in.
  perform pg_advisory_xact_lock(hashtext('vibecheck.check_in:' || v_uid::text));
  select count(*), min(a.at) into v_tries, v_oldest_try
  from public.check_in_attempts a
  where a.user_id = v_uid
    and a.at > v_now - interval '1 hour';
  if v_tries >= 20 then
    return jsonb_build_object(
      'status', 'too_many_attempts',
      'retry_after_minutes',
      greatest(1, ceil(extract(epoch from (v_oldest_try + interval '1 hour' - v_now)) / 60)::int)
    );
  end if;

  -- 5. The event window (same as GPS and code).
  v_opens_at := v_event.starts_at - interval '30 minutes';
  v_closes_at := v_event.ends_at + interval '60 minutes';
  if v_now < v_opens_at or v_now > v_closes_at then
    insert into public.check_in_attempts (user_id, event_id, result, accuracy_bucket)
    values (v_uid, p_event_id, 'outside_window', null);
    return jsonb_build_object(
      'status', 'outside_window',
      'reason', case when v_now < v_opens_at then 'too_early' else 'too_late' end,
      'opens_at', v_opens_at,
      'closes_at', v_closes_at
    );
  end if;

  -- 6. The 8-events limit (a repeat is always fine).
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

  -- 7. Passed: record it and create or refresh the check-in (method 'tester').
  insert into public.check_in_attempts (user_id, event_id, result, accuracy_bucket)
  values (v_uid, p_event_id, 'passed', null);

  insert into public.check_ins as c (user_id, event_id, method, first_at, last_verified_at)
  values (v_uid, p_event_id, 'tester', v_now, v_now)
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

comment on function public.tester_check_in(uuid) is
  'VC-B07: testers only, test events only. Check-in without GPS or code (method ''tester''); window and limits still apply.';

-- -----------------------------------------------------------------------------
-- Who may run what: signed-in users may call the two check-ins (the checks
-- inside decide the rest); anon can't call them at all; nobody from the app
-- can call the comparison helper.
-- -----------------------------------------------------------------------------
revoke execute on function public.check_in_with_code(uuid, text) from public, anon;
grant execute on function public.check_in_with_code(uuid, text) to authenticated;

revoke execute on function public.tester_check_in(uuid) from public, anon;
grant execute on function public.tester_check_in(uuid) to authenticated;

revoke execute on function private.codes_match(text, text) from public, anon, authenticated;
