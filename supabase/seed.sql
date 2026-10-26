-- =============================================================================
-- Seed data for the DEV project only: fake DMV events so the app has something
-- to show while we build. Task: VC-B02.
--
-- * Every event here is `is_test = true`, so only tester accounts see it and it
--   can never mix with real party scores.
-- * The map pins are rough neighbourhood centres (public places), not homes.
-- * Times are worked out from the moment the seed runs ("tonight" relative to
--   then). Run the seed again later to get fresh times.
-- * Fixed ids plus "on conflict do nothing" make it safe to run more than once.
-- * No people are seeded: profiles need real logins, which tests create
--   themselves inside a transaction that is rolled back.
-- =============================================================================

insert into public.events
  (id, title, area_label, starts_at, ends_at, code_check_in_enabled, is_test)
values
  -- Happening right now, so check-in and rating screens have a live event.
  ('00000000-0000-4000-8000-000000000001', 'Test: rooftop kickback', 'Adams Morgan, DC',
   now() - interval '1 hour', now() + interval '3 hours', true, true),
  -- Starts later tonight.
  ('00000000-0000-4000-8000-000000000002', 'Test: house party', 'Shaw, DC',
   now() + interval '3 hours', now() + interval '7 hours', false, true),
  -- Tomorrow night, for the "tomorrow" part of the Tonight list.
  ('00000000-0000-4000-8000-000000000003', 'Test: birthday bash', 'Silver Spring, MD',
   now() + interval '1 day', now() + interval '1 day 5 hours', true, true),
  -- Finished last night, for the next-morning recap screen.
  ('00000000-0000-4000-8000-000000000004', 'Test: game night', 'Clarendon, VA',
   now() - interval '14 hours', now() - interval '10 hours', false, true)
on conflict (id) do nothing;

-- The secret details for each test event. Codes are made-up test values.
insert into public.event_private (event_id, lat, lng, radius_m, check_in_code)
values
  ('00000000-0000-4000-8000-000000000001', 38.9215, -77.0422, 150, 'TEST01'),
  ('00000000-0000-4000-8000-000000000002', 38.9124, -77.0222, 150, 'TEST02'),
  ('00000000-0000-4000-8000-000000000003', 38.9940, -77.0261, 200, 'TEST03'),
  ('00000000-0000-4000-8000-000000000004', 38.8868, -77.0954, 150, 'TEST04')
on conflict (event_id) do nothing;
