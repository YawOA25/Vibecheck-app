-- =============================================================================
-- pgTAP test 18: the cto's fixes to the published vibe
-- (migration 20261027150000_vibe_publish_fixes.sql).
--
-- What it checks, in plain words:
--   * Publishing takes the per-event lock, and an older snapshot can never
--     replace a newer one (an admin's late manual publish loses).
--   * The night average is kept only when the score leaves out none, or 5 or
--     more, of the night's ratings. With 6 raters and the score made from the
--     5 newest, the night average would give away the oldest rating, so it
--     is left out; the same when the 3-hour window holds 5 and one older
--     rating is left out.
--
-- now() is frozen for the whole test. Everything runs inside BEGIN ...
-- ROLLBACK: nothing is kept.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

-- ---- Setup (as owner) -------------------------------------------------------
-- Ten guests.
insert into auth.users (id, email)
select ('18181818-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'publish-fix-' || n || '@test.vibecheck.invalid'
from generate_series(1, 10) n;
insert into public.profiles (id, display_name, birthdate, is_tester, role)
select ('18181818-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'Publish fix ' || n, current_date - interval '30 years', false, 'user'
from generate_series(1, 10) n;

-- Events (all on now): …e1 the backwards case, …e2 to …e5 the night average.
-- Start: 7 hours ago, but never before the 5 AM New York that began
-- tonight's night, so the night (VC-54: it ends at the next 5 AM) always
-- holds every rating below, whatever time of day the tests run.
insert into public.events (id, title, area_label, starts_at, ends_at, is_test)
select ('18181818-0000-4000-8000-0000000000e' || n)::uuid, 'Fix ' || n, 'Shaw, DC',
       greatest(now() - interval '7 hours', private.night_start(now())), now() + interval '2 hours', false
from generate_series(1, 5) n;

-- A test-only helper to add ratings: guests from_n..to_n rate the event
-- (3,3,3 = 10 or 1,1,1 = 0) at now() minus `ago`.
create function pg_temp.seed(p_event text, p_from integer, p_to integer, p_value integer, p_ago interval)
returns void
language sql
as $$
  /* Inputs: event id, the first and last guest number, 3 (a 10) or 1 (a 0),
     and how long ago they rated. Returns nothing. */
  insert into public.ratings (user_id, event_id, crowd, music, energy, created_at, updated_at)
  select ('18181818-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid, p_event::uuid,
         p_value, p_value, p_value, now() - p_ago, now() - p_ago
  from generate_series(p_from, p_to) n;
$$;

-- e1: five 10s just now.
select pg_temp.seed('18181818-0000-4000-8000-0000000000e1', 1, 5, 3, interval '0');
-- e2: the oldest rating (a 0) 8 hours ago, then five 10s 4 hours ago. Quiet,
-- so the score is worked out at the last rating; its 3-hour window holds just
-- the 5 newest. 6 raters in the night.
select pg_temp.seed('18181818-0000-4000-8000-0000000000e2', 1, 1, 1, interval '8 hours');
select pg_temp.seed('18181818-0000-4000-8000-0000000000e2', 2, 6, 3, interval '4 hours');
-- e3: just five 10s 4 hours ago (the score uses all of them).
select pg_temp.seed('18181818-0000-4000-8000-0000000000e3', 1, 5, 3, interval '4 hours');
-- e4: five 0s 8 hours ago and five 10s 4 hours ago (5 left out of the score).
select pg_temp.seed('18181818-0000-4000-8000-0000000000e4', 1, 5, 1, interval '8 hours');
select pg_temp.seed('18181818-0000-4000-8000-0000000000e4', 6, 10, 3, interval '4 hours');
-- e5: a 0 five hours ago and five 10s 100 minutes ago (the window at the
-- last rating holds those 5; the 0 is just outside it).
select pg_temp.seed('18181818-0000-4000-8000-0000000000e5', 1, 1, 1, interval '5 hours');
select pg_temp.seed('18181818-0000-4000-8000-0000000000e5', 2, 6, 3, interval '100 minutes');

-- ---- 1. Publishing is locked and never goes backwards (3) -------------------
select ok((select prosrc ~ 'pg_advisory_xact_lock\(hashtext\(''vibecheck\.vibe_publish:'''
           from pg_proc where oid = 'private.publish_event_vibe(uuid, timestamptz)'::regprocedure),
  'publish_event_vibe takes the same per-event lock as submit_rating');
select private.publish_event_vibe('18181818-0000-4000-8000-0000000000e1', now());
-- A late publish for an EARLIER moment (before any of the ratings) arrives.
select private.publish_event_vibe('18181818-0000-4000-8000-0000000000e1', now() - interval '10 minutes');
select is((select published_at from private.vibe_snapshots
           where event_id = '18181818-0000-4000-8000-0000000000e1'), now(),
  'an older publish doesn''t replace a newer snapshot');
select is((select raters from private.vibe_snapshots
           where event_id = '18181818-0000-4000-8000-0000000000e1'), 5,
  'the newer snapshot''s totals stay (5 raters, not the older moment''s 0)');

-- ---- 2. The night average can't single out a rating (5) ---------------------
select private.publish_event_vibe(e.id, now())
from (values ('18181818-0000-4000-8000-0000000000e2'::uuid), ('18181818-0000-4000-8000-0000000000e3'::uuid),
             ('18181818-0000-4000-8000-0000000000e4'::uuid), ('18181818-0000-4000-8000-0000000000e5'::uuid)) e(id);

-- e2: without the fix, 6 x 8.3 - 5 x 10.0 = -0.2, so the oldest is clearly a 0.
-- ("breakdown" and "night", VC-53/54, are checked with a fixed clock in 023.)
select is(private.published_vibe('18181818-0000-4000-8000-0000000000e2', now()) - 'here' - 'reactions' - 'breakdown' - 'night',
  jsonb_build_object('state', 'stale', 'raters', 6, 'score', 10.0, 'label', 'Fire',
    'night_average', null, 'minutes_since_last', 240),
  'privacy: 6 raters, score from the 5 newest: no night average (it would reveal the oldest rating)');
-- Since 20261027210000 the night average never leaves the database, so the
-- rule is checked on the value the snapshot stores.
select is((select night_average from private.vibe_snapshots where event_id = '18181818-0000-4000-8000-0000000000e5'), null,
  'privacy: 5 in the window plus 1 older: no night average either');
select is((select night_average from private.vibe_snapshots where event_id = '18181818-0000-4000-8000-0000000000e3'), 10.0,
  'the score uses every rating (none left out): the night average is shown');
select is((select night_average from private.vibe_snapshots where event_id = '18181818-0000-4000-8000-0000000000e4'), 5.0,
  '5 ratings left out of the score: the night average (an average of 5+) is shown');
select is((select count(*)::int from private.vibe_snapshots
           where event_id in ('18181818-0000-4000-8000-0000000000e2', '18181818-0000-4000-8000-0000000000e3',
                              '18181818-0000-4000-8000-0000000000e4', '18181818-0000-4000-8000-0000000000e5')
             and night_average is not null), 2,
  'of e2 to e5, only the two safe snapshots store a night average at all');

select * from finish();
rollback;
