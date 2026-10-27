-- =============================================================================
-- pgTAP test 19: the admin moderation screen for ratings and +1s (VC-47,
-- migration 20261027160000_admin_moderation.sql).
--
-- What it checks, in plain words:
--   * Locked down: anon can't call the admin functions at all; a signed-in
--     guest (not an admin) and someone without a profile are refused (42501);
--     the new log table is private.
--   * The written removal rule: hiding needs one of the three removal
--     reasons, unhiding one of the restore reasons; "the venue asked" isn't
--     a reason at all.
--   * Hiding a rating republishes the score snapshot at once (the score and
--     the rater count change), unhiding brings it back, and each decision is
--     logged with its reason.
--   * While 1 or 2 new ratings are waiting (below the 3-rater gate, VC-64),
--     the republish does NOT release them: the snapshot keeps its own
--     moment. With 3 waiting, it publishes as of now.
--   * +1s from someone who never rated can be removed and restored. Removal
--     covers the person for the whole event: a re-tap or a NEW tag added
--     afterwards doesn't count either, until restored.
--
-- now() is frozen for the whole test. Everything runs inside BEGIN ...
-- ROLLBACK: nothing is kept.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(34);

-- ---- Setup (as owner) -------------------------------------------------------
-- Guests …01 to …08, an admin …a1, and …b1 signed in without a profile.
insert into auth.users (id, email)
select ('19191919-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'moderation-' || n || '@test.vibecheck.invalid'
from generate_series(1, 8) n;
insert into auth.users (id, email) values
  ('19191919-9999-4999-8999-0000000000a1', 'moderation-admin@test.vibecheck.invalid'),
  ('19191919-9999-4999-8999-0000000000b1', 'moderation-noprofile@test.vibecheck.invalid');
insert into public.profiles (id, display_name, birthdate, is_tester, role)
select ('19191919-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'Mod guest ' || n, current_date - interval '30 years', false, 'user'
from generate_series(1, 8) n;
insert into public.profiles (id, display_name, birthdate, is_tester, role) values
  ('19191919-9999-4999-8999-0000000000a1', 'Mod admin', current_date - interval '40 years', false, 'admin');

-- Events, all on now: …e1 for hide/unhide, …e2 for the "two waiting" case,
-- …e3 for the "three waiting" case (VC-64).
insert into public.events (id, title, area_label, starts_at, ends_at, is_test)
select ('19191919-0000-4000-8000-0000000000e' || n)::uuid, 'Mod ' || n, 'Shaw, DC',
       now() - interval '2 hours', now() + interval '3 hours', false
from generate_series(1, 3) n;

-- A test-only helper to add ratings (as owner): guests from..to give
-- value (3 = a 10, 1 = a 0) at now() minus `ago`.
create function pg_temp.seed(p_event text, p_from integer, p_to integer, p_value integer, p_ago interval)
returns void
language sql
as $$
  /* Inputs: event id, first and last guest number, 3 or 1, how long ago.
     Returns nothing. */
  insert into public.ratings (user_id, event_id, crowd, music, energy, created_at, updated_at)
  select ('19191919-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid, p_event::uuid,
         p_value, p_value, p_value, now() - p_ago, now() - p_ago
  from generate_series(p_from, p_to) n;
$$;

-- e1: guest 1 gives a 0, guests 2-6 give 10s, all 10 minutes ago; published.
select pg_temp.seed('19191919-0000-4000-8000-0000000000e1', 1, 1, 1, interval '10 minutes');
select pg_temp.seed('19191919-0000-4000-8000-0000000000e1', 2, 6, 3, interval '10 minutes');
select private.publish_event_vibe('19191919-0000-4000-8000-0000000000e1', now());
-- e2: guest 1 a 0 and guests 2-6 10s an hour ago, published 30 minutes ago;
-- then guests 7 and 8 rated 5 minutes ago (two ratings waiting, below the
-- gate of 3, VC-64).
select pg_temp.seed('19191919-0000-4000-8000-0000000000e2', 1, 1, 1, interval '1 hour');
select pg_temp.seed('19191919-0000-4000-8000-0000000000e2', 2, 6, 3, interval '1 hour');
select private.publish_event_vibe('19191919-0000-4000-8000-0000000000e2', now() - interval '30 minutes');
select pg_temp.seed('19191919-0000-4000-8000-0000000000e2', 7, 8, 3, interval '5 minutes');
-- e3: guest 1 a 0 and guests 2-5 10s an hour ago, published 30 minutes ago;
-- then guests 6, 7 and 8 rated 5 minutes ago (three waiting: the gate's number).
select pg_temp.seed('19191919-0000-4000-8000-0000000000e3', 1, 1, 1, interval '1 hour');
select pg_temp.seed('19191919-0000-4000-8000-0000000000e3', 2, 5, 3, interval '1 hour');
select private.publish_event_vibe('19191919-0000-4000-8000-0000000000e3', now() - interval '30 minutes');
select pg_temp.seed('19191919-0000-4000-8000-0000000000e3', 6, 8, 3, interval '5 minutes');

-- Guest 8 never rated e1 but +1'd "packed" there just now (checked in by code).
insert into public.check_ins (user_id, event_id, method, first_at, last_verified_at) values
  ('19191919-9999-4999-8999-000000000008', '19191919-0000-4000-8000-0000000000e1', 'code', now(), now());
insert into public.heads_up_votes (user_id, event_id, tag, created_at) values
  ('19191919-9999-4999-8999-000000000008', '19191919-0000-4000-8000-0000000000e1', 'packed', now());

-- ---- 1. Locked down (6) -----------------------------------------------------
select ok(not has_function_privilege('anon', 'public.admin_get_event_moderation(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.admin_set_rating_hidden(uuid, uuid, boolean, text, text)', 'execute')
          and not has_function_privilege('anon', 'public.admin_set_heads_ups_hidden(uuid, uuid, boolean, text, text)', 'execute'),
  'anon can''t call any of the three admin functions');
select ok(has_function_privilege('authenticated', 'public.admin_get_event_moderation(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.admin_set_rating_hidden(uuid, uuid, boolean, text, text)', 'execute')
          and has_function_privilege('authenticated', 'public.admin_set_heads_ups_hidden(uuid, uuid, boolean, text, text)', 'execute'),
  'signed-in users can call them (the admin check inside decides)');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'])
           from pg_proc where oid in (
             'public.admin_get_event_moderation(uuid)'::regprocedure,
             'public.admin_set_rating_hidden(uuid, uuid, boolean, text, text)'::regprocedure,
             'public.admin_set_heads_ups_hidden(uuid, uuid, boolean, text, text)'::regprocedure,
             'public.get_event_heads_ups(uuid)'::regprocedure,
             'private.require_admin()'::regprocedure,
             'private.republish_vibe_after_moderation(uuid)'::regprocedure)),
  'the moderation functions are security definer with an empty search_path');
select ok(not has_function_privilege('authenticated', 'private.require_admin()', 'execute')
          and not has_function_privilege('authenticated', 'private.check_moderation_reason(boolean, text, text)', 'execute')
          and not has_function_privilege('authenticated', 'private.republish_vibe_after_moderation(uuid)', 'execute'),
  'the app can''t call the private helpers');
select ok((select relrowsecurity from pg_class where oid = 'private.moderation_log'::regclass)
          and not has_table_privilege('anon', 'private.moderation_log', 'select,insert,update,delete')
          and not has_table_privilege('authenticated', 'private.moderation_log', 'select,insert,update,delete'),
  'moderation_log: RLS on, no rights for anon or signed-in users');

set local role anon;
select throws_ok($$ select public.admin_get_event_moderation('19191919-0000-4000-8000-0000000000e1') $$,
  '42501', null, 'anon calling the admin screen''s list: permission denied');
reset role;

-- ---- 2. Non-admins are refused (4) ------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"19191919-9999-4999-8999-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.admin_get_event_moderation('19191919-0000-4000-8000-0000000000e1') $$,
  '42501', null, 'a plain guest can''t see the moderation list');
select throws_ok($$ select public.admin_set_rating_hidden('19191919-0000-4000-8000-0000000000e1',
                      '19191919-9999-4999-8999-000000000001', true, 'coordinated') $$,
  '42501', null, 'a plain guest can''t hide a rating');
select throws_ok($$ select public.admin_set_heads_ups_hidden('19191919-0000-4000-8000-0000000000e1',
                      '19191919-9999-4999-8999-000000000008', true, 'coordinated') $$,
  '42501', null, 'a plain guest can''t remove +1s');
select set_config('request.jwt.claims',
  '{"sub":"19191919-9999-4999-8999-0000000000b1","role":"authenticated"}', true);
select throws_ok($$ select public.admin_set_rating_hidden('19191919-0000-4000-8000-0000000000e1',
                      '19191919-9999-4999-8999-000000000001', true, 'coordinated') $$,
  '42501', null, 'signed in without a profile: refused');

-- ---- 3. The written removal rule (4) ----------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"19191919-9999-4999-8999-0000000000a1","role":"authenticated"}', true);
select throws_ok($$ select public.admin_set_rating_hidden('19191919-0000-4000-8000-0000000000e1',
                      '19191919-9999-4999-8999-000000000001', true, 'venue_asked') $$,
  'VCRSN', null, '"the venue asked" is not a reason to hide anything');
select throws_ok($$ select public.admin_set_rating_hidden('19191919-0000-4000-8000-0000000000e1',
                      '19191919-9999-4999-8999-000000000001', true, 'no_rule_broken') $$,
  'VCRSN', null, 'hiding needs a removal reason');
select throws_ok($$ select public.admin_set_rating_hidden('19191919-0000-4000-8000-0000000000e1',
                      '19191919-9999-4999-8999-000000000001', false, 'coordinated') $$,
  'VCRSN', null, 'unhiding needs a restore reason');
select throws_ok(format($$ select public.admin_set_rating_hidden('19191919-0000-4000-8000-0000000000e1',
                      '19191919-9999-4999-8999-000000000001', true, 'coordinated', %L) $$, repeat('x', 501)),
  'VCRSN', null, 'a note over 500 characters is refused');

-- ---- 4. Hide and unhide republish the snapshot (7) --------------------------
reset role;
select is((select score from private.vibe_snapshots where event_id = '19191919-0000-4000-8000-0000000000e1'),
  8.3, 'before: the published score is 8.3 (five 10s and one 0)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"19191919-9999-4999-8999-0000000000a1","role":"authenticated"}', true);
select is(public.admin_set_rating_hidden('19191919-0000-4000-8000-0000000000e1',
            '19191919-9999-4999-8999-000000000001', true, 'broke_tester_rules', 'Targeted the host'),
  '{"status": "done"}'::jsonb, 'the admin hides guest 1''s rating');
reset role;
select is((select row(score, raters)::text from private.vibe_snapshots
           where event_id = '19191919-0000-4000-8000-0000000000e1'),
  row(10.0, 5)::text, 'the snapshot changed at once: score 10.0 from 5 raters');
select is((select row(action, reason, note, target_user_id::text)::text from private.moderation_log
           where event_id = '19191919-0000-4000-8000-0000000000e1'),
  row('hide_rating'::text, 'broke_tester_rules'::text, 'Targeted the host'::text,
      '19191919-9999-4999-8999-000000000001'::text)::text,
  'the hide is logged with its reason, note and guest');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"19191919-9999-4999-8999-0000000000a1","role":"authenticated"}', true);
select is(public.admin_set_rating_hidden('19191919-0000-4000-8000-0000000000e1',
            '19191919-9999-4999-8999-000000000001', true, 'coordinated'),
  '{"status": "unchanged"}'::jsonb, 'hiding it again: unchanged');
select is(public.admin_set_rating_hidden('19191919-0000-4000-8000-0000000000e1',
            '19191919-9999-4999-8999-000000000001', false, 'mistake'),
  '{"status": "done"}'::jsonb, 'the admin unhides it');
reset role;
select is((select row(score, raters, (select count(*) from private.moderation_log
                                       where event_id = '19191919-0000-4000-8000-0000000000e1'))::text
           from private.vibe_snapshots where event_id = '19191919-0000-4000-8000-0000000000e1'),
  row(8.3, 6, 2)::text, 'the snapshot is back to 8.3 from 6, and only 2 decisions were logged');

-- ---- 5. Waiting ratings below the gate stay waiting (3) -------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"19191919-9999-4999-8999-0000000000a1","role":"authenticated"}', true);
select public.admin_set_rating_hidden('19191919-0000-4000-8000-0000000000e2',
  '19191919-9999-4999-8999-000000000001', true, 'not_checked_in');
reset role;
select is((select row(published_at, raters, score)::text from private.vibe_snapshots
           where event_id = '19191919-0000-4000-8000-0000000000e2'),
  row(now() - interval '30 minutes', 5, 10.0)::text,
  'with two new ratings waiting (VC-64), the snapshot is re-made at its own moment: the hidden 0 drops out, guests 7 and 8 are not released');
select is((select raters from private.vibe_snapshots where event_id = '19191919-0000-4000-8000-0000000000e2')
          + 0, 5, 'still 5 raters, not 7');
-- e3: three are waiting, which the gate would publish anyway: publish now.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"19191919-9999-4999-8999-0000000000a1","role":"authenticated"}', true);
select public.admin_set_rating_hidden('19191919-0000-4000-8000-0000000000e3',
  '19191919-9999-4999-8999-000000000001', true, 'not_checked_in');
reset role;
select is((select row(published_at, raters, score)::text from private.vibe_snapshots
           where event_id = '19191919-0000-4000-8000-0000000000e3'),
  row(now(), 7, 10.0)::text,
  'with three new ratings waiting, the republish is as of now: 7 raters, the hidden 0 left out');

-- ---- 6. +1s from someone who never rated (9) --------------------------------
-- "Remove +1s" applies to the person for the whole event (cto fix,
-- 20261027170000_heads_up_bans.sql): a NEW tag added afterwards doesn't
-- count either, until the admin restores them.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"19191919-9999-4999-8999-000000000002","role":"authenticated"}', true);
select is(public.get_event_heads_ups('19191919-0000-4000-8000-0000000000e1'),
  '[{"tag": "packed", "count": 1, "mine": false}]'::jsonb, 'before: guest 8''s +1 counts');
select set_config('request.jwt.claims',
  '{"sub":"19191919-9999-4999-8999-0000000000a1","role":"authenticated"}', true);
select is(public.admin_set_heads_ups_hidden('19191919-0000-4000-8000-0000000000e1',
            '19191919-9999-4999-8999-000000000008', true, 'coordinated'),
  '{"status": "done"}'::jsonb, 'the admin removes the +1s of a guest who never rated');
select is(public.admin_set_heads_ups_hidden('19191919-0000-4000-8000-0000000000e1',
            '19191919-9999-4999-8999-000000000008', true, 'coordinated'),
  '{"status": "unchanged"}'::jsonb, 'removing them again: unchanged (not logged twice)');
select throws_ok($$ select public.admin_set_rating_hidden('19191919-0000-4000-8000-0000000000e1',
                      '19191919-9999-4999-8999-000000000008', true, 'coordinated') $$,
  'VCNFD', null, 'that guest has no rating to hide');
-- Guest 8 taps the old tag again AND +1s a tag they never picked before.
select set_config('request.jwt.claims',
  '{"sub":"19191919-9999-4999-8999-000000000008","role":"authenticated"}', true);
select public.add_heads_up('19191919-0000-4000-8000-0000000000e1', 'packed');
select public.add_heads_up('19191919-0000-4000-8000-0000000000e1', 'lines_long');
select is(public.get_event_heads_ups('19191919-0000-4000-8000-0000000000e1'), '[]'::jsonb,
  'after removal, neither the old tag nor a NEW tag from that guest counts');
select set_config('request.jwt.claims',
  '{"sub":"19191919-9999-4999-8999-0000000000a1","role":"authenticated"}', true);
select is((select jsonb_build_object('off', p -> 'heads_ups_removed',
             'tags', jsonb_path_query_array(p -> 'heads_ups', '$[*].removed'))
           from jsonb_array_elements(
             public.admin_get_event_moderation('19191919-0000-4000-8000-0000000000e1') -> 'people') p
           where p ->> 'user_id' = '19191919-9999-4999-8999-000000000008'),
  '{"off": true, "tags": [true, true]}'::jsonb,
  'the admin list shows the guest as removed, the new tag included');
reset role;
select is(private.counted_tag_votes('19191919-0000-4000-8000-0000000000e1', 'lines_long'), 0,
  'the queue''s all-night count skips the removed guest''s new tag too');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"19191919-9999-4999-8999-0000000000a1","role":"authenticated"}', true);
select is(public.admin_set_heads_ups_hidden('19191919-0000-4000-8000-0000000000e1',
            '19191919-9999-4999-8999-000000000008', false, 'no_rule_broken'),
  '{"status": "done"}'::jsonb, 'the admin restores them');
select is(jsonb_array_length(public.get_event_heads_ups('19191919-0000-4000-8000-0000000000e1')), 2,
  'restoring lifts it: both of the guest''s tags count again');

-- ---- 7. What the admin screen lists (1) -------------------------------------
select is((select p from jsonb_array_elements(
             public.admin_get_event_moderation('19191919-0000-4000-8000-0000000000e1') -> 'people') p
           where p ->> 'user_id' = '19191919-9999-4999-8999-000000000008') - 'joined_at'
          #- '{heads_ups,0,added_at}' #- '{heads_ups,1,added_at}',
  jsonb_build_object('user_id', '19191919-9999-4999-8999-000000000008', 'display_name', 'Mod guest 8',
    'check_in_method', 'code', 'rating', null, 'heads_ups_removed', false,
    'heads_ups', jsonb_build_array(jsonb_build_object('tag', 'lines_long', 'removed', false),
                                   jsonb_build_object('tag', 'packed', 'removed', false))),
  'the list includes a guest who only +1''d, with their check-in method and no rating');

select * from finish();
rollback;
