-- =============================================================================
-- pgTAP test 20: "Report this tag" and the admin report queue (VC-58,
-- migration 20261027160100_tag_reports.sql).
--
-- What it checks, in plain words:
--   * Locked down: anon can't call anything; plain guests can report but are
--     refused (42501) by every admin function; the two new tables are private.
--   * Reporting: any adult who can see the event may report (no check-in
--     needed); one report per person per tag per event ('already'); at most 10
--     in 24 hours ('too_many'); unknown tags and hidden test events refused.
--   * The queue: grouped per event and tag, oldest first, with hours waiting
--     and an overdue flag at 48 hours, and never the reporter's id.
--   * Hide: the tag disappears from the event page, the reports close, and
--     the decision is logged with its reason. Keep: reports close as kept.
--
-- now() is frozen for the whole test. Everything runs inside BEGIN ...
-- ROLLBACK: nothing is kept.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

-- ---- Setup (as owner) -------------------------------------------------------
-- Guests …01 to …03, an admin …a1.
insert into auth.users (id, email)
select ('20202020-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'tag-report-' || n || '@test.vibecheck.invalid'
from generate_series(1, 3) n;
insert into auth.users (id, email) values
  ('20202020-9999-4999-8999-0000000000a1', 'tag-report-admin@test.vibecheck.invalid');
insert into public.profiles (id, display_name, birthdate, is_tester, role)
select ('20202020-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'Reporter ' || n, current_date - interval '30 years', false, 'user'
from generate_series(1, 3) n;
insert into public.profiles (id, display_name, birthdate, is_tester, role) values
  ('20202020-9999-4999-8999-0000000000a1', 'Report admin', current_date - interval '40 years', false, 'admin');

-- Events …e1 to …e9 on now (real), …ef a test event.
insert into public.events (id, title, area_label, starts_at, ends_at, is_test)
select ('20202020-0000-4000-8000-0000000000e' || n)::uuid, 'Report ' || n, 'Shaw, DC',
       now() - interval '1 hour', now() + interval '3 hours', false
from generate_series(1, 9) n;
insert into public.events (id, title, area_label, starts_at, ends_at, is_test) values
  ('20202020-0000-4000-8000-0000000000ef', 'Test only', 'Shaw, DC', now() - interval '1 hour', now() + interval '3 hours', true);

-- At e1, guests 1 and 2 +1'd "overpriced" and guest 1 "packed".
insert into public.heads_up_votes (user_id, event_id, tag, created_at) values
  ('20202020-9999-4999-8999-000000000001', '20202020-0000-4000-8000-0000000000e1', 'overpriced', now()),
  ('20202020-9999-4999-8999-000000000002', '20202020-0000-4000-8000-0000000000e1', 'overpriced', now()),
  ('20202020-9999-4999-8999-000000000001', '20202020-0000-4000-8000-0000000000e1', 'packed', now());

-- An old open report at e2 (guest 2, 50 hours ago): overdue.
insert into private.tag_reports (event_id, tag, reporter_id, created_at) values
  ('20202020-0000-4000-8000-0000000000e2', 'sound_bad', '20202020-9999-4999-8999-000000000002', now() - interval '50 hours');

-- ---- 1. Locked down (7) -----------------------------------------------------
select ok(not has_function_privilege('anon', 'public.report_heads_up_tag(uuid, text)', 'execute')
          and not has_function_privilege('anon', 'public.admin_get_tag_reports()', 'execute')
          and not has_function_privilege('anon', 'public.admin_get_event_tags(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.admin_set_tag_hidden(uuid, text, boolean, text, text)', 'execute')
          and not has_function_privilege('anon', 'public.admin_keep_tag(uuid, text, text, text)', 'execute'),
  'anon can''t call any of the report functions');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'])
           from pg_proc where oid in (
             'public.report_heads_up_tag(uuid, text)'::regprocedure,
             'public.admin_get_tag_reports()'::regprocedure,
             'public.admin_get_event_tags(uuid)'::regprocedure,
             'public.admin_set_tag_hidden(uuid, text, boolean, text, text)'::regprocedure,
             'public.admin_keep_tag(uuid, text, text, text)'::regprocedure,
             'private.counted_tag_votes(uuid, text)'::regprocedure)),
  'the report functions are security definer with an empty search_path');
select ok((select bool_and(relrowsecurity) from pg_class
           where oid in ('private.tag_reports'::regclass, 'private.hidden_event_tags'::regclass))
          and not has_table_privilege('authenticated', 'private.tag_reports', 'select,insert,update,delete')
          and not has_table_privilege('authenticated', 'private.hidden_event_tags', 'select,insert,update,delete')
          and not has_table_privilege('anon', 'private.tag_reports', 'select,insert,update,delete')
          and not has_table_privilege('anon', 'private.hidden_event_tags', 'select,insert,update,delete')
          and not has_function_privilege('authenticated', 'private.counted_tag_votes(uuid, text)', 'execute'),
  'tag_reports and hidden_event_tags: RLS on, no rights for the app; the helper is private');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"20202020-9999-4999-8999-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.admin_get_tag_reports() $$,
  '42501', null, 'a plain guest can''t see the report queue');
select throws_ok($$ select public.admin_set_tag_hidden('20202020-0000-4000-8000-0000000000e1', 'overpriced', true, 'coordinated') $$,
  '42501', null, 'a plain guest can''t hide a tag');
select throws_ok($$ select public.admin_keep_tag('20202020-0000-4000-8000-0000000000e1', 'overpriced', 'no_rule_broken') $$,
  '42501', null, 'a plain guest can''t keep (close) a tag''s reports');
select throws_ok($$ select public.admin_get_event_tags('20202020-0000-4000-8000-0000000000e1') $$,
  '42501', null, 'a plain guest can''t see an event''s tag list for admins');

-- ---- 2. Reporting (8) -------------------------------------------------------
-- Guest 3 never checked in anywhere: reporting still works (hosts, venues).
select is(public.report_heads_up_tag('20202020-0000-4000-8000-0000000000e1', 'overpriced'),
  '{"status": "reported"}'::jsonb, 'any adult can report a tag, checked in or not');
select is(public.report_heads_up_tag('20202020-0000-4000-8000-0000000000e1', 'overpriced'),
  '{"status": "already"}'::jsonb, 'the same tag again: already');
select throws_ok($$ select public.report_heads_up_tag('20202020-0000-4000-8000-0000000000e1', 'liar') $$,
  'VCTAG', null, 'an unknown tag is refused');
select throws_ok($$ select public.report_heads_up_tag('20202020-0000-4000-8000-0000000000ef', 'packed') $$,
  'VCNFD', null, 'a test event doesn''t exist for a non-tester');
-- Nine more reports (events e1..e9, different tags) reach 10 in 24 hours.
select public.report_heads_up_tag('20202020-0000-4000-8000-0000000000e1', 'packed');
select public.report_heads_up_tag(('20202020-0000-4000-8000-0000000000e' || n)::uuid, 'packed')
from generate_series(2, 9) n;
reset role;
select is((select count(*)::int from private.tag_reports
           where reporter_id = '20202020-9999-4999-8999-000000000003'), 10,
  'guest 3 has 10 reports');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"20202020-9999-4999-8999-000000000003","role":"authenticated"}', true);
select is(public.report_heads_up_tag('20202020-0000-4000-8000-0000000000e2', 'lines_long'),
  '{"status": "too_many"}'::jsonb, 'the 11th within 24 hours: too_many');
reset role;
select is((select count(*)::int from private.tag_reports
           where reporter_id = '20202020-9999-4999-8999-000000000003'), 10,
  'the refused report saved nothing');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"20202020-9999-4999-8999-000000000001","role":"authenticated"}', true);
select is(public.report_heads_up_tag('20202020-0000-4000-8000-0000000000e1', 'overpriced'),
  '{"status": "reported"}'::jsonb, 'a second person reports the same tag');

-- ---- 3. The queue (4) -------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"20202020-9999-4999-8999-0000000000a1","role":"authenticated"}', true);
select is((public.admin_get_tag_reports() -> 0) - 'event_starts_at' - 'first_reported_at',
  jsonb_build_object('event_id', '20202020-0000-4000-8000-0000000000e2', 'event_title', 'Report 2',
    'tag', 'sound_bad', 'reports', 1, 'hours_waiting', 50, 'overdue', true, 'votes', 0, 'hidden', false),
  'oldest first: the 50-hour-old report is marked overdue');
select is((select q - 'event_starts_at' - 'first_reported_at'
           from jsonb_array_elements(public.admin_get_tag_reports()) q
           where q ->> 'event_id' = '20202020-0000-4000-8000-0000000000e1' and q ->> 'tag' = 'overpriced'),
  jsonb_build_object('event_id', '20202020-0000-4000-8000-0000000000e1', 'event_title', 'Report 1',
    'tag', 'overpriced', 'reports', 2, 'hours_waiting', 0, 'overdue', false, 'votes', 2, 'hidden', false),
  'two reports about one tag are one queue row, with its 2 votes; fresh, not overdue');
select ok(public.admin_get_tag_reports()::text !~ '20202020-9999-4999-8999-00000000000[123]'
          and public.admin_get_event_moderation('20202020-0000-4000-8000-0000000000e1')::text
              !~ '20202020-9999-4999-8999-000000000003',
  'no reporter id appears in the queue, and the guest who only reported isn''t on the moderation list');
select is(jsonb_array_length(public.admin_get_tag_reports()), 11,
  '11 open queue rows (e1 overpriced, e1..e9 packed, e2 sound_bad)');

-- ---- 4. Hide and keep (7) ---------------------------------------------------
select throws_ok($$ select public.admin_set_tag_hidden('20202020-0000-4000-8000-0000000000e1', 'overpriced', true, 'venue_asked') $$,
  'VCRSN', null, 'hiding a tag because "the venue asked" is refused');
select is(public.admin_set_tag_hidden('20202020-0000-4000-8000-0000000000e1', 'overpriced', true, 'coordinated', 'Two new accounts'),
  '{"status": "done"}'::jsonb, 'the admin hides the tag at e1');
select is(public.get_event_heads_ups('20202020-0000-4000-8000-0000000000e1'),
  '[{"tag": "packed", "count": 1, "mine": false}]'::jsonb,
  'the hidden tag is gone from the event page; other tags stay');
select is(public.admin_get_event_tags('20202020-0000-4000-8000-0000000000e1'),
  '[{"tag": "overpriced", "votes": 2, "hidden": true, "open_reports": 0},
    {"tag": "packed", "votes": 1, "hidden": false, "open_reports": 1}]'::jsonb,
  'the admin still sees both tags, with the hidden one marked and its reports closed');
select is(public.admin_keep_tag('20202020-0000-4000-8000-0000000000e1', 'packed', 'no_rule_broken'),
  '{"status": "done"}'::jsonb, 'keeping a tag closes its reports');
reset role;
select is((select array_agg(row(action, tag, reason)::text order by id) from private.moderation_log
           where event_id = '20202020-0000-4000-8000-0000000000e1'),
  array[row('hide_tag'::text, 'overpriced'::text, 'coordinated'::text)::text,
        row('keep_tag'::text, 'packed'::text, 'no_rule_broken'::text)::text],
  'both decisions are logged with their reasons');
select is((select array_agg(resolution order by tag) from private.tag_reports
           where event_id = '20202020-0000-4000-8000-0000000000e1'
             and tag in ('overpriced', 'packed')
             and reporter_id = '20202020-9999-4999-8999-000000000003'),
  array['hidden', 'kept'], 'the reports were closed as hidden and kept');

select * from finish();
rollback;
