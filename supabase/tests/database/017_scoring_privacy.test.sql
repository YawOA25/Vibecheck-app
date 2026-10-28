-- =============================================================================
-- pgTAP test 17: the scoring and privacy batch approved 2026-10-27:
--   VC-50 minimum weight 0.25 in the live-score window
--         (migration 20261027140000_vibe_min_weight.sql);
--   VC-55 "N here" counts the last 3 hours while on, the whole night after
--         the end; VC-46 heads-up counts only the last 3 hours
--         (20261027140100_live_windows.sql);
--   VC-51 a new score is published only after 3+ new raters (2 until VC-64,
--         20261027140200_vibe_publish_gate.sql + 20261027180000_gate3_report_reasons.sql);
--   VC-48 the server side of the quiet GPS check for party-code guests:
--         check_in judges them by distance and never changes their method.
--
-- What it checks, in plain words:
--   * Locked down: the new helpers and table can't be reached from the app,
--     everything is security definer with an empty search_path, and the
--     snapshot table has no user ids in it.
--   * VC-50: an old rating in the window weighs 0.25, not less (10 now plus
--     five 0s from 2 hours ago = 4.4, where it used to be 7.6); 45 minutes
--     old is above the floor and keeps its normal weight; older than 3
--     hours still counts zero.
--   * VC-51, the privacy cases: one new rating changes NOTHING the app can
--     see (not the score, the count or the reaction tally), even though the
--     fresh score would have moved; two new raters publish nothing and the
--     third publishes (VC-64); one
--     person rating twice (a first rating and an update an hour later)
--     counts once; a hidden guest's save doesn't count; a published snapshot
--     goes stale after 90 minutes with its night average.
--   * VC-55: on, check-ins confirmed in the last 3 hours count (3 hours
--     exactly too, 3 hours 1 minute not); ended, everyone counts.
--   * VC-46: heads-ups from the last 3 hours count; an old +1 can be added
--     again (refreshed), a counted one can't; rating with a tag refreshes too.
--   * VC-48: a party-code guest's quiet reading that is too far answers
--     too_far and leaves their check-in alone; a near one refreshes it and
--     keeps the method 'code'.
--
-- How time is handled: now() is frozen for the whole test (one transaction),
-- so every submit_rating happens at the same instant. To make time "pass",
-- pg_temp.rewind() moves an event's ratings and published snapshot back by
-- some minutes (check-ins stay fresh so guests may keep rating). Everything
-- runs inside BEGIN ... ROLLBACK: nothing is kept.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(50);

-- ---- Setup (as owner) -------------------------------------------------------
-- A test-only helper (pg_temp: gone when the session ends; inside this
-- rolled-back transaction anyway).
create function pg_temp.rewind(p_event_id uuid, p_minutes integer)
returns void
language sql
as $$
  /*
    What it does: pretends p_minutes have passed for one event, by moving its
    ratings and its published snapshot back that far.
    Inputs: the event and the number of minutes.
  */
  update public.ratings
     set updated_at = updated_at - make_interval(mins => p_minutes),
         created_at = created_at - make_interval(mins => p_minutes)
   where event_id = p_event_id;
  update private.vibe_snapshots
     set published_at = published_at - make_interval(mins => p_minutes),
         scored_at = scored_at - make_interval(mins => p_minutes)
   where event_id = p_event_id;
$$;

-- Users: …01 to …08 and …10 guests, …09 a guest whose rating is hidden.
insert into auth.users (id, email)
select ('17171717-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'scoring-' || n || '@test.vibecheck.invalid'
from generate_series(1, 10) n;
insert into public.profiles (id, display_name, birthdate, is_tester, role)
select ('17171717-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'Scoring ' || n, current_date - interval '30 years', false, 'user'
from generate_series(1, 10) n;

-- Events: …a1 to …a3 for the VC-50 maths, …b1 the publish gate, …c1 on now
-- and …c2 ended 30 minutes ago (VC-55), …d1 heads-ups and the code guest.
insert into public.events (id, title, area_label, starts_at, ends_at, is_test) values
  ('17171717-0000-4000-8000-0000000000a1', 'Floor', 'Shaw, DC', now() - interval '4 hours', now() + interval '3 hours', false),
  ('17171717-0000-4000-8000-0000000000a2', 'Above floor', 'Shaw, DC', now() - interval '4 hours', now() + interval '3 hours', false),
  ('17171717-0000-4000-8000-0000000000a3', 'Outside window', 'Shaw, DC', now() - interval '4 hours', now() + interval '3 hours', false),
  -- b1 never starts before tonight's 5 AM New York, so its night (VC-54) holds
  -- every rating whatever time of day the tests run.
  ('17171717-0000-4000-8000-0000000000b1', 'Gate', 'Shaw, DC', greatest(now() - interval '1 hour', private.night_start(now())), now() + interval '3 hours', false),
  ('17171717-0000-4000-8000-0000000000c1', 'Here on', 'Shaw, DC', now() - interval '5 hours', now() + interval '1 hour', false),
  ('17171717-0000-4000-8000-0000000000c2', 'Here ended', 'Shaw, DC', now() - interval '5 hours', now() - interval '30 minutes', false),
  ('17171717-0000-4000-8000-0000000000d1', 'Heads-ups', 'Shaw, DC', now() - interval '5 hours', now() + interval '2 hours', false);
insert into public.event_private (event_id, lat, lng, radius_m, check_in_code) values
  ('17171717-0000-4000-8000-0000000000d1', 38.9, -77.0, 150, 'SCORE1');

-- VC-50 maths (written as owner; 3,3,3 scores 10 and 1,1,1 scores 0).
insert into public.ratings (user_id, event_id, crowd, music, energy, created_at, updated_at)
select ('17171717-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid, e.id,
       case when n = 1 then 3 else 1 end, case when n = 1 then 3 else 1 end, case when n = 1 then 3 else 1 end,
       now() - case when n = 1 then interval '0' else e.age end,
       now() - case when n = 1 then interval '0' else e.age end
from generate_series(1, 6) n
cross join (values
  -- a1: five 0s 2 hours ago (would weigh 1/16, floored to 0.25).
  ('17171717-0000-4000-8000-0000000000a1'::uuid, interval '120 minutes'),
  -- a2: five 0s 45 minutes ago (weigh 0.354, above the floor).
  ('17171717-0000-4000-8000-0000000000a2'::uuid, interval '45 minutes')) e(id, age);
-- a3: five 0s 30 minutes ago and a 10 from 3 hours 1 minute ago (outside).
insert into public.ratings (user_id, event_id, crowd, music, energy, created_at, updated_at)
select ('17171717-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '17171717-0000-4000-8000-0000000000a3',
       case when n = 1 then 3 else 1 end, case when n = 1 then 3 else 1 end, case when n = 1 then 3 else 1 end,
       now() - case when n = 1 then interval '181 minutes' else interval '30 minutes' end,
       now() - case when n = 1 then interval '181 minutes' else interval '30 minutes' end
from generate_series(1, 6) n;

-- The gate event: everyone checked in just now (so all may rate), and guest
-- 9 has an old rating there that an admin hid.
insert into public.check_ins (user_id, event_id, method, first_at, last_verified_at)
select ('17171717-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '17171717-0000-4000-8000-0000000000b1', 'gps', now(), now()
from generate_series(1, 10) n;
insert into public.ratings (user_id, event_id, crowd, music, energy, created_at, updated_at, hidden_at) values
  ('17171717-9999-4999-8999-000000000009', '17171717-0000-4000-8000-0000000000b1', 1, 1, 1,
   now() - interval '2 hours', now() - interval '2 hours', now() - interval '1 hour');

-- VC-55: the same four check-ins at the "on" and the "ended" event.
insert into public.check_ins (user_id, event_id, method, first_at, last_verified_at)
select u.id, e.id, 'gps', now() - interval '4 hours', now() - u.ago
from (values
  -- confirmed 4 hours ago: out while on
  ('17171717-9999-4999-8999-000000000001'::uuid, interval '4 hours'),
  -- re-checked 2 hours ago: in
  ('17171717-9999-4999-8999-000000000002'::uuid, interval '2 hours'),
  -- exactly 3 hours ago: in (the edge counts)
  ('17171717-9999-4999-8999-000000000003'::uuid, interval '3 hours'),
  -- 3 hours 1 minute ago: out while on
  ('17171717-9999-4999-8999-000000000004'::uuid, interval '3 hours 1 minute')) u(id, ago)
cross join (values ('17171717-0000-4000-8000-0000000000c1'::uuid), ('17171717-0000-4000-8000-0000000000c2'::uuid)) e(id);

-- VC-46 + VC-48 at d1: guests 1 to 3 checked in by GPS, guest 4 by party
-- code 30 minutes ago. Heads-ups: guest 1 lines_long exactly 3 hours ago
-- (counts), guest 2 lines_long 3 hours 1 minute ago (doesn't), guest 4
-- lines_long 1 hour ago (counts), guest 3 picking_up 4 hours ago (doesn't),
-- guest 1 picking_up now (counts, but alone it stays below the VC-56 bar of
-- 2 guests, so it isn't shown yet).
insert into public.check_ins (user_id, event_id, method, first_at, last_verified_at) values
  ('17171717-9999-4999-8999-000000000001', '17171717-0000-4000-8000-0000000000d1', 'gps', now(), now()),
  ('17171717-9999-4999-8999-000000000002', '17171717-0000-4000-8000-0000000000d1', 'gps', now(), now()),
  ('17171717-9999-4999-8999-000000000003', '17171717-0000-4000-8000-0000000000d1', 'gps', now(), now()),
  ('17171717-9999-4999-8999-000000000004', '17171717-0000-4000-8000-0000000000d1', 'code',
   now() - interval '30 minutes', now() - interval '30 minutes');
insert into public.heads_up_votes (user_id, event_id, tag, created_at) values
  ('17171717-9999-4999-8999-000000000001', '17171717-0000-4000-8000-0000000000d1', 'lines_long', now() - interval '3 hours'),
  ('17171717-9999-4999-8999-000000000002', '17171717-0000-4000-8000-0000000000d1', 'lines_long', now() - interval '3 hours 1 minute'),
  ('17171717-9999-4999-8999-000000000004', '17171717-0000-4000-8000-0000000000d1', 'lines_long', now() - interval '1 hour'),
  ('17171717-9999-4999-8999-000000000003', '17171717-0000-4000-8000-0000000000d1', 'picking_up', now() - interval '4 hours'),
  ('17171717-9999-4999-8999-000000000001', '17171717-0000-4000-8000-0000000000d1', 'picking_up', now());

-- ---- 1. Locked down (5) -----------------------------------------------------
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'])
           from pg_proc where oid in (
             'private.event_here(uuid, timestamptz)'::regprocedure,
             'private.publish_event_vibe(uuid, timestamptz)'::regprocedure,
             'private.published_vibe(uuid, timestamptz)'::regprocedure,
             'private.vibe_score_at(uuid, timestamptz)'::regprocedure,
             'private.event_vibe(uuid, timestamptz)'::regprocedure,
             'public.submit_rating(uuid, integer, integer, integer, text, text[])'::regprocedure,
             'public.add_heads_up(uuid, text)'::regprocedure,
             'public.get_event_heads_ups(uuid)'::regprocedure,
             'public.get_event_vibe(uuid)'::regprocedure,
             'public.get_events_vibe(uuid[])'::regprocedure)),
  'new and replaced functions are security definer with an empty search_path');
select ok(not has_function_privilege('authenticated', 'private.event_here(uuid, timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'private.publish_event_vibe(uuid, timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'private.published_vibe(uuid, timestamptz)', 'execute')
          and not has_function_privilege('anon', 'private.publish_event_vibe(uuid, timestamptz)', 'execute')
          and not has_function_privilege('anon', 'private.published_vibe(uuid, timestamptz)', 'execute'),
  'the app can''t call the new private helpers (or publish, or pick the clock)');
select ok(not has_function_privilege('anon', 'public.submit_rating(uuid, integer, integer, integer, text, text[])', 'execute')
          and not has_function_privilege('anon', 'public.get_event_vibe(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.get_events_vibe(uuid[])', 'execute')
          and not has_function_privilege('anon', 'public.add_heads_up(uuid, text)', 'execute')
          and not has_function_privilege('anon', 'public.get_event_heads_ups(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.get_event_vibe(uuid)', 'execute'),
  'anon still can''t call the replaced app functions; signed-in users can');
select ok((select relrowsecurity from pg_class where oid = 'private.vibe_snapshots'::regclass)
          and not has_table_privilege('anon', 'private.vibe_snapshots', 'select,insert,update,delete')
          and not has_table_privilege('authenticated', 'private.vibe_snapshots', 'select,insert,update,delete'),
  'vibe_snapshots: RLS on, no rights for anon or signed-in users');
select is((select array_agg(column_name::text order by column_name::text)
           from information_schema.columns
           where table_schema = 'private' and table_name = 'vibe_snapshots'),
  -- VC-53/54 (20261027200000) added row averages and the night count: totals, not ids.
  array['crowd_average', 'energy_average', 'event_id', 'music_average', 'night_average',
        'night_crowd_average', 'night_energy_average', 'night_music_average', 'night_raters',
        'published_at', 'raters', 'reactions', 'score', 'scored_at'],
  'vibe_snapshots holds totals only: no user id column');

-- ---- 2. VC-50: the 0.25 floor (3) -------------------------------------------
-- a1: 10 x 1 / (1 + 5 x 0.25) = 4.44 -> 4.4 (without the floor: 7.6).
select is(private.vibe_score_at('17171717-0000-4000-8000-0000000000a1', now()), 4.4,
  'VC-50: five 0s from 2 hours ago weigh 0.25 each, so one fresh 10 gives 4.4, not 7.6');
-- a2: 0.5^(45/30) = 0.354, above the floor: 10 / (1 + 5 x 0.354) = 3.6.
select is(private.vibe_score_at('17171717-0000-4000-8000-0000000000a2', now()), 3.6,
  'VC-50: a weight above 0.25 (45 minutes old) is unchanged: 3.6');
-- a3: the 10 is 3 h 1 min old, outside the window: the five 0s alone = 0.0.
select is(private.vibe_score_at('17171717-0000-4000-8000-0000000000a3', now()), 0.0,
  'VC-50: the floor never brings back a rating older than 3 hours');

-- ---- 3. VC-51 + VC-64: the publish gate (24) ------------------------------
set local role authenticated;
-- Guest 1 rates: the first new rater. Nothing is published yet.
select set_config('request.jwt.claims', '{"sub":"17171717-9999-4999-8999-000000000001","role":"authenticated"}', true);
select is(public.submit_rating('17171717-0000-4000-8000-0000000000b1', 3, 3, 3, 'fire') ->> 'status', 'saved',
  'gate: guest 1 rates');
select is(public.get_event_vibe('17171717-0000-4000-8000-0000000000b1') - 'here' - 'breakdown' - 'night',
  jsonb_build_object('state', 'none', 'raters', 0, 'score', null, 'label', null,
    'night_average', null, 'minutes_since_last', null, 'reactions', '[]'::jsonb),
  'privacy: ONE new rating publishes nothing (still none, 0 raters)');

-- Guest 2 rates a minute later: only 2 new raters, below the gate of 3
-- (VC-64), so still nothing is published.
reset role;
select pg_temp.rewind('17171717-0000-4000-8000-0000000000b1', 1);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17171717-9999-4999-8999-000000000002","role":"authenticated"}', true);
select is(public.submit_rating('17171717-0000-4000-8000-0000000000b1', 3, 3, 3, 'fire') ->> 'status', 'saved',
  'gate: guest 2 rates');
select is((public.get_event_vibe('17171717-0000-4000-8000-0000000000b1') ->> 'raters')::int, 0,
  'privacy (VC-64): TWO new ratings publish nothing either (still 0 raters)');

-- Guest 3, a minute later: the third new rater publishes.
reset role;
select pg_temp.rewind('17171717-0000-4000-8000-0000000000b1', 1);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17171717-9999-4999-8999-000000000003","role":"authenticated"}', true);
select public.submit_rating('17171717-0000-4000-8000-0000000000b1', 3, 3, 2, 'dancing');
select is(public.get_event_vibe('17171717-0000-4000-8000-0000000000b1') - 'here' - 'breakdown' - 'night',
  jsonb_build_object('state', 'early', 'raters', 3, 'score', null, 'label', null,
    'night_average', null, 'minutes_since_last', 0, 'reactions', '[]'::jsonb),
  'the third new rater publishes: early, 3 raters (no number under 5)');

-- Guests 4 and 5, a minute apart: 1 and then 2 new raters, so nothing moves.
reset role;
select pg_temp.rewind('17171717-0000-4000-8000-0000000000b1', 1);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17171717-9999-4999-8999-000000000004","role":"authenticated"}', true);
select public.submit_rating('17171717-0000-4000-8000-0000000000b1', 2, 2, 2);
select is((public.get_event_vibe('17171717-0000-4000-8000-0000000000b1') ->> 'raters')::int, 3,
  'privacy: guest 4 alone changes nothing (still 3 raters)');
reset role;
select pg_temp.rewind('17171717-0000-4000-8000-0000000000b1', 1);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17171717-9999-4999-8999-000000000005","role":"authenticated"}', true);
select is(public.submit_rating('17171717-0000-4000-8000-0000000000b1', 3, 2, 2, 'fire') ->> 'raters', '5',
  'the rater still hears the live count in their own answer ("You and 4 others")');
select is(public.get_event_vibe('17171717-0000-4000-8000-0000000000b1') ->> 'state', 'early',
  'privacy: the 5th rating doesn''t turn on the number (still early: 2 new raters, below the gate)');

-- Guest 6: the third new rater (with 4 and 5) publishes the first number.
reset role;
select pg_temp.rewind('17171717-0000-4000-8000-0000000000b1', 1);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17171717-9999-4999-8999-000000000006","role":"authenticated"}', true);
select public.submit_rating('17171717-0000-4000-8000-0000000000b1', 3, 3, 3, 'fire');
reset role;
-- What the app sees now must be exactly the fresh vibe at this moment.
-- ("breakdown" and "night", VC-53/54, are checked with a fixed clock in 023.)
select is(private.published_vibe('17171717-0000-4000-8000-0000000000b1', now()) - 'breakdown' - 'night',
  private.event_vibe('17171717-0000-4000-8000-0000000000b1', now()),
  'guest 6 publishes: the snapshot equals the fresh vibe at that moment');
select is(private.published_vibe('17171717-0000-4000-8000-0000000000b1', now()) - 'score' - 'label' - 'here' - 'breakdown' - 'night',
  jsonb_build_object('state', 'live', 'raters', 6, 'night_average', null, 'minutes_since_last', 0,
    'reactions', '[{"reaction": "fire", "count": 4}, {"reaction": "dancing", "count": 1}]'::jsonb),
  'live with 6 raters and the tally (fire 4, dancing 1)');

-- Guest 7 rates a 0 with "dead" a minute later. THE privacy case: the fresh
-- score, count and tally all move, but the app's answer must not.
create temp table before_7 on commit drop as
  select private.published_vibe('17171717-0000-4000-8000-0000000000b1', now() + interval '1 minute') as v;
select pg_temp.rewind('17171717-0000-4000-8000-0000000000b1', 1);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17171717-9999-4999-8999-000000000007","role":"authenticated"}', true);
select is(public.submit_rating('17171717-0000-4000-8000-0000000000b1', 1, 1, 1, 'dead') ->> 'status', 'saved',
  'gate: guest 7 rates a 0 with "dead"');
reset role;
select isnt(private.event_vibe('17171717-0000-4000-8000-0000000000b1', now()) -> 'score',
  (select v -> 'score' from before_7),
  'the fresh score WOULD have moved with guest 7''s 0 ...');
select is(private.published_vibe('17171717-0000-4000-8000-0000000000b1', now()),
  (select v from before_7),
  '... but the published answer is identical: score, raters 6 and tally (no "dead") unchanged');
set local role authenticated;
select is(public.get_event_vibe('17171717-0000-4000-8000-0000000000b1') -> 'reactions',
  '[{"reaction": "fire", "count": 4}, {"reaction": "dancing", "count": 1}]'::jsonb,
  'privacy: the reaction tally the app sees doesn''t show guest 7''s "dead"');

-- One person twice: an hour passes and guest 7 updates. Still ONE new rater.
reset role;
select pg_temp.rewind('17171717-0000-4000-8000-0000000000b1', 61);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17171717-9999-4999-8999-000000000007","role":"authenticated"}', true);
select is(public.submit_rating('17171717-0000-4000-8000-0000000000b1', 1, 1, 2) ->> 'updated', 'true',
  'guest 7 updates an hour later');
select is((public.get_event_vibe('17171717-0000-4000-8000-0000000000b1') ->> 'raters')::int, 6,
  'privacy: one person''s rating plus their update count once (nothing published)');

-- The hidden guest updates: their rating stays hidden and doesn't count.
reset role;
select pg_temp.rewind('17171717-0000-4000-8000-0000000000b1', 1);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17171717-9999-4999-8999-000000000009","role":"authenticated"}', true);
select is(public.submit_rating('17171717-0000-4000-8000-0000000000b1', 3, 3, 3) ->> 'status', 'saved',
  'the hidden guest saves again');
select is((public.get_event_vibe('17171717-0000-4000-8000-0000000000b1') ->> 'raters')::int, 6,
  'a hidden guest''s save is not a new rater (nothing published)');

-- Guest 8: the second visible new rater (with guest 7). Below the gate.
reset role;
select pg_temp.rewind('17171717-0000-4000-8000-0000000000b1', 1);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17171717-9999-4999-8999-000000000008","role":"authenticated"}', true);
select public.submit_rating('17171717-0000-4000-8000-0000000000b1', 2, 2, 2);
select is((public.get_event_vibe('17171717-0000-4000-8000-0000000000b1') ->> 'raters')::int, 6,
  'privacy (VC-64): 2 visible new raters (7 and 8; the hidden one doesn''t count) publish nothing');

-- Guest 10: the third visible new rater publishes.
reset role;
select pg_temp.rewind('17171717-0000-4000-8000-0000000000b1', 1);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17171717-9999-4999-8999-000000000010","role":"authenticated"}', true);
select public.submit_rating('17171717-0000-4000-8000-0000000000b1', 3, 2, 2);
select is((public.get_event_vibe('17171717-0000-4000-8000-0000000000b1') ->> 'raters')::int, 9,
  'guest 10 publishes: 9 raters (the hidden one still left out)');
select is(
  (select item - 'event_id' from jsonb_array_elements(
     public.get_events_vibe(array['17171717-0000-4000-8000-0000000000b1'::uuid])) item),
  public.get_event_vibe('17171717-0000-4000-8000-0000000000b1'),
  'the Tonight list shows the same published vibe');
select ok(public.get_event_vibe('17171717-0000-4000-8000-0000000000b1')::text !~ '17171717-9999',
  'no user id appears in the answer');

-- Stale: 90 minutes after the snapshot's newest rating.
reset role;
select pg_temp.rewind('17171717-0000-4000-8000-0000000000b1', 90);
select is(private.published_vibe('17171717-0000-4000-8000-0000000000b1', now()) - 'reactions' - 'here' - 'score' - 'label' - 'breakdown' - 'night',
  jsonb_build_object('state', 'stale', 'raters', 9, 'minutes_since_last', 90, 'night_average', null),
  'a snapshot 90 minutes old is stale; the night average is never sent (20261027210000)');
-- The night average is still worked out and kept inside the database (the
-- All night word comes from it); it just never leaves.
select is((select night_average from private.vibe_snapshots
           where event_id = '17171717-0000-4000-8000-0000000000b1'),
  (select round(avg(r.score), 1) from public.ratings r
   where r.event_id = '17171717-0000-4000-8000-0000000000b1' and r.hidden_at is null),
  'the snapshot keeps the night average of its ratings, inside the database only');
select ok(query_to_xml('select * from private.vibe_snapshots', true, false, '')::text !~ '17171717-9999',
  'no user id is stored in the snapshots');

-- ---- 4. VC-55: "N here" (4) -------------------------------------------------
select is(private.event_here('17171717-0000-4000-8000-0000000000c1', now()), 2,
  'on: only check-ins confirmed in the last 3 hours count (3 h exactly in, 3 h 1 min out)');
select is(private.event_here('17171717-0000-4000-8000-0000000000c2', now()), 4,
  'ended: "were here" counts everyone who checked in that night');
select is(private.event_here('17171717-0000-4000-8000-0000000000c1', now() - interval '5 hours'), 0,
  'a check-in made after the moment asked isn''t counted');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17171717-9999-4999-8999-000000000005","role":"authenticated"}', true);
select is((public.get_event_vibe('17171717-0000-4000-8000-0000000000c1') ->> 'here')::int, 2,
  'the event page''s "N here" uses the 3-hour window');

-- ---- 5. VC-46: heads-ups from the last 3 hours (7) --------------------------
select set_config('request.jwt.claims', '{"sub":"17171717-9999-4999-8999-000000000002","role":"authenticated"}', true);
select is(public.get_event_heads_ups('17171717-0000-4000-8000-0000000000d1'),
  '[{"tag": "lines_long", "count": 2, "mine": false}]'::jsonb,
  'only +1s from the last 3 hours count (3 h exactly in; 3 h 1 min out; picking_up has 1 guest, under the bar)');
select is(public.add_heads_up('17171717-0000-4000-8000-0000000000d1', 'lines_long') ->> 'status', 'added',
  'an own +1 older than 3 hours can be added again (refreshed)');
select is(public.get_event_heads_ups('17171717-0000-4000-8000-0000000000d1'),
  '[{"tag": "lines_long", "count": 3, "mine": true}]'::jsonb,
  'the refreshed +1 counts and shows as mine');
select is(public.add_heads_up('17171717-0000-4000-8000-0000000000d1', 'lines_long') ->> 'status', 'already',
  'a +1 that still counts can''t be added twice');
select set_config('request.jwt.claims', '{"sub":"17171717-9999-4999-8999-000000000001","role":"authenticated"}', true);
select is(public.add_heads_up('17171717-0000-4000-8000-0000000000d1', 'lines_long') ->> 'status', 'already',
  'a +1 exactly 3 hours old still counts, so it is "already"');
select set_config('request.jwt.claims', '{"sub":"17171717-9999-4999-8999-000000000003","role":"authenticated"}', true);
select is(public.submit_rating('17171717-0000-4000-8000-0000000000d1', 2, 2, 2, null, array['picking_up']) ->> 'status', 'saved',
  'rating with an old tag picked');
select is(public.get_event_heads_ups('17171717-0000-4000-8000-0000000000d1') -> 1,
  '{"tag": "picking_up", "count": 2, "mine": true}'::jsonb,
  'rating refreshes the old picking_up +1, so it counts again (now 2 guests, so shown)');

-- ---- 6. VC-48: the quiet check for a party-code guest (6) -------------------
-- The app sends the reading straight to check_in (app/rate/[id].tsx).
select set_config('request.jwt.claims', '{"sub":"17171717-9999-4999-8999-000000000004","role":"authenticated"}', true);
select is(public.check_in('17171717-0000-4000-8000-0000000000d1', 38.9 + degrees(2000 / 6371008.8), -77.0, 10) ->> 'status',
  'too_far', 'a party-code guest 2 km away: too_far (the app then stops the rating)');
reset role;
select is((select row(c.method, c.last_verified_at)::text from public.check_ins c
           where c.user_id = '17171717-9999-4999-8999-000000000004'
             and c.event_id = '17171717-0000-4000-8000-0000000000d1'),
  row('code'::text, now() - interval '30 minutes')::text,
  'too_far leaves the party-code check-in as it was');
set local role authenticated;
select is(public.check_in('17171717-0000-4000-8000-0000000000d1', 38.9, -77.0, 10) ->> 'status',
  'passed', 'a party-code guest at the party: passed');
reset role;
select is((select row(c.method, c.last_verified_at)::text from public.check_ins c
           where c.user_id = '17171717-9999-4999-8999-000000000004'
             and c.event_id = '17171717-0000-4000-8000-0000000000d1'),
  row('code'::text, now())::text,
  'a near reading refreshes "here now" and keeps the method ''code''');
-- Search for the far reading's own latitude to 6 decimals (38.917986...),
-- worked out here the same way it was sent. A shorter pattern such as
-- '38.917' also matched a real venue's pin on the shared dev project.
select is_empty(
  format($$ select t.table_schema || '.' || t.table_name
     from information_schema.tables t
     where t.table_schema in ('public', 'private')
       and t.table_type = 'BASE TABLE'
       and query_to_xml(format('select * from %%I.%%I', t.table_schema, t.table_name),
                        true, false, '')::text ~ %L $$,
    replace(left((38.9 + degrees(2000 / 6371008.8))::text, 9), '.', '\.')),
  'the far reading''s coordinates were stored in no table');
select is((select count(*)::int from public.check_in_attempts a
           where a.user_id = '17171717-9999-4999-8999-000000000004'),
  2, 'both quiet checks were recorded as attempts (pass/fail only)');

select * from finish();
rollback;
