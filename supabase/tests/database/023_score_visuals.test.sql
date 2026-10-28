-- =============================================================================
-- pgTAP test 23: the breakdown tiles (VC-53) and the "All night" view
-- (VC-54), migration 20261027200000_score_visuals.sql.
--
-- What it checks, in plain words:
--   * Locked down: every new or replaced helper is security definer with an
--     empty search_path, and the app (anon or signed in) can't call any of
--     them.
--   * The helpers: the night ends at the next 5 AM New York; a row's average
--     turns into the right word at the edges (1.66 low, 1.6667 middle, 2.33
--     middle, 2.34 top).
--   * Tiles: none in 'early' (4 ratings); words only (never a number); five
--     identical ratings show their words (agreement, not one person); the
--     tiles use the score's own weights (fresh 10s outweigh 2-hour-old 0s).
--   * All night is WORDS ONLY (cto, migration 20261027210000): no score key,
--     no number but its count, and night_average is always null.
--   * All night: shown when the live set and the night set are the same, or
--     differ by 5+; withheld (score and tiles) when they differ by 1 to 4 in
--     either direction: 1 old rating left out of the score, or 1 rating
--     after 5 AM that is in the score but not in the night. "over" turns
--     true at 5 AM.
--   * The gate: through submit_rating, ONE new rating changes nothing in the
--     answer (tiles and night included); the third new rater publishes.
--
-- Most scenarios use a fixed clock: a Friday-night event in October 2026
-- (no daylight-saving change), published and read at fixed moments, so the
-- results don't depend on when the tests run. Everything runs inside
-- BEGIN ... ROLLBACK: nothing is kept.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

-- ---- Setup (as owner) -------------------------------------------------------
-- Twelve guests.
insert into auth.users (id, email)
select ('23232323-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'visuals-' || n || '@test.vibecheck.invalid'
from generate_series(1, 12) n;
insert into public.profiles (id, display_name, birthdate, is_tester, role)
select ('23232323-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'Visuals ' || n, current_date - interval '30 years', false, 'user'
from generate_series(1, 12) n;

-- Fixed-clock events …e1 to …e7: Friday 9 Oct 2026, 10 PM to 4:30 AM New
-- York (EDT, -04). Their night ends Saturday 10 Oct, 5 AM New York.
insert into public.events (id, title, area_label, starts_at, ends_at, is_test)
select ('23232323-0000-4000-8000-0000000000e' || n)::uuid, 'Visuals ' || n, 'Shaw, DC',
       '2026-10-09 22:00-04'::timestamptz, '2026-10-10 04:30-04'::timestamptz, false
from generate_series(1, 7) n;
-- …e8 is on now, for the real submit_rating path. It never starts before
-- tonight's 5 AM New York, so its night always holds its ratings.
insert into public.events (id, title, area_label, starts_at, ends_at, is_test) values
  ('23232323-0000-4000-8000-0000000000e8', 'Visuals gate', 'Shaw, DC',
   greatest(now() - interval '1 hour', private.night_start(now())), now() + interval '3 hours', false);

-- A test-only helper to add ratings directly (as owner).
create function pg_temp.seed(p_event text, p_from integer, p_to integer,
                             p_crowd integer, p_music integer, p_energy integer, p_at timestamptz)
returns void
language sql
as $$
  /* Guests p_from..p_to rate event p_event (crowd, music, energy each 1-3)
     at the moment p_at. Returns nothing. */
  insert into public.ratings (user_id, event_id, crowd, music, energy, created_at, updated_at)
  select ('23232323-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid, p_event::uuid,
         p_crowd, p_music, p_energy, p_at, p_at
  from generate_series(p_from, p_to) n;
$$;

-- e1 early: 4 top ratings at 2 AM.
select pg_temp.seed('23232323-0000-4000-8000-0000000000e1', 1, 4, 3, 3, 3, '2026-10-10 02:00-04');
-- e2 five identical ratings (crowd 3, music 1, energy 2) at 1 AM.
select pg_temp.seed('23232323-0000-4000-8000-0000000000e2', 1, 5, 3, 1, 2, '2026-10-10 01:00-04');
-- e3 one 0 at 10 PM, then five 10s at 2 AM (the window at 2 AM holds just
-- the five; the 0 is in the night but not in the score: 1 left out).
select pg_temp.seed('23232323-0000-4000-8000-0000000000e3', 1, 1, 1, 1, 1, '2026-10-09 22:00-04');
select pg_temp.seed('23232323-0000-4000-8000-0000000000e3', 2, 6, 3, 3, 3, '2026-10-10 02:00-04');
-- e4 five 0s at 10 PM, then five 10s at 2 AM (5 left out of the score).
select pg_temp.seed('23232323-0000-4000-8000-0000000000e4', 1, 5, 1, 1, 1, '2026-10-09 22:00-04');
select pg_temp.seed('23232323-0000-4000-8000-0000000000e4', 6, 10, 3, 3, 3, '2026-10-10 02:00-04');
-- e5 five 10s at 4 AM, then one 0 at 5:10 AM: in the score, not in the night.
select pg_temp.seed('23232323-0000-4000-8000-0000000000e5', 1, 5, 3, 3, 3, '2026-10-10 04:00-04');
select pg_temp.seed('23232323-0000-4000-8000-0000000000e5', 6, 6, 1, 1, 1, '2026-10-10 05:10-04');
-- e6 five 10s at 4 AM, then five 0s at 5:10 AM (5 after the night ends).
select pg_temp.seed('23232323-0000-4000-8000-0000000000e6', 1, 5, 3, 3, 3, '2026-10-10 04:00-04');
select pg_temp.seed('23232323-0000-4000-8000-0000000000e6', 6, 10, 1, 1, 1, '2026-10-10 05:10-04');
-- e7 the weights: five 10s at 2 AM and five 0s at midnight (2 hours old at
-- 2 AM, so each weighs the 0.25 floor). All ten are in the window.
select pg_temp.seed('23232323-0000-4000-8000-0000000000e7', 1, 5, 3, 3, 3, '2026-10-10 02:00-04');
select pg_temp.seed('23232323-0000-4000-8000-0000000000e7', 6, 10, 1, 1, 1, '2026-10-10 00:00-04');

-- Publish each fixed-clock event at the moment of its newest rating.
select private.publish_event_vibe('23232323-0000-4000-8000-0000000000e1', '2026-10-10 02:00-04');
select private.publish_event_vibe('23232323-0000-4000-8000-0000000000e2', '2026-10-10 01:00-04');
select private.publish_event_vibe('23232323-0000-4000-8000-0000000000e3', '2026-10-10 02:00-04');
select private.publish_event_vibe('23232323-0000-4000-8000-0000000000e4', '2026-10-10 02:00-04');
select private.publish_event_vibe('23232323-0000-4000-8000-0000000000e5', '2026-10-10 05:10-04');
select private.publish_event_vibe('23232323-0000-4000-8000-0000000000e6', '2026-10-10 05:10-04');
select private.publish_event_vibe('23232323-0000-4000-8000-0000000000e7', '2026-10-10 02:00-04');

-- ---- 1. Locked down (2) -----------------------------------------------------
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'])
           from pg_proc where oid in (
             'private.night_end(timestamptz)'::regprocedure,
             'private.vibe_live_set(uuid, timestamptz)'::regprocedure,
             'private.vibe_score_at(uuid, timestamptz)'::regprocedure,
             'private.vibe_word(numeric, text, text, text)'::regprocedure,
             'private.vibe_breakdown(numeric, numeric, numeric)'::regprocedure,
             'private.publish_event_vibe(uuid, timestamptz)'::regprocedure,
             'private.published_vibe(uuid, timestamptz)'::regprocedure)),
  'every new or replaced helper is security definer with an empty search_path');
select ok(not exists (
            select 1
            from unnest(array[
              'private.night_end(timestamptz)',
              'private.vibe_live_set(uuid, timestamptz)',
              'private.vibe_score_at(uuid, timestamptz)',
              'private.vibe_word(numeric, text, text, text)',
              'private.vibe_breakdown(numeric, numeric, numeric)',
              'private.publish_event_vibe(uuid, timestamptz)',
              'private.published_vibe(uuid, timestamptz)']) f(sig)
            cross join unnest(array['anon', 'authenticated']) r(role)
            where has_function_privilege(r.role, f.sig, 'execute'))
          and not has_function_privilege('anon', 'public.get_event_vibe(uuid)', 'execute'),
  'the app (anon or signed in) can call none of the helpers; anon can''t read the vibe');

-- ---- 2. The helpers (6) -----------------------------------------------------
select is(private.night_end('2026-10-09 22:00-04'), '2026-10-10 05:00-04'::timestamptz,
  'night_end: an event at 10 PM Friday ends its night 5 AM Saturday');
select is(private.night_end('2026-10-10 03:00-04'), '2026-10-10 05:00-04'::timestamptz,
  'night_end: 3 AM Saturday still belongs to Friday''s night');
select is(private.night_end('2026-10-10 05:00-04'), '2026-10-11 05:00-04'::timestamptz,
  'night_end: 5 AM exactly starts a new night');
select is(array[private.vibe_word(1.66, 'l', 'm', 't'), private.vibe_word(5.0 / 3, 'l', 'm', 't')],
  array['l', 'm'], 'vibe_word: 1.66 is low; 1, 2, 2 (1.6667) counts as 1.67, the middle');
select is(array[private.vibe_word(7.0 / 3, 'l', 'm', 't'), private.vibe_word(2.34, 'l', 'm', 't')],
  array['m', 't'], 'vibe_word: 2, 2, 3 (2.3333) is the middle; 2.34 is the top');
select is(private.vibe_breakdown(1, 2, null), null, 'vibe_breakdown: a missing average gives no tiles');

-- ---- 3. Tiles (6) -----------------------------------------------------------
select is(private.published_vibe('23232323-0000-4000-8000-0000000000e1', '2026-10-10 02:05-04')
            - 'here' - 'reactions',
  jsonb_build_object('state', 'early', 'raters', 4, 'score', null, 'label', null,
    'night_average', null, 'minutes_since_last', 5, 'breakdown', null, 'night', null),
  'early (4 ratings): no tiles and no night view at all');
select is(private.published_vibe('23232323-0000-4000-8000-0000000000e2', '2026-10-10 01:10-04') -> 'breakdown',
  '{"crowd": "packed", "music": "meh", "energy": "good"}'::jsonb,
  'five identical ratings: their words show (it''s agreement, not one person)');
select is(private.published_vibe('23232323-0000-4000-8000-0000000000e7', '2026-10-10 02:05-04') -> 'breakdown',
  '{"crowd": "packed", "music": "fire", "energy": "fire"}'::jsonb,
  'tiles use the score''s weights: fresh 3s outweigh 2-hour-old 1s (2.6, not the plain 2.0)');
select is(private.published_vibe('23232323-0000-4000-8000-0000000000e7', '2026-10-10 02:05-04') -> 'night' -> 'breakdown',
  '{"crowd": "good", "music": "good", "energy": "good"}'::jsonb,
  'the night''s tiles are the plain averages (2.0 each: the middle word)');
-- Words only: every tile value in every answer is one of the nine words.
select ok(not exists (
            select 1
            from (values ('23232323-0000-4000-8000-0000000000e2'::uuid), ('23232323-0000-4000-8000-0000000000e3'::uuid),
                         ('23232323-0000-4000-8000-0000000000e4'::uuid), ('23232323-0000-4000-8000-0000000000e7'::uuid)) e(id)
            cross join lateral (select private.published_vibe(e.id, '2026-10-10 02:05-04') as v) p
            cross join lateral (
              -- A JSON null (tiles withheld) counts as no tiles.
              select b.value from jsonb_each(coalesce(nullif(p.v -> 'breakdown', 'null'::jsonb), '{}'::jsonb)) b
              union all
              select b.value from jsonb_each(coalesce(nullif(p.v -> 'night' -> 'breakdown', 'null'::jsonb), '{}'::jsonb)) b) w
            where w.value not in ('"quiet"', '"good"', '"packed"', '"meh"', '"fire"', '"low"')),
  'tiles are words only: never a number');
select ok(private.published_vibe('23232323-0000-4000-8000-0000000000e7', '2026-10-10 02:05-04')::text
            !~ '(crowd_average|music_average|energy_average|2\.6|23232323-9999)',
  'no row average, and no user id, ever leaves the database');

-- ---- 4. All night (9) -------------------------------------------------------
select is(private.published_vibe('23232323-0000-4000-8000-0000000000e2', '2026-10-10 01:10-04') -> 'night',
  '{"label": "Good", "raters": 5, "over": false,
    "breakdown": {"crowd": "packed", "music": "meh", "energy": "good"}}'::jsonb,
  'the score uses every rating of the night: All night shows its word and tiles (no number)');
select is(private.published_vibe('23232323-0000-4000-8000-0000000000e3', '2026-10-10 02:05-04') -> 'night',
  '{"label": null, "raters": 6, "over": false, "breakdown": null}'::jsonb,
  'privacy: 1 night rating left out of the score: no night word and no night tiles (they''d give it away)');
select is(private.published_vibe('23232323-0000-4000-8000-0000000000e3', '2026-10-10 02:05-04') -> 'breakdown',
  '{"crowd": "packed", "music": "fire", "energy": "fire"}'::jsonb,
  '... while the live tiles (the score''s own 5 ratings) still show');
select is((select night_average is null and night_crowd_average is null
                  and night_music_average is null and night_energy_average is null
           from private.vibe_snapshots where event_id = '23232323-0000-4000-8000-0000000000e3'), true,
  'privacy: the withheld night values aren''t even stored');
select is(private.published_vibe('23232323-0000-4000-8000-0000000000e4', '2026-10-10 02:05-04') -> 'night',
  '{"label": "Good", "raters": 10, "over": false,
    "breakdown": {"crowd": "good", "music": "good", "energy": "good"}}'::jsonb,
  '5 left out of the score: All night is shown (any difference is an average of 5+)');
select is(private.published_vibe('23232323-0000-4000-8000-0000000000e5', '2026-10-10 05:15-04') -> 'night',
  '{"label": null, "raters": 5, "over": true, "breakdown": null}'::jsonb,
  'privacy: 1 rating after 5 AM is in the score but not the night: withheld; and the night is over');
select is(private.published_vibe('23232323-0000-4000-8000-0000000000e6', '2026-10-10 05:15-04') -> 'night',
  '{"label": "Fire", "raters": 5, "over": true,
    "breakdown": {"crowd": "packed", "music": "fire", "energy": "fire"}}'::jsonb,
  '5 after 5 AM: the night (before 5 AM only) is shown, and over');
select is(private.published_vibe('23232323-0000-4000-8000-0000000000e4', '2026-10-10 04:00-04') -> 'night_average',
  'null'::jsonb, 'older app builds: night_average is null even when stale (no night number, cto)');
-- cto must-fix: the night payload never carries a number apart from its
-- count. Checked on every fixed-clock event, shown or withheld.
select ok(not exists (
            select 1
            from (values ('23232323-0000-4000-8000-0000000000e2'::uuid), ('23232323-0000-4000-8000-0000000000e3'::uuid),
                         ('23232323-0000-4000-8000-0000000000e4'::uuid), ('23232323-0000-4000-8000-0000000000e5'::uuid),
                         ('23232323-0000-4000-8000-0000000000e6'::uuid), ('23232323-0000-4000-8000-0000000000e7'::uuid)) e(id)
            cross join lateral (select private.published_vibe(e.id, '2026-10-10 05:15-04') -> 'night' as n) p
            cross join lateral jsonb_each(p.n) kv
            where kv.key = 'score' or (kv.key <> 'raters' and jsonb_typeof(kv.value) = 'number')),
  'privacy: the night payload has no score key and no number except its count');
select ok(private.published_vibe('23232323-0000-4000-8000-0000000000e4', '2026-10-10 02:05-04')::text !~ '5\.0',
  'the night''s 5.0 appears nowhere in the answer (the live score there is 10.0)');
select is(private.published_vibe('23232323-0000-4000-8000-0000000000e2', '2026-10-10 04:59-04') -> 'night' -> 'over',
  'false'::jsonb, 'at 4:59 AM the night isn''t over yet');

-- ---- 5. The gate, through submit_rating (7) ---------------------------------
-- e8: guests 1-5 rated (2, 2, 2) 10 minutes ago and that was published.
-- Guests 6-8 are checked in now and rate through the real function.
select pg_temp.seed('23232323-0000-4000-8000-0000000000e8', 1, 5, 2, 2, 2, now() - interval '10 minutes');
select private.publish_event_vibe('23232323-0000-4000-8000-0000000000e8', now() - interval '10 minutes');
insert into public.check_ins (user_id, event_id, method, first_at, last_verified_at)
select ('23232323-9999-4999-8999-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '23232323-0000-4000-8000-0000000000e8', 'gps', now(), now()
from generate_series(6, 8) n;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"23232323-9999-4999-8999-000000000006","role":"authenticated"}', true);
create temp table before_6 on commit drop as
  select public.get_event_vibe('23232323-0000-4000-8000-0000000000e8') as v;
select is((select v -> 'breakdown' from before_6),
  '{"crowd": "good", "music": "good", "energy": "good"}'::jsonb,
  'gate: the published tiles before guest 6');
select is(public.submit_rating('23232323-0000-4000-8000-0000000000e8', 3, 3, 3) ->> 'status', 'saved',
  'gate: guest 6 rates top in every row');
select is(public.get_event_vibe('23232323-0000-4000-8000-0000000000e8'), (select v from before_6),
  'privacy: ONE new rating changes nothing: score, tiles and All night identical');

select set_config('request.jwt.claims',
  '{"sub":"23232323-9999-4999-8999-000000000007","role":"authenticated"}', true);
select public.submit_rating('23232323-0000-4000-8000-0000000000e8', 3, 3, 3);
select is(public.get_event_vibe('23232323-0000-4000-8000-0000000000e8'), (select v from before_6),
  'privacy: two new ratings still change nothing');

select set_config('request.jwt.claims',
  '{"sub":"23232323-9999-4999-8999-000000000008","role":"authenticated"}', true);
select public.submit_rating('23232323-0000-4000-8000-0000000000e8', 3, 3, 3);
select is(public.get_event_vibe('23232323-0000-4000-8000-0000000000e8') -> 'breakdown',
  '{"crowd": "packed", "music": "fire", "energy": "fire"}'::jsonb,
  'the third new rater publishes: weighted (five 2s 10 min old weigh 0.79, three fresh 3s weigh 1) = 2.43, the top word');
select is((public.get_event_vibe('23232323-0000-4000-8000-0000000000e8') -> 'night' ->> 'raters')::int, 8,
  'the third new rater publishes: All night now counts 8');
select is(public.get_event_vibe('23232323-0000-4000-8000-0000000000e8') -> 'night' ->> 'label', 'Good',
  'All night''s word comes from the plain average of the 8 ((5 x 5.0 + 3 x 10.0) / 8 = 6.9: Good)');

select * from finish();
rollback;
