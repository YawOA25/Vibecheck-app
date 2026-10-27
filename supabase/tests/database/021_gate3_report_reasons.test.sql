-- =============================================================================
-- pgTAP test 21: the 3-rater publish gate (VC-64) and report reasons (VC-65),
-- migration 20261027180000_gate3_report_reasons.sql.
--
-- What it checks, in plain words:
--   * Locked down: the new helper can't be called from the app; every
--     changed function is security definer with an empty search_path; anon
--     can't report; the old two-input report function is back only as a
--     TEMPORARY wrapper for builds made before VC-65 (migration
--     20261027180100_report_tag_compat.sql): same lock-down and grants, and
--     it stores reason null ("No reason"), never 'other'.
--   * VC-64: the gate's number is 3, and submit_rating publishes on the
--     third new rater, not the second (the full privacy walk-through is in
--     017_scoring_privacy.test.sql; the admin republish in 019).
--   * VC-65: each of the five reasons is accepted and stored; a missing or
--     unknown reason is refused (VCRPT); a repeat report
--     with a different reason is still 'already' and doesn't change the
--     stored reason; the table itself refuses an unknown reason; the queue
--     counts reasons per event and tag and never shows who reported.
--
-- now() is frozen for the whole test. Everything runs inside BEGIN ...
-- ROLLBACK: nothing is kept.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

-- ---- Setup (as owner) -------------------------------------------------------
-- Guests …01 to …03 and an admin …a1.
insert into auth.users (id, email)
select ('21212121-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'gate3-' || n || '@test.vibecheck.invalid'
from generate_series(1, 3) n;
insert into auth.users (id, email) values
  ('21212121-9999-4999-8999-0000000000a1', 'gate3-admin@test.vibecheck.invalid');
insert into public.profiles (id, display_name, birthdate, is_tester, role)
select ('21212121-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'Gate3 guest ' || n, current_date - interval '30 years', false, 'user'
from generate_series(1, 3) n;
insert into public.profiles (id, display_name, birthdate, is_tester, role) values
  ('21212121-9999-4999-8999-0000000000a1', 'Gate3 admin', current_date - interval '40 years', false, 'admin');

-- e1 for the gate (all three guests checked in just now), e2 for reports.
insert into public.events (id, title, area_label, starts_at, ends_at, is_test)
select ('21212121-0000-4000-8000-0000000000e' || n)::uuid, 'Gate3 ' || n, 'Shaw, DC',
       now() - interval '1 hour', now() + interval '3 hours', false
from generate_series(1, 2) n;
insert into public.check_ins (user_id, event_id, method, first_at, last_verified_at)
select ('21212121-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '21212121-0000-4000-8000-0000000000e1', 'gps', now(), now()
from generate_series(1, 3) n;

-- ---- 1. Locked down (4) -----------------------------------------------------
select ok(not has_function_privilege('anon', 'private.vibe_publish_after()', 'execute')
          and not has_function_privilege('authenticated', 'private.vibe_publish_after()', 'execute'),
  'the app can''t call the gate helper');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'])
           from pg_proc where oid in (
             'private.vibe_publish_after()'::regprocedure,
             'public.submit_rating(uuid, integer, integer, integer, text, text[])'::regprocedure,
             'private.republish_vibe_after_moderation(uuid)'::regprocedure,
             'public.report_heads_up_tag(uuid, text, text)'::regprocedure,
             'public.admin_get_tag_reports()'::regprocedure)),
  'every changed function is security definer with an empty search_path');
select ok(not has_function_privilege('anon', 'public.report_heads_up_tag(uuid, text, text)', 'execute')
          and has_function_privilege('authenticated', 'public.report_heads_up_tag(uuid, text, text)', 'execute'),
  'anon can''t report; signed-in users can (the checks inside decide the rest)');
select ok((select prosecdef and proconfig @> array['search_path=""']
           from pg_proc where oid = 'public.report_heads_up_tag(uuid, text)'::regprocedure)
          and not has_function_privilege('anon', 'public.report_heads_up_tag(uuid, text)', 'execute')
          and has_function_privilege('authenticated', 'public.report_heads_up_tag(uuid, text)', 'execute'),
  'the temporary two-input wrapper: security definer, empty search_path, anon refused, signed-in allowed');

-- ---- 2. VC-64: the gate is 3 (3) --------------------------------------------
select is(private.vibe_publish_after(), 3, 'the gate''s number is 3 (was 2)');
-- Guests 1 and 2 rate (same frozen moment): 2 new raters, nothing published.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"21212121-9999-4999-8999-000000000001","role":"authenticated"}', true);
select public.submit_rating('21212121-0000-4000-8000-0000000000e1', 3, 3, 3);
select set_config('request.jwt.claims', '{"sub":"21212121-9999-4999-8999-000000000002","role":"authenticated"}', true);
select public.submit_rating('21212121-0000-4000-8000-0000000000e1', 2, 2, 2);
reset role;
select is((select count(*)::int from private.vibe_snapshots
           where event_id = '21212121-0000-4000-8000-0000000000e1'), 0,
  'two new raters: no snapshot yet');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"21212121-9999-4999-8999-000000000003","role":"authenticated"}', true);
select public.submit_rating('21212121-0000-4000-8000-0000000000e1', 1, 1, 1);
reset role;
select is((select raters from private.vibe_snapshots
           where event_id = '21212121-0000-4000-8000-0000000000e1'), 3,
  'the third new rater publishes a snapshot with 3 raters');

-- ---- 3. VC-65: reasons (8) --------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"21212121-9999-4999-8999-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.report_heads_up_tag('21212121-0000-4000-8000-0000000000e2', 'packed', null) $$,
  'VCRPT', null, 'a report without a reason is refused');
select throws_ok($$ select public.report_heads_up_tag('21212121-0000-4000-8000-0000000000e2', 'packed', 'venue_asked') $$,
  'VCRPT', null, 'an unknown reason is refused');
-- Guest 1 reports five tags at e2, one with each reason.
select is(array_agg(public.report_heads_up_tag('21212121-0000-4000-8000-0000000000e2', r.tag, r.reason) ->> 'status'),
  array['reported', 'reported', 'reported', 'reported', 'reported'],
  'each of the five reasons is accepted')
from (values ('packed', 'not_true'), ('overpriced', 'spam'), ('lines_long', 'targets_person'),
             ('sound_bad', 'offensive'), ('good_crowd', 'other')) r(tag, reason);
select is(public.report_heads_up_tag('21212121-0000-4000-8000-0000000000e2', 'packed', 'spam'),
  '{"status": "already"}'::jsonb, 'reporting the same tag again with another reason: still already');
-- Guests 2 and 3 report "packed" too.
select set_config('request.jwt.claims', '{"sub":"21212121-9999-4999-8999-000000000002","role":"authenticated"}', true);
select public.report_heads_up_tag('21212121-0000-4000-8000-0000000000e2', 'packed', 'not_true');
select set_config('request.jwt.claims', '{"sub":"21212121-9999-4999-8999-000000000003","role":"authenticated"}', true);
select public.report_heads_up_tag('21212121-0000-4000-8000-0000000000e2', 'packed', 'targets_person');
-- An old build (before VC-65) reports "overpriced" with no reason.
select set_config('request.jwt.claims', '{"sub":"21212121-9999-4999-8999-000000000002","role":"authenticated"}', true);
select is(public.report_heads_up_tag('21212121-0000-4000-8000-0000000000e2', 'overpriced'),
  '{"status": "reported"}'::jsonb, 'the temporary wrapper still files a report for old builds');
reset role;
select is((select reason from private.tag_reports
           where event_id = '21212121-0000-4000-8000-0000000000e2' and tag = 'overpriced'
             and reporter_id = '21212121-9999-4999-8999-000000000002'), null::text,
  'the wrapper stores reason null ("No reason"), not ''other''');
select is((select array_agg(row(tag, reason)::text order by tag) from private.tag_reports
           where event_id = '21212121-0000-4000-8000-0000000000e2'
             and reporter_id = '21212121-9999-4999-8999-000000000001'),
  array[row('good_crowd'::text, 'other'::text)::text, row('lines_long'::text, 'targets_person'::text)::text,
        row('overpriced'::text, 'spam'::text)::text, row('packed'::text, 'not_true'::text)::text,
        row('sound_bad'::text, 'offensive'::text)::text],
  'each reason is stored with its report; the repeat didn''t change "packed" (still not_true)');
select throws_ok($$ insert into private.tag_reports (event_id, tag, reporter_id, reason)
                    values ('21212121-0000-4000-8000-0000000000e2', 'packed',
                            '21212121-9999-4999-8999-0000000000a1', 'venue_asked') $$,
  '23514', null, 'the table itself refuses an unknown reason');

-- The queue, as the admin.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"21212121-9999-4999-8999-0000000000a1","role":"authenticated"}', true);
select is((select q -> 'reasons' from jsonb_array_elements(public.admin_get_tag_reports()) q
           where q ->> 'event_id' = '21212121-0000-4000-8000-0000000000e2' and q ->> 'tag' = 'packed'),
  '{"not_true": 2, "targets_person": 1}'::jsonb,
  'the queue counts the reasons for "packed": 2 not true, 1 targets a person');
select ok(public.admin_get_tag_reports()::text !~ '21212121-9999-4999-8999-00000000000[123]',
  'no reporter id appears in the queue');

select * from finish();
rollback;
