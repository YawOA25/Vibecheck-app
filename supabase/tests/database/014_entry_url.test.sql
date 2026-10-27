-- =============================================================================
-- pgTAP test 14: the "How to get in" link for host events (proposal VC-40).
--
-- What it checks, in plain words:
--   * The link checker accepts https links on the seven allowed sites and
--     their subdomains, and refuses: http, ra.co, look-alike and lookalike-
--     suffix names (notpartiful.com, partiful.com.evil.example), the "@"
--     trick, ports, punycode ("xn--") names, letters from other alphabets,
--     malformed names (double dots, trailing dot), Instagram's redirect
--     service, spaces, and links over 500 characters.
--   * The new column may be empty, and the table rules refuse a bad link or
--     a link on a staff pick, even from the owner.
--   * Only one create_event and one update_event exist (the old versions
--     were dropped), both still security definer with an empty search_path,
--     callable by signed-in users and not anon; the helpers by nobody.
--   * create_event saves the link (trimmed), saves nothing when it's left
--     out, and refuses a bad link or a staff pick with a link (VCENT).
--   * update_event changes, keeps ('' removes) the link, refuses a bad one,
--     and refuses turning a host event with a link into a staff pick unless
--     the link is removed in the same save.
--   * A normal user can't create or edit (the link changes nothing about
--     who may), and signed-in adults can read the link like ticket_url.
-- Everything runs inside BEGIN ... ROLLBACK, so nothing is left behind.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(48);

-- ---- Setup (as owner) -------------------------------------------------------
insert into auth.users (id, email) values
  ('eeeeeeee-1414-4999-8999-0000000000f1', 'entry-admin@test.vibecheck.invalid'),
  ('eeeeeeee-1414-4999-8999-0000000000f2', 'entry-user@test.vibecheck.invalid');
insert into public.profiles (id, display_name, birthdate, is_tester, role) values
  ('eeeeeeee-1414-4999-8999-0000000000f1', 'Admin', current_date - interval '30 years', false, 'admin'),
  ('eeeeeeee-1414-4999-8999-0000000000f2', 'User', current_date - interval '30 years', false, 'user');

-- ---- 1. The link checker: allowed links (9) ---------------------------------
select ok(private.is_allowed_entry_url('https://partiful.com/e/abc123'), 'partiful.com is allowed');
select ok(private.is_allowed_entry_url('https://www.partiful.com/e/abc123'), 'a partiful.com subdomain is allowed');
select ok(private.is_allowed_entry_url('https://posh.vip/e/rooftop'), 'posh.vip is allowed');
select ok(private.is_allowed_entry_url('https://lu.ma/abc'), 'lu.ma is allowed');
select ok(private.is_allowed_entry_url('https://luma.com/abc'), 'luma.com is allowed');
select ok(private.is_allowed_entry_url('https://www.eventbrite.com/e/1'), 'eventbrite.com is allowed');
select ok(private.is_allowed_entry_url('https://dice.fm/event/xyz'), 'dice.fm is allowed');
select ok(private.is_allowed_entry_url('https://www.instagram.com/somehost/'), 'instagram.com is allowed');
select ok(private.is_allowed_entry_url('https://Partiful.COM'), 'upper-case site names are fine, and no path is fine');

-- ---- 2. The link checker: refused links (17) --------------------------------
select ok(not private.is_allowed_entry_url('http://partiful.com/e/1'), 'plain http is refused');
select ok(not private.is_allowed_entry_url('https://ra.co/events/1'), 'ra.co is refused (legal prep)');
select ok(not private.is_allowed_entry_url('https://notpartiful.com/e/1'), 'a name that only ends in the site is refused');
select ok(not private.is_allowed_entry_url('https://partiful.com.evil.example/e/1'), 'the site as a prefix of another name is refused');
select ok(not private.is_allowed_entry_url('https://partiful.com@evil.example/e/1'), 'the user@ trick is refused');
select ok(not private.is_allowed_entry_url('https://user:pw@partiful.com/e/1'), 'a user:password part is refused');
select ok(not private.is_allowed_entry_url('https://partiful.com:8443/e/1'), 'a port is refused');
select ok(not private.is_allowed_entry_url('https://xn--prtiful-cvb.com/e/1'), 'a punycode name is refused');
select ok(not private.is_allowed_entry_url('https://xn--80ak6aa92e.partiful.com/'), 'a punycode part even on an allowed site is refused');
select ok(not private.is_allowed_entry_url('https://pаrtiful.com/e/1'), 'a Cyrillic look-alike letter is refused');
select ok(not private.is_allowed_entry_url('https://a..partiful.com/e/1'), 'a double dot is refused');
select ok(not private.is_allowed_entry_url('https://partiful.com./e/1'), 'a trailing dot is refused');
select ok(not private.is_allowed_entry_url('https://-x.partiful.com/'), 'a part starting with a dash is refused');
select ok(not private.is_allowed_entry_url('https://l.instagram.com/?u=https://evil.example'), 'Instagram''s redirect service is refused');
select ok(not private.is_allowed_entry_url('https://partiful.com/e/a b'), 'a space in the path is refused');
select ok(not private.is_allowed_entry_url('https://partiful.com?x=1'), 'a ? right after the name is refused');
select ok(not private.is_allowed_entry_url('https://partiful.com/' || repeat('a', 480)), 'a link over 500 characters is refused');

-- ---- 3. The column and its rules (3) ----------------------------------------
select col_is_null('public', 'events', 'entry_url', 'events.entry_url may be empty');
select throws_ok(
  $$ insert into public.events (title, area_label, starts_at, ends_at, entry_url)
     values ('Bad link', 'Shaw, DC', now() + interval '1 hour', now() + interval '3 hours', 'https://ra.co/x') $$,
  '23514', null, 'the table rule refuses a link that isn''t allowed, even from the owner');
select throws_ok(
  $$ insert into public.events (title, area_label, starts_at, ends_at, source, entry_url)
     values ('Pick', 'Shaw, DC', now() + interval '1 hour', now() + interval '3 hours', 'staff_pick',
             'https://partiful.com/e/1') $$,
  '23514', null, 'the table rule refuses an entry link on a staff pick');

-- ---- 4. One version of each function, still locked down (4) ----------------
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('create_event', 'update_event')),
  2, 'exactly one create_event and one update_event exist (old versions dropped)');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'])
           from pg_proc where proname in ('create_event', 'update_event')
             and pronamespace = 'public'::regnamespace),
  'both are still security definer with an empty search_path');
select ok(
  not has_function_privilege('anon',
    'public.create_event(text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, text, text, text, boolean, text, text)', 'execute')
  and not has_function_privilege('anon',
    'public.update_event(uuid, text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, boolean, text, text, text, boolean, text, text)', 'execute')
  and has_function_privilege('authenticated',
    'public.create_event(text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, text, text, text, boolean, text, text)', 'execute')
  and has_function_privilege('authenticated',
    'public.update_event(uuid, text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, boolean, text, text, text, boolean, text, text)', 'execute'),
  'anon can''t call them; signed-in users can (the admin check inside decides)');
select ok(
  not has_function_privilege('authenticated', 'private.is_allowed_entry_url(text)', 'execute')
  and not has_function_privilege('authenticated', 'private.check_event_entry_url(text, text)', 'execute'),
  'app users can''t call the helpers directly');

-- ---- 5. create_event and the link (5) ---------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-1414-4999-8999-0000000000f1","role":"authenticated"}', true);
select set_config('vc.entry_event', public.create_event(
  'House party', 'Shaw, DC', now() + interval '1 hour', now() + interval '4 hours',
  38.91, -77.02, p_entry_url => '  https://partiful.com/e/abc  ') ->> 'event_id', true);
select is((select entry_url from public.events where id = current_setting('vc.entry_event')::uuid),
  'https://partiful.com/e/abc', 'create_event saves the link, without the spaces at the ends');
select set_config('vc.no_entry_event', public.create_event(
  'No link', 'Shaw, DC', now() + interval '1 hour', now() + interval '4 hours',
  38.91, -77.02) ->> 'event_id', true);
select is((select entry_url from public.events where id = current_setting('vc.no_entry_event')::uuid),
  null, 'leaving p_entry_url out saves no link (older apps keep working)');
select throws_ok(
  $$ select public.create_event('Bad', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '4 hours', 38.91, -77.02, p_entry_url => 'https://ra.co/events/1') $$,
  'VCENT', null, 'create_event refuses a link that isn''t allowed');
select throws_ok(
  $$ select public.create_event('Pick', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '4 hours', 38.91, -77.02, p_source => 'staff_pick',
       p_entry_url => 'https://partiful.com/e/1') $$,
  'VCENT', null, 'create_event refuses an entry link on a staff pick');
select lives_ok(
  $$ select public.create_event('Empty', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '4 hours', 38.91, -77.02, p_source => 'staff_pick', p_entry_url => '') $$,
  'an empty link means none, even on a staff pick');

-- ---- 6. update_event and the link (7) ---------------------------------------
select lives_ok(
  $$ select public.update_event(current_setting('vc.entry_event')::uuid,
       p_entry_url => 'https://lu.ma/new') $$,
  'update_event can change the link');
select lives_ok(
  $$ select public.update_event(current_setting('vc.entry_event')::uuid, p_title => 'Renamed') $$,
  'an edit without p_entry_url works');
select is((select entry_url from public.events where id = current_setting('vc.entry_event')::uuid),
  'https://lu.ma/new', 'leaving p_entry_url out keeps the link');
select throws_ok(
  $$ select public.update_event(current_setting('vc.entry_event')::uuid,
       p_entry_url => 'https://evil.example/x') $$,
  'VCENT', null, 'update_event refuses a link that isn''t allowed');
select throws_ok(
  $$ select public.update_event(current_setting('vc.entry_event')::uuid, p_source => 'staff_pick') $$,
  'VCENT', null, 'turning a host event with a link into a staff pick is refused');
select lives_ok(
  $$ select public.update_event(current_setting('vc.entry_event')::uuid,
       p_source => 'staff_pick', p_entry_url => '') $$,
  'it works when the link is removed in the same save');
select is((select entry_url from public.events where id = current_setting('vc.entry_event')::uuid),
  null, 'an empty p_entry_url removes the link');

-- ---- 7. Who may write and read it (3) --------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-1414-4999-8999-0000000000f2","role":"authenticated"}', true);
select throws_ok(
  $$ select public.create_event('Sneaky', 'Shaw, DC', now() + interval '1 hour',
       now() + interval '4 hours', 38.91, -77.02, p_entry_url => 'https://partiful.com/e/1') $$,
  '42501', null, 'a normal user can''t create an event with a link');
select throws_ok(
  $$ select public.update_event(current_setting('vc.no_entry_event')::uuid,
       p_entry_url => 'https://partiful.com/e/1') $$,
  '42501', null, 'a normal user can''t add a link to an event');
reset role;
select ok(has_column_privilege('authenticated', 'public.events', 'entry_url', 'select'),
  'signed-in users may read the link, like ticket_url');

select * from finish();
rollback;
