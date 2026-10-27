-- =============================================================================
-- pgTAP test 16: the live vibe score (VC-B09) and the "74 here" headcount
-- (VC-42, count only).
--
-- What it checks, in plain words:
--   * Locked down: the two app functions are security definer with an empty
--     search_path, never log, and anon can't call them; the private helpers
--     (including the one that takes a clock) can't be called from the app.
--   * The maths, with a fixed clock and always 5+ ratings: a rating 30
--     minutes old counts half as much (10 now + four 0s at 30 min = 3.3); 60
--     minutes old a quarter (5.0); exactly 3 hours old still counts, at the
--     0.25 floor (VC-50: 1.7), but 3 hours and 1 minute old doesn't count at
--     all (0.0); ratings
--     after the moment are ignored, and fewer than 5 gives no number.
--   * Privacy (cto review, migration 20261027130100): never a number from
--     fewer than 5 ratings. 5 old ratings plus 1 recent one uses the plain
--     average of the 5 newest, not just the recent one (live and stale); night_average is
--     sent only when stale; the exact last_rating_at is never sent.
--   * The words at the boundaries: 3.9 Quiet / 4.0 Good, 6.9 Good / 7.0 Hot,
--     8.4 Hot / 8.5 Fire.
--   * The states: none (0 ratings), early (4 ratings: a count, no number, no
--     reactions), live (5 ratings: the number), stale (90 minutes quiet; 89
--     is still live).
--   * Hidden ratings count nowhere (score, count, reactions).
--   * The headcount is the number of check-ins.
--   * The app functions: adults only; a test event doesn't exist for a
--     non-tester; the Tonight list call skips events the caller can't see,
--     repeats and unknown ids, and refuses more than 100 ids; and no user id
--     ever appears in an answer.
--
-- now() is frozen for the whole test (one transaction), so "30 minutes ago"
-- is exact. Everything runs inside BEGIN ... ROLLBACK: nothing is kept.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(43);

-- ---- Setup (as owner) -------------------------------------------------------
-- Users: …01 to …05 guests, …06 a guest whose rating gets hidden, …07 a
-- tester, …08 signed in but never finished the age gate (no profile).
insert into auth.users (id, email) values
  ('eeeeeeee-9999-4999-8999-000000000001', 'vibe-1@test.vibecheck.invalid'),
  ('eeeeeeee-9999-4999-8999-000000000002', 'vibe-2@test.vibecheck.invalid'),
  ('eeeeeeee-9999-4999-8999-000000000003', 'vibe-3@test.vibecheck.invalid'),
  ('eeeeeeee-9999-4999-8999-000000000004', 'vibe-4@test.vibecheck.invalid'),
  ('eeeeeeee-9999-4999-8999-000000000005', 'vibe-5@test.vibecheck.invalid'),
  ('eeeeeeee-9999-4999-8999-000000000006', 'vibe-hidden@test.vibecheck.invalid'),
  ('eeeeeeee-9999-4999-8999-000000000007', 'vibe-tester@test.vibecheck.invalid'),
  ('eeeeeeee-9999-4999-8999-000000000008', 'vibe-noprofile@test.vibecheck.invalid');
insert into public.profiles (id, display_name, birthdate, is_tester, role) values
  ('eeeeeeee-9999-4999-8999-000000000001', 'Vibe one', current_date - interval '30 years', false, 'user'),
  ('eeeeeeee-9999-4999-8999-000000000002', 'Vibe two', current_date - interval '30 years', false, 'user'),
  ('eeeeeeee-9999-4999-8999-000000000003', 'Vibe three', current_date - interval '30 years', false, 'user'),
  ('eeeeeeee-9999-4999-8999-000000000004', 'Vibe four', current_date - interval '30 years', false, 'user'),
  ('eeeeeeee-9999-4999-8999-000000000005', 'Vibe five', current_date - interval '30 years', false, 'user'),
  ('eeeeeeee-9999-4999-8999-000000000006', 'Vibe hidden', current_date - interval '30 years', false, 'user'),
  ('eeeeeeee-9999-4999-8999-000000000007', 'Vibe tester', current_date - interval '30 years', true, 'user');

-- Events, all on now: …f1 to …f4 for the maths, …f5 for the states, …f6 a
-- test event (only testers can see it), …f7 the "old ratings plus one new"
-- privacy case.
insert into public.events (id, title, area_label, starts_at, ends_at, is_test) values
  ('eeeeeeee-0000-4000-8000-0000000000f1', 'Maths half', 'Shaw, DC', now() - interval '4 hours', now() + interval '3 hours', false),
  ('eeeeeeee-0000-4000-8000-0000000000f2', 'Maths quarter', 'Shaw, DC', now() - interval '4 hours', now() + interval '3 hours', false),
  ('eeeeeeee-0000-4000-8000-0000000000f3', 'Maths cut-off', 'Shaw, DC', now() - interval '4 hours', now() + interval '3 hours', false),
  ('eeeeeeee-0000-4000-8000-0000000000f4', 'Maths even', 'Shaw, DC', now() - interval '4 hours', now() + interval '3 hours', false),
  ('eeeeeeee-0000-4000-8000-0000000000f7', 'Old plus one', 'Shaw, DC', now() - interval '6 hours', now() + interval '3 hours', false),
  ('eeeeeeee-0000-4000-8000-0000000000f5', 'States', 'U Street, DC', now() - interval '4 hours', now() + interval '3 hours', false),
  ('eeeeeeee-0000-4000-8000-0000000000f6', 'Test night', 'Shaw, DC', now() - interval '1 hour', now() + interval '3 hours', true);

-- Ratings for the maths (written directly as owner; the score is worked out
-- by the table: 3,3,3 = 10 and 1,1,1 = 0).
insert into public.ratings (user_id, event_id, crowd, music, energy, created_at, updated_at) values
  -- Every maths event has 5+ ratings (fewer gives no number at all).
  -- f1: 10 now, four 0s 30 minutes ago -> 10 / (1 + 4 x 0.5) = 3.33 -> 3.3
  ('eeeeeeee-9999-4999-8999-000000000001', 'eeeeeeee-0000-4000-8000-0000000000f1', 3, 3, 3, now(), now()),
  ('eeeeeeee-9999-4999-8999-000000000002', 'eeeeeeee-0000-4000-8000-0000000000f1', 1, 1, 1, now() - interval '30 minutes', now() - interval '30 minutes'),
  ('eeeeeeee-9999-4999-8999-000000000003', 'eeeeeeee-0000-4000-8000-0000000000f1', 1, 1, 1, now() - interval '30 minutes', now() - interval '30 minutes'),
  ('eeeeeeee-9999-4999-8999-000000000004', 'eeeeeeee-0000-4000-8000-0000000000f1', 1, 1, 1, now() - interval '30 minutes', now() - interval '30 minutes'),
  ('eeeeeeee-9999-4999-8999-000000000005', 'eeeeeeee-0000-4000-8000-0000000000f1', 1, 1, 1, now() - interval '30 minutes', now() - interval '30 minutes'),
  -- f2: 10 now, four 0s 60 minutes ago -> 10 / (1 + 4 x 0.25) = 5.0
  ('eeeeeeee-9999-4999-8999-000000000001', 'eeeeeeee-0000-4000-8000-0000000000f2', 3, 3, 3, now(), now()),
  ('eeeeeeee-9999-4999-8999-000000000002', 'eeeeeeee-0000-4000-8000-0000000000f2', 1, 1, 1, now() - interval '60 minutes', now() - interval '60 minutes'),
  ('eeeeeeee-9999-4999-8999-000000000003', 'eeeeeeee-0000-4000-8000-0000000000f2', 1, 1, 1, now() - interval '60 minutes', now() - interval '60 minutes'),
  ('eeeeeeee-9999-4999-8999-000000000004', 'eeeeeeee-0000-4000-8000-0000000000f2', 1, 1, 1, now() - interval '60 minutes', now() - interval '60 minutes'),
  ('eeeeeeee-9999-4999-8999-000000000005', 'eeeeeeee-0000-4000-8000-0000000000f2', 1, 1, 1, now() - interval '60 minutes', now() - interval '60 minutes'),
  -- f3: five 0s 150 minutes ago and a 10 exactly 3 hours ago. Both would
  -- weigh under 0.25 (1/32 and 1/64), so both get the 0.25 floor (VC-50,
  -- migration 20261027140000): (10 x 0.25) / (6 x 0.25) = 1.67 -> 1.7
  ('eeeeeeee-9999-4999-8999-000000000001', 'eeeeeeee-0000-4000-8000-0000000000f3', 1, 1, 1, now() - interval '150 minutes', now() - interval '150 minutes'),
  ('eeeeeeee-9999-4999-8999-000000000002', 'eeeeeeee-0000-4000-8000-0000000000f3', 1, 1, 1, now() - interval '150 minutes', now() - interval '150 minutes'),
  ('eeeeeeee-9999-4999-8999-000000000003', 'eeeeeeee-0000-4000-8000-0000000000f3', 1, 1, 1, now() - interval '150 minutes', now() - interval '150 minutes'),
  ('eeeeeeee-9999-4999-8999-000000000004', 'eeeeeeee-0000-4000-8000-0000000000f3', 1, 1, 1, now() - interval '150 minutes', now() - interval '150 minutes'),
  ('eeeeeeee-9999-4999-8999-000000000005', 'eeeeeeee-0000-4000-8000-0000000000f3', 1, 1, 1, now() - interval '150 minutes', now() - interval '150 minutes'),
  ('eeeeeeee-9999-4999-8999-000000000006', 'eeeeeeee-0000-4000-8000-0000000000f3', 3, 3, 3, now() - interval '180 minutes', now() - interval '180 minutes'),
  -- f4: a 10 and four 0s, all now -> a plain average, 2.0
  ('eeeeeeee-9999-4999-8999-000000000001', 'eeeeeeee-0000-4000-8000-0000000000f4', 3, 3, 3, now(), now()),
  ('eeeeeeee-9999-4999-8999-000000000002', 'eeeeeeee-0000-4000-8000-0000000000f4', 1, 1, 1, now(), now()),
  ('eeeeeeee-9999-4999-8999-000000000003', 'eeeeeeee-0000-4000-8000-0000000000f4', 1, 1, 1, now(), now()),
  ('eeeeeeee-9999-4999-8999-000000000004', 'eeeeeeee-0000-4000-8000-0000000000f4', 1, 1, 1, now(), now()),
  ('eeeeeeee-9999-4999-8999-000000000005', 'eeeeeeee-0000-4000-8000-0000000000f4', 1, 1, 1, now(), now()),
  -- f7: five 10s 3.5 hours ago (outside the 3-hour window) and one 0 now.
  ('eeeeeeee-9999-4999-8999-000000000001', 'eeeeeeee-0000-4000-8000-0000000000f7', 3, 3, 3, now() - interval '210 minutes', now() - interval '210 minutes'),
  ('eeeeeeee-9999-4999-8999-000000000002', 'eeeeeeee-0000-4000-8000-0000000000f7', 3, 3, 3, now() - interval '210 minutes', now() - interval '210 minutes'),
  ('eeeeeeee-9999-4999-8999-000000000003', 'eeeeeeee-0000-4000-8000-0000000000f7', 3, 3, 3, now() - interval '210 minutes', now() - interval '210 minutes'),
  ('eeeeeeee-9999-4999-8999-000000000004', 'eeeeeeee-0000-4000-8000-0000000000f7', 3, 3, 3, now() - interval '210 minutes', now() - interval '210 minutes'),
  ('eeeeeeee-9999-4999-8999-000000000005', 'eeeeeeee-0000-4000-8000-0000000000f7', 3, 3, 3, now() - interval '210 minutes', now() - interval '210 minutes'),
  ('eeeeeeee-9999-4999-8999-000000000006', 'eeeeeeee-0000-4000-8000-0000000000f7', 1, 1, 1, now(), now());

-- Check-ins at f5: guests 1 to 6 and the tester (7 people), all already in.
insert into public.check_ins (user_id, event_id, method, first_at, last_verified_at)
select u.id, 'eeeeeeee-0000-4000-8000-0000000000f5', 'gps', now() - interval '1 hour', now()
from (values
  ('eeeeeeee-9999-4999-8999-000000000001'::uuid), ('eeeeeeee-9999-4999-8999-000000000002'::uuid),
  ('eeeeeeee-9999-4999-8999-000000000003'::uuid), ('eeeeeeee-9999-4999-8999-000000000004'::uuid),
  ('eeeeeeee-9999-4999-8999-000000000005'::uuid), ('eeeeeeee-9999-4999-8999-000000000006'::uuid),
  ('eeeeeeee-9999-4999-8999-000000000007'::uuid)) u(id);

-- ---- 1. Locked down (6) -----------------------------------------------------
select ok(not has_function_privilege('anon', 'public.get_event_vibe(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.get_event_vibe(uuid)', 'execute'),
  'get_event_vibe: anon can''t call it; signed-in users can');
select ok(not has_function_privilege('anon', 'public.get_events_vibe(uuid[])', 'execute')
          and has_function_privilege('authenticated', 'public.get_events_vibe(uuid[])', 'execute'),
  'get_events_vibe: anon can''t call it; signed-in users can');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'])
           from pg_proc where oid in (
             'public.get_event_vibe(uuid)'::regprocedure,
             'public.get_events_vibe(uuid[])'::regprocedure,
             'private.vibe_score_at(uuid, timestamptz)'::regprocedure,
             'private.event_vibe(uuid, timestamptz)'::regprocedure,
             'private.can_see_event(uuid)'::regprocedure)),
  'the vibe functions are security definer with an empty search_path');
select ok((select proconfig @> array['search_path=""'] from pg_proc
           where oid = 'private.vibe_label(numeric)'::regprocedure),
  'vibe_label has an empty search_path too');
select ok((select bool_and(prosrc !~* 'raise\s+(notice|log|info|debug|warning)')
           from pg_proc where oid in (
             'public.get_event_vibe(uuid)'::regprocedure,
             'public.get_events_vibe(uuid[])'::regprocedure,
             'private.event_vibe(uuid, timestamptz)'::regprocedure)),
  'the vibe functions never log anything');
select ok(not has_function_privilege('authenticated', 'private.event_vibe(uuid, timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'private.vibe_score_at(uuid, timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'private.vibe_label(numeric)', 'execute')
          and not has_function_privilege('authenticated', 'private.can_see_event(uuid)', 'execute')
          and not has_function_privilege('anon', 'private.event_vibe(uuid, timestamptz)', 'execute'),
  'the app can''t call the private helpers (so it can''t pick the clock)');

-- ---- 2. The maths and the 5-rating floor (9) -------------------------------
select is(private.vibe_score_at('eeeeeeee-0000-4000-8000-0000000000f1', now()), 3.3,
  'a rating 30 minutes old counts half: 10 now + four 0s at 30 min = 3.3');
select is(private.vibe_score_at('eeeeeeee-0000-4000-8000-0000000000f2', now()), 5.0,
  'a rating 60 minutes old counts a quarter: 10 now + four 0s at 60 min = 5.0');
select is(private.vibe_score_at('eeeeeeee-0000-4000-8000-0000000000f3', now()), 1.7,
  'a rating exactly 3 hours old still counts, at the 0.25 floor (VC-50): 1.7');
select is(private.vibe_score_at('eeeeeeee-0000-4000-8000-0000000000f4', now()), 2.0,
  'ratings of the same age: a plain average, 2.0');
select is(private.vibe_score_at('eeeeeeee-0000-4000-8000-0000000000f1', now() - interval '30 minutes'), null,
  'ratings saved after the moment are ignored; the 4 left are too few for a number');
select is(private.vibe_score_at('eeeeeeee-0000-4000-8000-0000000000f5', now()), null,
  'no ratings: no score');
update public.ratings set updated_at = now() - interval '3 hours 1 minute'
where event_id = 'eeeeeeee-0000-4000-8000-0000000000f3' and user_id = 'eeeeeeee-9999-4999-8999-000000000006';
select is(private.vibe_score_at('eeeeeeee-0000-4000-8000-0000000000f3', now()), 0.0,
  'a rating 3 hours and 1 minute old doesn''t count (the window still has 5): 0.0');

-- The cto's case: 5 ratings long ago and 1 recent one. The 3-hour window
-- holds only the recent 0, so the score is the PLAIN average of the 5 newest
-- (migration 20261027130200): (0 + 10 + 10 + 10 + 10) / 5 = 8.0. Weighting
-- by age would give 0.3, which is in effect that one guest's 0.
select is(private.event_vibe('eeeeeeee-0000-4000-8000-0000000000f7', now()) -> 'score', '8.0'::jsonb,
  'privacy: a window with fewer than 5 ratings uses the plain average of the 5 newest');
-- The same rule for the stale score (scored at the last rating, 100 min ago):
-- the same 5 newest, unweighted, so 8.0 again.
update public.ratings set updated_at = now() - interval '100 minutes'
where event_id = 'eeeeeeee-0000-4000-8000-0000000000f7' and user_id = 'eeeeeeee-9999-4999-8999-000000000006';
update public.ratings set updated_at = now() - interval '300 minutes'
where event_id = 'eeeeeeee-0000-4000-8000-0000000000f7' and user_id <> 'eeeeeeee-9999-4999-8999-000000000006';
select is(private.event_vibe('eeeeeeee-0000-4000-8000-0000000000f7', now()) -> 'score', '8.0'::jsonb,
  'privacy: the stale score uses the plain average of the 5 newest too');

-- ---- 3. The words at the boundaries (7) -------------------------------------
select is(private.vibe_label(3.9), 'Quiet', '3.9 is Quiet');
select is(private.vibe_label(4.0), 'Good', '4.0 is Good');
select is(private.vibe_label(6.9), 'Good', '6.9 is Good');
select is(private.vibe_label(7.0), 'Hot', '7.0 is Hot');
select is(private.vibe_label(8.4), 'Hot', '8.4 is Hot');
select is(private.vibe_label(8.5), 'Fire', '8.5 is Fire');
select is(private.vibe_label(null), null, 'no score, no word');

-- ---- 4. The states, with hidden ratings (9) ---------------------------------
select is(private.event_vibe('eeeeeeee-0000-4000-8000-0000000000f5', now()),
  jsonb_build_object('state', 'none', 'raters', 0, 'here', 7, 'score', null, 'label', null,
    'night_average', null, 'minutes_since_last', null,
    'reactions', '[]'::jsonb),
  'no ratings: none, with the headcount of 7 check-ins');

-- Four visible ratings plus one hidden one (a 0 with 'dead').
insert into public.ratings (user_id, event_id, crowd, music, energy, reaction, created_at, updated_at, hidden_at) values
  ('eeeeeeee-9999-4999-8999-000000000001', 'eeeeeeee-0000-4000-8000-0000000000f5', 3, 3, 3, 'fire', now(), now(), null),
  ('eeeeeeee-9999-4999-8999-000000000002', 'eeeeeeee-0000-4000-8000-0000000000f5', 3, 3, 3, 'fire', now(), now(), null),
  ('eeeeeeee-9999-4999-8999-000000000003', 'eeeeeeee-0000-4000-8000-0000000000f5', 3, 3, 2, 'dancing', now(), now(), null),
  ('eeeeeeee-9999-4999-8999-000000000004', 'eeeeeeee-0000-4000-8000-0000000000f5', 2, 2, 2, null, now(), now(), null),
  ('eeeeeeee-9999-4999-8999-000000000006', 'eeeeeeee-0000-4000-8000-0000000000f5', 1, 1, 1, 'dead', now(), now(), now());
select is(private.event_vibe('eeeeeeee-0000-4000-8000-0000000000f5', now()),
  jsonb_build_object('state', 'early', 'raters', 4, 'here', 7, 'score', null, 'label', null,
    'night_average', null, 'minutes_since_last', 0,
    'reactions', '[]'::jsonb),
  '4 visible ratings (the hidden one doesn''t count): early, a count but no number or reactions');

-- The fifth visible rating: 10 + 10 + 8.33 + 5 + 6.67 = 40, / 5 = 8.0 (Hot).
-- With the hidden 0 it would be 6.7, so 8.0 proves it is left out.
insert into public.ratings (user_id, event_id, crowd, music, energy, reaction, created_at, updated_at) values
  ('eeeeeeee-9999-4999-8999-000000000005', 'eeeeeeee-0000-4000-8000-0000000000f5', 3, 2, 2, 'fire', now(), now());
select is(private.event_vibe('eeeeeeee-0000-4000-8000-0000000000f5', now()),
  jsonb_build_object('state', 'live', 'raters', 5, 'here', 7, 'score', 8.0, 'label', 'Hot',
    'night_average', null, 'minutes_since_last', 0,
    'reactions', '[{"reaction": "fire", "count": 3}, {"reaction": "dancing", "count": 1}]'::jsonb),
  '5 visible ratings: live 8.0 Hot, the tally without the hidden "dead", no night average while live');

-- 89 minutes quiet: still live (the score has faded evenly, so still 8.0).
update public.ratings set updated_at = now() - interval '89 minutes'
where event_id = 'eeeeeeee-0000-4000-8000-0000000000f5';
select is(private.event_vibe('eeeeeeee-0000-4000-8000-0000000000f5', now()) ->> 'state', 'live',
  '89 minutes since the last rating: still live');

-- 90 minutes quiet: stale, with the score as it stood at the last rating.
update public.ratings set updated_at = now() - interval '90 minutes'
where event_id = 'eeeeeeee-0000-4000-8000-0000000000f5';
select is(private.event_vibe('eeeeeeee-0000-4000-8000-0000000000f5', now()) - 'reactions',
  jsonb_build_object('state', 'stale', 'raters', 5, 'here', 7, 'score', 8.0, 'label', 'Hot',
    'night_average', 8.0, 'minutes_since_last', 90),
  '90 minutes since the last rating: stale, last score 8.0, night average 8.0');

-- Stale with spread-out times: the "last score" is the weighted score at
-- the last rating, not now. Guest 1's 10 becomes the newest (90 minutes ago)
-- and guest 4's 5 is 30 minutes older than the rest.
update public.ratings set updated_at = now() - interval '120 minutes'
where event_id = 'eeeeeeee-0000-4000-8000-0000000000f5' and user_id <> 'eeeeeeee-9999-4999-8999-000000000001';
-- At the last rating: 10 (w 1) and 10, 8.33, 5, 6.67 (each w 0.5):
-- (10 + 0.5 x 30) / 3 = 8.33 -> 8.3.
select is(private.event_vibe('eeeeeeee-0000-4000-8000-0000000000f5', now()) ->> 'score', '8.3',
  'stale: the last score is weighted at the moment of the last rating (8.3)');

-- Unhiding a rating brings it back everywhere (a 0 now 90 minutes old
-- joins: raters 6, so hidden really was the only thing keeping it out).
update public.ratings set hidden_at = null, updated_at = now() - interval '90 minutes'
where event_id = 'eeeeeeee-0000-4000-8000-0000000000f5' and user_id = 'eeeeeeee-9999-4999-8999-000000000006';
select is((private.event_vibe('eeeeeeee-0000-4000-8000-0000000000f5', now()) ->> 'raters')::int, 6,
  'an unhidden rating counts again (6 raters)');
update public.ratings set hidden_at = now()
where event_id = 'eeeeeeee-0000-4000-8000-0000000000f5' and user_id = 'eeeeeeee-9999-4999-8999-000000000006';

-- A check-in that hasn't happened yet at the moment asked isn't counted.
select is((private.event_vibe('eeeeeeee-0000-4000-8000-0000000000f5', now() - interval '2 hours') ->> 'here')::int, 0,
  'the headcount only counts check-ins up to the moment');

-- Back to all five visible ratings fresh, for the app checks below. Since
-- VC-51 (migration 20261027140200) the app functions show the last PUBLISHED
-- snapshot, and these ratings were written straight into the table, so
-- publish one now (submit_rating would do this after 3 new raters, VC-64).
update public.ratings set updated_at = now()
where event_id = 'eeeeeeee-0000-4000-8000-0000000000f5';
select private.publish_event_vibe('eeeeeeee-0000-4000-8000-0000000000f5', now());

-- ---- 5. The app functions (13) ----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-9999-4999-8999-000000000008","role":"authenticated"}', true);
select throws_ok($$ select public.get_event_vibe('eeeeeeee-0000-4000-8000-0000000000f5') $$,
  '42501', null, 'no profile (never passed the age gate): get_event_vibe refused');
select throws_ok($$ select public.get_events_vibe(array['eeeeeeee-0000-4000-8000-0000000000f5'::uuid]) $$,
  '42501', null, 'no profile: get_events_vibe refused');

select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-9999-4999-8999-000000000001","role":"authenticated"}', true);
select is(public.get_event_vibe('eeeeeeee-0000-4000-8000-0000000000f5') - 'reactions',
  jsonb_build_object('state', 'live', 'raters', 5, 'here', 7, 'score', 8.0, 'label', 'Hot',
    'night_average', null, 'minutes_since_last', 0),
  'a guest gets the live vibe of the event');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_event_vibe('eeeeeeee-0000-4000-8000-0000000000f5')) k),
  array['here', 'label', 'minutes_since_last', 'night_average', 'raters', 'reactions', 'score', 'state'],
  'the answer holds totals only (exactly these keys; no exact last_rating_at)');
select ok(public.get_event_vibe('eeeeeeee-0000-4000-8000-0000000000f5')::text !~ 'eeeeeeee-9999',
  'no user id appears in the answer');
select throws_ok($$ select public.get_event_vibe('eeeeeeee-0000-4000-8000-0000000000f6') $$,
  'VCNFD', null, 'a test event doesn''t exist for a non-tester');
select throws_ok($$ select public.get_event_vibe('eeeeeeee-0000-4000-8000-0000000000ff') $$,
  'VCNFD', null, 'an unknown event: VCNFD');
select is((select count(*)::int from public.ratings where event_id = 'eeeeeeee-0000-4000-8000-0000000000f5'),
  1, 'a guest still reads only their own rating row (RLS)');

-- The Tonight list call: f5 twice, the test event, and an unknown id.
select is(
  (select array_agg(item ->> 'event_id')
   from jsonb_array_elements(public.get_events_vibe(array[
     'eeeeeeee-0000-4000-8000-0000000000f5', 'eeeeeeee-0000-4000-8000-0000000000f5',
     'eeeeeeee-0000-4000-8000-0000000000f6', 'eeeeeeee-0000-4000-8000-0000000000ff']::uuid[])) item),
  array['eeeeeeee-0000-4000-8000-0000000000f5'],
  'the list call skips repeats, hidden test events and unknown ids');
select is(
  (select item - 'event_id' from jsonb_array_elements(
     public.get_events_vibe(array['eeeeeeee-0000-4000-8000-0000000000f5'::uuid])) item),
  public.get_event_vibe('eeeeeeee-0000-4000-8000-0000000000f5'),
  'each list item matches the event page''s answer');
select throws_ok(
  $$ select public.get_events_vibe(array(select gen_random_uuid() from generate_series(1, 101))) $$,
  '22023', null, 'more than 100 ids at once is refused');
select is(public.get_events_vibe('{}'::uuid[]), '[]'::jsonb, 'no ids: an empty list');

-- A tester can see the test event (no ratings there: none).
select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-9999-4999-8999-000000000007","role":"authenticated"}', true);
select is(public.get_event_vibe('eeeeeeee-0000-4000-8000-0000000000f6') ->> 'state', 'none',
  'a tester sees the test event''s vibe (none yet)');

reset role;

select * from finish();
rollback;
