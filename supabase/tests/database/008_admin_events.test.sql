-- =============================================================================
-- pgTAP test 8: admins create and edit events (VC-B04, VC-29 fields).
--
-- What it checks, in plain words:
--   * A normal signed-up user, someone with no profile, and a not-signed-in
--     visitor (anon) are all refused by create_event and update_event, even
--     though they call the functions directly (a "hand-made request" that
--     skips the app).
--   * An admin can create an event, gets back a party code, and can edit the
--     event, rotate the code, and clear optional fields.
--   * Bad input is refused with the right code: end before start, a street
--     address as the area, a bad ticket link (http, other site, the @ trick),
--     a summary over 15 words, a missing pin, a radius out of range.
--   * The exact location never shows on a public read: the events table has
--     no coordinate columns, and a guest can't read event_private.
--   * Changing the test flag is refused once someone has checked in.
-- Everything runs inside BEGIN ... ROLLBACK, so nothing is left behind.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(41);

-- ---- Setup (as owner) -------------------------------------------------------
insert into auth.users (id, email) values
  ('88888888-8888-4888-8888-888888888881', 'admin@test.vibecheck.invalid'),
  ('88888888-8888-4888-8888-888888888882', 'user@test.vibecheck.invalid'),
  ('88888888-8888-4888-8888-888888888883', 'noprofile@test.vibecheck.invalid');

-- The admin role is set here as the owner, the same way the founder's one-off
-- SQL in the README does it. The 'no profile' user (…883) gets no row.
insert into public.profiles (id, display_name, birthdate, role) values
  ('88888888-8888-4888-8888-888888888881', 'Admin', current_date - interval '30 years', 'admin'),
  ('88888888-8888-4888-8888-888888888882', 'User', current_date - interval '30 years', 'user');

-- An event made by the owner, for the "non-admin can't edit" checks.
insert into public.events (id, title, area_label, starts_at, ends_at) values
  ('88888888-0000-4000-8000-000000000001', 'Owner party', 'Shaw, DC',
   now() + interval '1 hour', now() + interval '5 hours');
insert into public.event_private (event_id, lat, lng, check_in_code) values
  ('88888888-0000-4000-8000-000000000001', 38.91, -77.02, 'ABCDEF');

-- ---- 1. Static checks: who may call what (4) -------------------------------
select ok(not has_function_privilege('anon',
  'public.create_event(text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, text, text, text, boolean, text, text)',
  'execute'), 'anon can''t run create_event');
select ok(not has_function_privilege('anon',
  'public.update_event(uuid, text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, boolean, text, text, text, boolean, text, text)',
  'execute'), 'anon can''t run update_event');
select ok(not has_function_privilege('authenticated', 'private.is_admin()', 'execute'),
  'app users can''t call the is_admin helper directly');
select ok(not has_function_privilege('authenticated', 'private.new_check_in_code()', 'execute'),
  'app users can''t call the code generator directly');

-- ---- 2. anon is refused even with a hand-made call (1) ---------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$ select public.create_event('Sneaky', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '3 hours', 38.9, -77.0) $$,
  '42501', null, 'anon can''t create an event');

-- ---- 3. A normal user is refused (3) ----------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888882","role":"authenticated"}', true);

select throws_ok(
  $$ select public.create_event('Sneaky', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '3 hours', 38.9, -77.0) $$,
  '42501', 'Only admins can create events.', 'A normal user can''t create an event');
select throws_ok(
  $$ select public.update_event('88888888-0000-4000-8000-000000000001', p_title => 'Hacked') $$,
  '42501', 'Only admins can edit events.', 'A normal user can''t edit an event');
select throws_ok(
  $$ select public.update_event('88888888-0000-4000-8000-000000000001', p_rotate_code => true) $$,
  '42501', null, 'A normal user can''t rotate a party code');

-- ---- 4. Signed in without a profile is refused (1) -------------------------
select set_config('request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888883","role":"authenticated"}', true);
select throws_ok(
  $$ select public.create_event('Sneaky', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '3 hours', 38.9, -77.0) $$,
  '42501', null, 'A login without a profile can''t create an event');

-- Owner check: the refused calls changed nothing.
reset role;
select is((select title from public.events where id = '88888888-0000-4000-8000-000000000001'),
  'Owner party', 'The refused edit left the event unchanged');

-- ---- 5. An admin creates an event (5) ---------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888881","role":"authenticated"}', true);

-- Store the result in a setting so later checks can find the new event.
-- (A setting is used because pgTAP test files can't declare variables.)
select set_config('vc.new_event', public.create_event(
  p_title => '  Rooftop kickback  ',
  p_area_label => 'Adams Morgan, DC',
  p_starts_at => now() + interval '2 hours',
  p_ends_at => now() + interval '6 hours',
  p_lat => 38.9215,
  p_lng => -77.0422,
  p_radius_m => 200,
  p_code_check_in_enabled => true,
  p_is_test => true,
  p_ticket_url => 'https://www.eventbrite.com/e/rooftop-kickback-123',
  p_source => 'staff_pick',
  p_summary => 'Afrobeats on the roof, sunset start.',
  p_is_21_plus => true
)::text, true);

select ok(current_setting('vc.new_event')::jsonb ? 'event_id',
  'create_event returns the new event id');
select matches(current_setting('vc.new_event')::jsonb ->> 'check_in_code',
  '^[A-HJ-NP-Z2-9]{6}$', 'create_event returns a 6-character code without O/0/I/1');
select is((select count(*)::int from jsonb_object_keys(current_setting('vc.new_event')::jsonb)),
  2, 'The reply has exactly two keys: no coordinates come back');

reset role;
select row_eq(
  $$ select title, area_label, source, ticket_url, summary, is_21_plus, is_test,
            code_check_in_enabled, created_by
     from public.events
     where id = (current_setting('vc.new_event')::jsonb ->> 'event_id')::uuid $$,
  row('Rooftop kickback'::text, 'Adams Morgan, DC'::text, 'staff_pick'::text,
      'https://www.eventbrite.com/e/rooftop-kickback-123'::text,
      'Afrobeats on the roof, sunset start.'::text, true, true, true,
      '88888888-8888-4888-8888-888888888881'::uuid),
  'The public row is saved, trimmed, with the admin as creator');
select row_eq(
  $$ select lat, lng, radius_m, check_in_code from public.event_private
     where event_id = (current_setting('vc.new_event')::jsonb ->> 'event_id')::uuid $$,
  row(38.9215::double precision, -77.0422::double precision, 200,
      current_setting('vc.new_event')::jsonb ->> 'check_in_code'),
  'The pin, radius and code are saved in event_private');

-- ---- 6. An admin edits the event (5) ----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888881","role":"authenticated"}', true);

select is(
  public.update_event((current_setting('vc.new_event')::jsonb ->> 'event_id')::uuid,
    p_title => 'Rooftop kickback (moved)', p_radius_m => 300) ->> 'check_in_code',
  current_setting('vc.new_event')::jsonb ->> 'check_in_code',
  'An edit without rotate keeps the same party code');

select set_config('vc.rotated', public.update_event(
  (current_setting('vc.new_event')::jsonb ->> 'event_id')::uuid, p_rotate_code => true) ->> 'check_in_code', true);
select isnt(current_setting('vc.rotated'),
  current_setting('vc.new_event')::jsonb ->> 'check_in_code',
  'Rotating gives a new party code');

-- '' clears the optional link and summary.
select lives_ok(
  $$ select public.update_event((current_setting('vc.new_event')::jsonb ->> 'event_id')::uuid,
       p_ticket_url => '', p_summary => '') $$,
  'An admin can clear the ticket link and summary');

reset role;
select row_eq(
  $$ select e.title, e.ticket_url, e.summary, e.area_label, p.radius_m, p.check_in_code, p.lat
     from public.events e join public.event_private p on p.event_id = e.id
     where e.id = (current_setting('vc.new_event')::jsonb ->> 'event_id')::uuid $$,
  row('Rooftop kickback (moved)'::text, null::text, null::text, 'Adams Morgan, DC'::text, 300,
      current_setting('vc.rotated'), 38.9215::double precision),
  'Edits are saved; untouched fields (area, pin) are kept');

set local role authenticated;
select throws_ok(
  $$ select public.update_event('00000000-dead-4000-8000-000000000000', p_title => 'Nope') $$,
  'VCNFD', null, 'Editing an event that doesn''t exist is refused');

-- ---- 7. Input rules (17) ----------------------------------------------------
select throws_ok(
  $$ select public.create_event('Backwards', 'Shaw, DC', now() + interval '3 hours',
       now() + interval '1 hour', 38.9, -77.0) $$,
  'VCTIM', 'The end must be after the start.', 'End before start is refused');
select throws_ok(
  $$ select public.create_event('Same time', 'Shaw, DC', now() + interval '3 hours',
       now() + interval '3 hours', 38.9, -77.0) $$,
  'VCTIM', 'The end must be after the start.', 'End equal to start is refused');
select throws_ok(
  $$ select public.create_event('Too long', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '26 hours', 38.9, -77.0) $$,
  'VCTIM', null, 'An event over 24 hours is refused');
select throws_ok(
  $$ select public.create_event('Already over', 'Shaw, DC', now() - interval '5 hours',
       now() - interval '1 hour', 38.9, -77.0) $$,
  'VCTIM', null, 'A new event that already ended is refused');
select throws_ok(
  $$ select public.create_event('Address', '1420 U St NW', now() + interval '1 hour',
       now() + interval '3 hours', 38.9, -77.0) $$,
  'VCARE', null, 'A street address as the area label is refused');
select throws_ok(
  $$ select public.create_event('', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '3 hours', 38.9, -77.0) $$,
  'VCTTL', null, 'An empty title is refused');
select throws_ok(
  $$ select public.create_event('No pin', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '3 hours', null, null) $$,
  'VCLOC', null, 'A missing location is refused');
select throws_ok(
  $$ select public.create_event('Huge radius', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '3 hours', 38.9, -77.0, p_radius_m => 5000) $$,
  'VCLOC', null, 'A radius over 1000 m is refused');
select throws_ok(
  $$ select public.create_event('Plain http', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '3 hours', 38.9, -77.0, p_ticket_url => 'http://www.eventbrite.com/e/1') $$,
  'VCURL', null, 'A ticket link without https is refused');
select throws_ok(
  $$ select public.create_event('Other site', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '3 hours', 38.9, -77.0, p_ticket_url => 'https://evil.example/e/1') $$,
  'VCURL', null, 'A ticket link on a site not on the list is refused');
select throws_ok(
  $$ select public.create_event('At trick', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '3 hours', 38.9, -77.0,
       p_ticket_url => 'https://eventbrite.com@evil.example/e/1') $$,
  'VCURL', null, 'The "eventbrite.com@other-site" trick is refused');
select throws_ok(
  $$ select public.create_event('Look-alike', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '3 hours', 38.9, -77.0,
       p_ticket_url => 'https://eventbrite.com.evil.example/e/1') $$,
  'VCURL', null, 'A look-alike site (eventbrite.com.evil.example) is refused');
-- cto review: more link tricks the allowlist must refuse.
select throws_ok(
  $$ select public.create_event('JS link', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '3 hours', 38.9, -77.0, p_ticket_url => 'javascript:alert(1)') $$,
  'VCURL', null, 'A javascript: link is refused');
select throws_ok(
  $$ select public.create_event('Suffix', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '3 hours', 38.9, -77.0, p_ticket_url => 'https://fakeeventbrite.com/e/1') $$,
  'VCURL', null, 'A name that only ends in "eventbrite.com" (fakeeventbrite.com) is refused');
select throws_ok(
  $$ select public.create_event('Punycode', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '3 hours', 38.9, -77.0, p_ticket_url => 'https://xn--eventbrte-0db.com/e/1') $$,
  'VCURL', null, 'A punycode look-alike (xn--...) is refused');
select throws_ok(
  $$ select public.create_event('Userinfo', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '3 hours', 38.9, -77.0, p_ticket_url => 'https://www.eventbrite.com:pw@evil.example/') $$,
  'VCURL', null, 'A user:password@other-site link is refused');
select throws_ok(
  $$ select public.create_event('Wordy', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '3 hours', 38.9, -77.0,
       p_summary => 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen') $$,
  'VCSUM', null, 'A summary of 16 words is refused');

-- ---- 8. The exact location never shows on public reads (3) -----------------
-- A normal adult user reads the admin's (test) event list and event_private.
reset role;
select is_empty(
  $$ select column_name::text from information_schema.columns
     where table_schema = 'public' and table_name = 'events'
       and column_name in ('lat', 'lng', 'latitude', 'longitude', 'address', 'radius_m', 'check_in_code') $$,
  'The public events table has no coordinate, address, radius or code column');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888882","role":"authenticated"}', true);
select throws_ok(
  $$ select lat, lng from public.event_private $$,
  '42501', null, 'A guest can''t read the pin from event_private');
select is_empty(
  $$ select 1 from public.events e
     where row_to_json(e)::text like '%38.9215%' or row_to_json(e)::text like '%-77.0422%' $$,
  'No event row a guest can read contains the pin''s coordinates');

-- ---- 9. Test flag is frozen once people check in (1) -----------------------
reset role;
insert into public.check_ins (user_id, event_id, method)
values ('88888888-8888-4888-8888-888888888882',
        (current_setting('vc.new_event')::jsonb ->> 'event_id')::uuid, 'gps');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888881","role":"authenticated"}', true);
select throws_ok(
  $$ select public.update_event((current_setting('vc.new_event')::jsonb ->> 'event_id')::uuid,
       p_is_test => false) $$,
  'VCTST', null, 'The test flag can''t change after a check-in');

select * from finish();
rollback;
