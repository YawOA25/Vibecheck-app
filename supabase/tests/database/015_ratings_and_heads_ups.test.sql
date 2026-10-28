-- =============================================================================
-- pgTAP test 15: the 3-tap rating (VC-B08) and heads-up tags with +1 (VC-43).
--
-- What it checks, in plain words:
--   * The three new functions are locked down: security definer, empty
--     search_path, never log, anon can't call them; the helpers can't be
--     called from the app; the new table has RLS on and can't be read.
--   * Who: not signed up -> refused; admins -> refused (staff rule); a test
--     event doesn't exist for a non-tester.
--   * Broken input (a row outside 1 to 3, an unknown reaction or tag) is
--     refused with VCRAT / VCTAG and nothing is saved.
--   * Here now: no check-in -> not_checked_in; confirmed 46 minutes ago ->
--     check_in_stale; exactly 45 minutes ago -> fine.
--   * Window: too early and too late are refused with the times.
--   * One per event: a second save 59 minutes later is too_soon with 1
--     minute left; at 60 minutes it updates the same row (still one row).
--   * Two different events in one night can both be rated.
--   * Hidden ratings don't count in "raters", stay hidden after an update,
--     and that guest's heads-ups don't count either.
--   * Heads-ups: picked while rating, +1 on the event page ('added', then
--     'already'), counts most-first with "mine", same here-now rules. Since
--     VC-56 a tag is shown only at 2+ guests, so one guest's own picks are
--     checked in the table (as the owner) rather than through the counts.
--
-- now() is frozen for the whole test (one transaction), so "59 minutes ago"
-- is exact. Everything runs inside BEGIN ... ROLLBACK: nothing is kept.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(52);

-- ---- Setup (as owner) -------------------------------------------------------
-- Users: …d1 and …d2 guests, …d3 a guest whose rating gets hidden, …d4 an
-- admin, …d5 signed in but never finished the age gate (no profile).
insert into auth.users (id, email) values
  ('dddddddd-9999-4999-8999-0000000000d1', 'rate-guest1@test.vibecheck.invalid'),
  ('dddddddd-9999-4999-8999-0000000000d2', 'rate-guest2@test.vibecheck.invalid'),
  ('dddddddd-9999-4999-8999-0000000000d3', 'rate-hidden@test.vibecheck.invalid'),
  ('dddddddd-9999-4999-8999-0000000000d4', 'rate-admin@test.vibecheck.invalid'),
  ('dddddddd-9999-4999-8999-0000000000d5', 'rate-noprofile@test.vibecheck.invalid');
insert into public.profiles (id, display_name, birthdate, is_tester, role) values
  ('dddddddd-9999-4999-8999-0000000000d1', 'Guest one', current_date - interval '30 years', false, 'user'),
  ('dddddddd-9999-4999-8999-0000000000d2', 'Guest two', current_date - interval '25 years', false, 'user'),
  ('dddddddd-9999-4999-8999-0000000000d3', 'Hidden', current_date - interval '25 years', false, 'user'),
  ('dddddddd-9999-4999-8999-0000000000d4', 'Admin', current_date - interval '40 years', false, 'admin');

-- Events: …e1 and …e2 on now; …e3 starts in 5 hours (too early); …e4 ended
-- 2 hours ago (its window closed 1 hour ago); …e5 a test event.
insert into public.events (id, title, area_label, starts_at, ends_at, is_test) values
  ('dddddddd-0000-4000-8000-0000000000e1', 'Rooftop', 'Shaw, DC', now() - interval '1 hour', now() + interval '3 hours', false),
  ('dddddddd-0000-4000-8000-0000000000e2', 'Basement', 'U Street, DC', now() - interval '2 hours', now() + interval '2 hours', false),
  ('dddddddd-0000-4000-8000-0000000000e3', 'Later', 'Shaw, DC', now() + interval '5 hours', now() + interval '9 hours', false),
  ('dddddddd-0000-4000-8000-0000000000e4', 'Earlier', 'Shaw, DC', now() - interval '6 hours', now() - interval '2 hours', false),
  ('dddddddd-0000-4000-8000-0000000000e5', 'Test night', 'Shaw, DC', now() - interval '1 hour', now() + interval '3 hours', true);

-- Check-ins (written directly as owner, the way check_in would). Guest one
-- is fresh at e1, e2, e3 and e4 (e3/e4 only to prove the window still
-- refuses). Guest two is at e1, confirmed 46 minutes ago (stale). The
-- hidden guest and the admin are fresh at e1.
insert into public.check_ins (user_id, event_id, method, first_at, last_verified_at) values
  ('dddddddd-9999-4999-8999-0000000000d1', 'dddddddd-0000-4000-8000-0000000000e1', 'gps', now(), now()),
  ('dddddddd-9999-4999-8999-0000000000d1', 'dddddddd-0000-4000-8000-0000000000e2', 'code', now(), now()),
  ('dddddddd-9999-4999-8999-0000000000d1', 'dddddddd-0000-4000-8000-0000000000e3', 'gps', now(), now()),
  ('dddddddd-9999-4999-8999-0000000000d1', 'dddddddd-0000-4000-8000-0000000000e4', 'gps', now(), now()),
  ('dddddddd-9999-4999-8999-0000000000d2', 'dddddddd-0000-4000-8000-0000000000e1', 'gps', now() - interval '1 hour', now() - interval '46 minutes'),
  ('dddddddd-9999-4999-8999-0000000000d3', 'dddddddd-0000-4000-8000-0000000000e1', 'gps', now(), now()),
  ('dddddddd-9999-4999-8999-0000000000d4', 'dddddddd-0000-4000-8000-0000000000e1', 'gps', now(), now());

-- ---- 1. Locked down (8) -----------------------------------------------------
select ok(not has_function_privilege('anon', 'public.submit_rating(uuid, integer, integer, integer, text, text[])', 'execute')
          and has_function_privilege('authenticated', 'public.submit_rating(uuid, integer, integer, integer, text, text[])', 'execute'),
  'submit_rating: anon can''t call it; signed-in users can');
select ok(not has_function_privilege('anon', 'public.add_heads_up(uuid, text)', 'execute')
          and has_function_privilege('authenticated', 'public.add_heads_up(uuid, text)', 'execute'),
  'add_heads_up: anon can''t call it; signed-in users can');
select ok(not has_function_privilege('anon', 'public.get_event_heads_ups(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.get_event_heads_ups(uuid)', 'execute'),
  'get_event_heads_ups: anon can''t call it; signed-in users can');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'])
           from pg_proc where oid in (
             'public.submit_rating(uuid, integer, integer, integer, text, text[])'::regprocedure,
             'public.add_heads_up(uuid, text)'::regprocedure,
             'public.get_event_heads_ups(uuid)'::regprocedure,
             'private.rating_gate(uuid, uuid, timestamptz, timestamptz)'::regprocedure,
             'private.rating_event(uuid)'::regprocedure)),
  'the rating functions are security definer with an empty search_path');
select ok((select bool_and(prosrc !~* 'raise\s+(notice|log|info|debug|warning)')
           from pg_proc where oid in (
             'public.submit_rating(uuid, integer, integer, integer, text, text[])'::regprocedure,
             'public.add_heads_up(uuid, text)'::regprocedure,
             'public.get_event_heads_ups(uuid)'::regprocedure)),
  'the rating functions never log anything');
select ok(not has_function_privilege('authenticated', 'private.rating_gate(uuid, uuid, timestamptz, timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'private.rating_event(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'private.check_heads_up_tags(text[])', 'execute'),
  'the app can''t call the private helpers');
select ok((select relrowsecurity from pg_class where oid = 'public.heads_up_votes'::regclass)
          and not has_table_privilege('anon', 'public.heads_up_votes', 'select,insert,update,delete')
          and not has_table_privilege('authenticated', 'public.heads_up_votes', 'select,insert,update,delete'),
  'heads_up_votes: RLS on, no rights for anon or signed-in users');
select ok(not has_table_privilege('authenticated', 'public.ratings', 'insert,update,delete'),
  'ratings still can''t be written directly');

-- ---- 2. Who may rate (5) ----------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d5","role":"authenticated"}', true);
select throws_ok($$ select public.submit_rating('dddddddd-0000-4000-8000-0000000000e1', 2, 2, 2) $$,
  '42501', null, 'no profile (never passed the age gate): refused');

select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d4","role":"authenticated"}', true);
select throws_ok($$ select public.submit_rating('dddddddd-0000-4000-8000-0000000000e1', 3, 3, 3) $$,
  'VCSTF', null, 'an admin is refused, even when checked in (staff rule)');
select throws_ok($$ select public.add_heads_up('dddddddd-0000-4000-8000-0000000000e1', 'dress_code') $$,
  'VCSTF', null, 'an admin can''t add a heads-up either');

select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d1","role":"authenticated"}', true);
select throws_ok($$ select public.submit_rating('dddddddd-0000-4000-8000-0000000000e5', 2, 2, 2) $$,
  'VCNFD', null, 'a test event doesn''t exist for a non-tester');
select throws_ok($$ select public.submit_rating('dddddddd-0000-4000-8000-0000000000ff', 2, 2, 2) $$,
  'VCNFD', null, 'an unknown event: VCNFD');

-- ---- 3. Broken input (6) ----------------------------------------------------
select throws_ok($$ select public.submit_rating('dddddddd-0000-4000-8000-0000000000e1', 0, 2, 2) $$,
  'VCRAT', null, 'crowd 0 is refused');
select throws_ok($$ select public.submit_rating('dddddddd-0000-4000-8000-0000000000e1', 2, 4, 2) $$,
  'VCRAT', null, 'music 4 is refused');
select throws_ok($$ select public.submit_rating('dddddddd-0000-4000-8000-0000000000e1', 2, 2, null) $$,
  'VCRAT', null, 'a missing row is refused');
select throws_ok($$ select public.submit_rating('dddddddd-0000-4000-8000-0000000000e1', 2, 2, 2, 'meh') $$,
  'VCRAT', null, 'an unknown reaction is refused');
select throws_ok($$ select public.submit_rating('dddddddd-0000-4000-8000-0000000000e1', 2, 2, 2, null, array['free text']) $$,
  'VCTAG', null, 'an unknown heads-up tag is refused (no free text)');
select is((select count(*)::int from public.ratings
           where user_id = 'dddddddd-9999-4999-8999-0000000000d1'),
  0, 'nothing was saved by the refused calls');

-- ---- 4. Here now and the window (6) -----------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d2","role":"authenticated"}', true);
select is(public.submit_rating('dddddddd-0000-4000-8000-0000000000e1', 2, 2, 2),
  '{"status": "check_in_stale"}'::jsonb, 'check-in confirmed 46 minutes ago: check_in_stale');
select is(public.submit_rating('dddddddd-0000-4000-8000-0000000000e2', 2, 2, 2),
  '{"status": "not_checked_in"}'::jsonb, 'no check-in at this event: not_checked_in');

select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d1","role":"authenticated"}', true);
select is(public.submit_rating('dddddddd-0000-4000-8000-0000000000e3', 2, 2, 2) ->> 'reason',
  'too_early', 'before the window opens: outside_window, too_early');
select is(public.submit_rating('dddddddd-0000-4000-8000-0000000000e4', 2, 2, 2),
  jsonb_build_object('status', 'outside_window', 'reason', 'too_late',
    'opens_at', now() - interval '6 hours 30 minutes', 'closes_at', now() - interval '1 hour'),
  'after the window closes: outside_window, too_late, with the times');

-- Exactly 45 minutes is still "here now".
reset role;
update public.check_ins set last_verified_at = now() - interval '45 minutes'
where user_id = 'dddddddd-9999-4999-8999-0000000000d2' and event_id = 'dddddddd-0000-4000-8000-0000000000e1';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d2","role":"authenticated"}', true);
select is(public.submit_rating('dddddddd-0000-4000-8000-0000000000e1', 1, 2, 3) ->> 'status',
  'saved', 'check-in confirmed exactly 45 minutes ago: saved');
select is((select count(*)::int from public.ratings
           where event_id in ('dddddddd-0000-4000-8000-0000000000e3', 'dddddddd-0000-4000-8000-0000000000e4')),
  0, 'the out-of-window tries saved nothing');

-- ---- 5. The first save (5) --------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d1","role":"authenticated"}', true);
select is(public.submit_rating('dddddddd-0000-4000-8000-0000000000e1', 3, 3, 2, 'fire', array['lines_long', 'dress_code', 'dress_code']),
  jsonb_build_object('status', 'saved', 'updated', false, 'saved_at', now(),
    'next_update_at', now() + interval '60 minutes', 'score', 8.3, 'raters', 2),
  'first save: saved, score 8.3, 2 raters (this one and guest two)');
select row_eq(
  $$ select crowd, music, energy, reaction from public.ratings
     where user_id = 'dddddddd-9999-4999-8999-0000000000d1'
       and event_id = 'dddddddd-0000-4000-8000-0000000000e1' $$,
  row(3::smallint, 3::smallint, 2::smallint, 'fire'::text),
  'the rating row holds the three taps and the reaction');
reset role;
select is((select array_agg(tag order by tag) from public.heads_up_votes
           where user_id = 'dddddddd-9999-4999-8999-0000000000d1'
             and event_id = 'dddddddd-0000-4000-8000-0000000000e1'),
  array['dress_code', 'lines_long'],
  'the picked tags are saved once each (the repeated "dress_code" counts once)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d1","role":"authenticated"}', true);
select is(public.get_event_heads_ups('dddddddd-0000-4000-8000-0000000000e1'), '[]'::jsonb,
  'VC-56: one guest''s tags aren''t shown yet (not even to that guest)');
-- A second event the same night (a party-code check-in).
select is(public.submit_rating('dddddddd-0000-4000-8000-0000000000e2', 1, 1, 1) ->> 'status',
  'saved', 'the same guest can rate a second event the same night');
select is(public.submit_rating('dddddddd-0000-4000-8000-0000000000e2', 1, 1, 1, 'dead') ->> 'status',
  'too_soon', 'an immediate second save at that event is too_soon');

-- ---- 6. One per event, 59 vs. 60 minutes (6) --------------------------------
reset role;
update public.ratings set updated_at = now() - interval '59 minutes'
where user_id = 'dddddddd-9999-4999-8999-0000000000d1' and event_id = 'dddddddd-0000-4000-8000-0000000000e1';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d1","role":"authenticated"}', true);
select is(public.submit_rating('dddddddd-0000-4000-8000-0000000000e1', 1, 1, 1),
  jsonb_build_object('status', 'too_soon', 'minutes_left', 1, 'next_update_at', now() + interval '1 minute'),
  '59 minutes after the last save: too_soon, 1 minute left');
select is((select crowd::int from public.ratings
           where user_id = 'dddddddd-9999-4999-8999-0000000000d1'
             and event_id = 'dddddddd-0000-4000-8000-0000000000e1'),
  3, 'the too_soon try changed nothing');

reset role;
update public.ratings set updated_at = now() - interval '60 minutes',
                          created_at = now() - interval '60 minutes'
where user_id = 'dddddddd-9999-4999-8999-0000000000d1' and event_id = 'dddddddd-0000-4000-8000-0000000000e1';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d1","role":"authenticated"}', true);
select is(public.submit_rating('dddddddd-0000-4000-8000-0000000000e1', 2, 2, 2, null, array['friendly_crowd']) ->> 'updated',
  'true', 'exactly 60 minutes later: saved as an update');
select is((select count(*)::int from public.ratings
           where user_id = 'dddddddd-9999-4999-8999-0000000000d1'
             and event_id = 'dddddddd-0000-4000-8000-0000000000e1'),
  1, 'still one rating per person per event');
select row_eq(
  $$ select crowd, reaction, created_at = now() - interval '60 minutes', updated_at = now()
     from public.ratings
     where user_id = 'dddddddd-9999-4999-8999-0000000000d1'
       and event_id = 'dddddddd-0000-4000-8000-0000000000e1' $$,
  row(2::smallint, null::text, true, true),
  'the update replaced the taps, cleared the reaction, kept created_at and moved updated_at');
reset role;
select is((select count(*)::int from public.heads_up_votes
           where user_id = 'dddddddd-9999-4999-8999-0000000000d1'
             and event_id = 'dddddddd-0000-4000-8000-0000000000e1'),
  3, 'the update added its new tag and kept the earlier ones (+1s are never taken back)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d1","role":"authenticated"}', true);

-- ---- 7. Heads-up +1 on the event page (7) -----------------------------------
select is(public.add_heads_up('dddddddd-0000-4000-8000-0000000000e1', 'lines_long'),
  '{"status": "already"}'::jsonb, '+1 on a tag you already added: already');
select throws_ok($$ select public.add_heads_up('dddddddd-0000-4000-8000-0000000000e1', 'Lines are long!!') $$,
  'VCTAG', null, '+1 with an unknown tag: VCTAG');
select throws_ok($$ select public.add_heads_up('dddddddd-0000-4000-8000-0000000000e1', null) $$,
  'VCTAG', null, '+1 with no tag: VCTAG');

select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d2","role":"authenticated"}', true);
select is(public.add_heads_up('dddddddd-0000-4000-8000-0000000000e1', 'lines_long'),
  '{"status": "added"}'::jsonb, 'another checked-in guest can +1 it: added');
select is(public.add_heads_up('dddddddd-0000-4000-8000-0000000000e2', 'dress_code'),
  '{"status": "not_checked_in"}'::jsonb, '+1 needs a check-in at that event');
-- VC-67: tags show only once 5+ different guests rated tonight. Five
-- bystander guests (…b1 to …b5, no tags) rate e1 now, written as owner, so
-- the counts below are judged by the per-tag bars. (So "raters" in section
-- 8 is 5 higher than the named guests alone.)
reset role;
insert into auth.users (id, email)
select ('dddddddd-9999-4999-8999-0000000000b' || n)::uuid, 'rate-b' || n || '@test.vibecheck.invalid'
from generate_series(1, 5) n;
insert into public.profiles (id, display_name, birthdate, is_tester, role)
select ('dddddddd-9999-4999-8999-0000000000b' || n)::uuid, 'Bystander ' || n,
       current_date - interval '30 years', false, 'user'
from generate_series(1, 5) n;
insert into public.ratings (user_id, event_id, crowd, music, energy, created_at, updated_at)
select ('dddddddd-9999-4999-8999-0000000000b' || n)::uuid, 'dddddddd-0000-4000-8000-0000000000e1',
       2, 2, 2, now(), now()
from generate_series(1, 5) n;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d2","role":"authenticated"}', true);
select is(public.get_event_heads_ups('dddddddd-0000-4000-8000-0000000000e1') -> 0,
  '{"tag": "lines_long", "count": 2, "mine": true}'::jsonb,
  'counts are most-first; "mine" is true for the caller''s own +1');
select is(public.add_heads_up('dddddddd-0000-4000-8000-0000000000e3', 'dress_code') ->> 'reason',
  'too_early', '+1 before the window opens: outside_window, too_early');

-- ---- 8. Hidden ratings count nowhere (6) ------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d3","role":"authenticated"}', true);
select is(public.submit_rating('dddddddd-0000-4000-8000-0000000000e1', 1, 1, 1, 'dead', array['sound_bad', 'overpriced']) ->> 'raters',
  '8', 'before hiding, 8 people''s ratings count at e1 (3 named guests + 5 bystanders)');
reset role;
update public.ratings set hidden_at = now(), updated_at = now() - interval '2 hours'
where user_id = 'dddddddd-9999-4999-8999-0000000000d3';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d1","role":"authenticated"}', true);
select ok(not (public.get_event_heads_ups('dddddddd-0000-4000-8000-0000000000e1')
               @> '[{"tag": "sound_bad"}]'::jsonb),
  'a hidden guest''s heads-ups don''t count');
select is(public.get_event_heads_ups('dddddddd-0000-4000-8000-0000000000e1'),
  '[{"tag": "lines_long", "count": 2, "mine": true}]'::jsonb,
  'only lines_long (2 visible guests) is listed; 1-guest tags stay under the bar');
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d3","role":"authenticated"}', true);
select is(public.submit_rating('dddddddd-0000-4000-8000-0000000000e1', 3, 3, 3) ->> 'raters',
  '7', 'the hidden guest''s update doesn''t count in raters (2 named guests + 5 bystanders)');
reset role;
select isnt((select hidden_at from public.ratings where user_id = 'dddddddd-9999-4999-8999-0000000000d3'),
  null, 'an update keeps a hidden rating hidden');
select is((select count(*)::int from public.heads_up_votes
           where user_id = 'dddddddd-9999-4999-8999-0000000000d3'),
  2, 'the hidden guest''s +1s are kept, just not counted');

-- ---- 9. Reading the counts (2) ----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-9999-4999-8999-0000000000d1","role":"authenticated"}', true);
select throws_ok($$ select public.get_event_heads_ups('dddddddd-0000-4000-8000-0000000000e5') $$,
  'VCNFD', null, 'a non-tester can''t read a test event''s heads-ups');
select throws_ok($$ select * from public.heads_up_votes $$,
  '42501', null, 'a guest can''t read heads_up_votes directly (so never sees who added what)');

select * from finish();
rollback;
