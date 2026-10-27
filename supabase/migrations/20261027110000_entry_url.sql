-- =============================================================================
-- Migration 13: the "How to get in" link for host events (proposal VC-40,
-- founder approval 2026-10-27; legal prep in
-- team/projects/vibecheck/legal/vc40-host-links-2026-10-27.md).
--
-- Plain-language background:
-- * A house party's guests still need the host's own RSVP or invite page
--   (Partiful, Posh, Luma...), because VibeCheck never shows an address.
--   Admins can now add one optional https link to a HOST event. The event
--   page shows it as a plain "How to get in" button.
-- * New column public.events.entry_url: the link, or empty (null). It is a
--   public fact like ticket_url, so the existing "signed-in adults may read
--   events" grant and policy already cover it. It says nothing about where
--   exactly the party is (the host's page decides what it shows).
-- * Allowed sites, https only, the site itself or any of its subdomains:
--     partiful.com, posh.vip, lu.ma, luma.com, eventbrite.com, dice.fm,
--     instagram.com.
--   NOT ra.co: its terms allow links only for non-commercial use (legal
--   prep). Not l.instagram.com either: it is Instagram's redirect service,
--   which could forward guests anywhere (the legal prep says no redirects).
-- * The same strict shape as the ticket link: no "user@" part before the
--   site (the @ trick hides the real site), no port, only plain letters,
--   digits, dots and dashes in the site name (so look-alike letters from
--   other alphabets are refused), every part of the name well formed, and
--   no "xn--" parts (punycode, how look-alike names are spelled in plain
--   letters).
-- * Staff picks keep using the ticket link (VC-29). The entry link is for
--   host events only, so a staff pick with an entry link is refused.
-- * create_event and update_event gain one optional input, p_entry_url, at
--   the end. Postgres treats a different list of inputs as a DIFFERENT
--   function, so the old versions are dropped first; otherwise both would
--   exist and calls would be ambiguous. Calls that don't pass p_entry_url
--   work exactly as before. Everything else in the two functions is copied
--   unchanged from migration 12 (20261027100200_event_state.sql); the only
--   additions are the p_entry_url input and the v_entry_url lines.
--
-- New error code (the app shows its message):
--   VCENT  the entry link isn't allowed, or the event is a staff pick
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: is this "How to get in" link allowed?
-- The list of allowed sites lives ONLY here. The app has a copy of the same
-- rule (src/lib/event-form.ts, isAllowedEntryUrl) just to show a friendly
-- message early; this one is the rule that counts.
-- -----------------------------------------------------------------------------
create function private.is_allowed_entry_url(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  /*
    What it does: checks a host's "How to get in" link is safe to show.
    Input: p_url, the link as typed.
    Returns: true when the link
      - is at most 500 characters,
      - starts with https:// and then a site name made only of letters,
        digits, dots and dashes, optionally followed by a path starting
        with / (so "https://partiful.com@evil.example", ports like ":8080"
        and "?" right after the name are all refused),
      - has a well-formed site name: parts separated by single dots, each
        starting and ending with a letter or digit, ending in a letters-only
        part (no "..", no leading or trailing dot or dash),
      - has no part starting with "xn--" (punycode look-alikes),
      - is not l.instagram.com (a redirect service),
      - is on an allowed site: one of the names below, or a subdomain of one
        (www.partiful.com yes; notpartiful.com no, it must be ".partiful.com").
    Returns null for a null link (the caller treats "no link" as fine).
    Why: a button in our app is a promise that it goes where it says.
    Adding a site is a proposal, then one entry in the list below.
  */
  select char_length(p_url) <= 500
     and p_url ~ '^https://[A-Za-z0-9.-]+(/[^[:space:]]*)?$'
     and h.host ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]+$'
     and h.host !~ '(^|\.)xn--'
     and h.host <> 'l.instagram.com'
     and exists (
       select 1
       from unnest(array['partiful.com', 'posh.vip', 'lu.ma', 'luma.com',
                         'eventbrite.com', 'dice.fm', 'instagram.com']) as allowed(site)
       -- Exactly the site, or something ending in ".site" (a subdomain).
       where h.host = allowed.site or right(h.host, char_length(allowed.site) + 1) = '.' || allowed.site
     )
  -- `substring(... from pattern)` returns the part in brackets: the site name.
  from (select lower(substring(p_url from '^https://([A-Za-z0-9.-]+)')) as host) as h;
$$;

comment on function private.is_allowed_entry_url(text) is
  'VC-40: true when a "How to get in" link is https, well formed and on partiful.com, posh.vip, lu.ma, luma.com, eventbrite.com, dice.fm or instagram.com (or a subdomain). Not ra.co.';

-- -----------------------------------------------------------------------------
-- The new column, with rules: an allowed link or nothing, and host events only.
-- -----------------------------------------------------------------------------
alter table public.events
  add column entry_url text
    constraint events_entry_url_allowed
      check (entry_url is null or private.is_allowed_entry_url(entry_url))
    constraint events_entry_url_host_only
      check (entry_url is null or source = 'host');

comment on column public.events.entry_url is
  'VC-40: optional "How to get in" link (host''s RSVP/invite page), host events only. Public, like ticket_url.';

-- -----------------------------------------------------------------------------
-- Helper: check the entry link, raising a clear error.
-- -----------------------------------------------------------------------------
create function private.check_event_entry_url(p_entry_url text, p_source text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
/*
  What it does: checks the event's "How to get in" link before saving.
  Inputs: p_entry_url, the final link (null = none, which is allowed), and
  p_source, the final source ('host' or 'staff_pick').
  Returns: nothing, or raises VCENT with a message the app can show.
  Why: the table rules would also refuse these, but with a vague "check
  constraint" error.
*/
begin
  if p_entry_url is null then
    return;
  end if;
  if not private.is_allowed_entry_url(p_entry_url) then
    raise exception 'Use an https:// link on Partiful, Posh, Luma, Eventbrite, DICE or Instagram.'
      using errcode = 'VCENT';
  end if;
  if p_source is distinct from 'host' then
    raise exception 'The "How to get in" link is for host events. Staff picks use the ticket link.'
      using errcode = 'VCENT';
  end if;
end;
$$;

comment on function private.check_event_entry_url(text, text) is
  'VC-40: raises VCENT unless the entry link is null, or allowed and on a host event.';

-- -----------------------------------------------------------------------------
-- Replace create_event and update_event with versions that take p_entry_url.
-- -----------------------------------------------------------------------------
drop function public.create_event(text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, text, text, text, boolean, text);
drop function public.update_event(uuid, text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, boolean, text, text, text, boolean, text);

create function public.create_event(
  p_title text,
  p_area_label text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 150,
  p_code_check_in_enabled boolean default false,
  p_is_test boolean default false,
  p_ticket_url text default null,
  p_source text default 'host',
  p_summary text default null,
  p_is_21_plus boolean default false,
  p_state text default null,
  p_entry_url text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: creates an event (the public row) and its secret details
  (map pin, radius, a fresh party code) in one go.
  Inputs:
    p_title, p_area_label      - public name and neighbourhood label
    p_starts_at, p_ends_at     - times (end after start, at most 24 hours)
    p_lat, p_lng               - where the party is, from the admin's phone GPS
    p_radius_m                 - check-in radius in metres (default 150)
    p_code_check_in_enabled    - turn on the party-code fallback
    p_is_test                  - a test event (only testers see it)
    p_ticket_url               - optional https ticket link (VC-29)
    p_source                   - 'host' (default) or 'staff_pick'
    p_summary                  - optional own-words summary, 15 words max
    p_is_21_plus               - 21 and over (VC-10)
    p_state                    - (VC-37) 'DC', 'MD' or 'VA'; optional
                                 (null or empty = not set)
    p_entry_url                - (VC-40) optional "How to get in" link, host
                                 events only (null or empty = none)
  Returns: {"event_id": "...", "check_in_code": "K7MX2Q"}. The code is
  returned so the admin can print it on a card; only admins ever see it.
  Why `security definer`: app users can't write events or event_private.
  This function runs with the owner's rights, but only after checking the
  caller is an admin.
*/
declare
  v_event_id uuid;
  v_code text := private.new_check_in_code();
  -- Empty text means "no value" for the optional fields.
  v_ticket_url text := nullif(btrim(p_ticket_url), '');
  v_summary text := nullif(btrim(p_summary), '');
  v_source text := coalesce(nullif(btrim(p_source), ''), 'host');
  v_state text := nullif(btrim(p_state), '');
  v_entry_url text := nullif(btrim(p_entry_url), '');
begin
  -- 1. Admins only. Not signed in, no profile, or role 'user': refused.
  if not private.is_admin() then
    raise exception 'Only admins can create events.' using errcode = '42501';
  end if;

  -- 2. Check every field (each failure says what to fix).
  perform private.check_event_fields(
    p_title, p_area_label, p_starts_at, p_ends_at, v_ticket_url, v_source, v_summary);
  perform private.check_event_location(p_lat, p_lng, p_radius_m);
  perform private.check_event_state(v_state);
  perform private.check_event_entry_url(v_entry_url, v_source);
  -- A brand-new event that is already over is almost always an AM/PM slip.
  if p_ends_at <= now() then
    raise exception 'That end time has already passed. Check the date and AM/PM.' using errcode = 'VCTIM';
  end if;

  -- 3. Save the public row. created_by records which admin made it.
  insert into public.events (
    title, area_label, starts_at, ends_at, code_check_in_enabled, is_test,
    created_by, ticket_url, source, summary, is_21_plus, state, entry_url
  ) values (
    btrim(p_title), btrim(p_area_label), p_starts_at, p_ends_at,
    coalesce(p_code_check_in_enabled, false), coalesce(p_is_test, false),
    auth.uid(), v_ticket_url, v_source, v_summary, coalesce(p_is_21_plus, false), v_state,
    v_entry_url
  )
  returning id into v_event_id;

  -- 4. Save the secret details. A code is made even when the code fallback
  --    is off, so turning it on later needs no extra step.
  insert into public.event_private (event_id, lat, lng, radius_m, check_in_code)
  values (v_event_id, p_lat, p_lng, p_radius_m, v_code);

  return jsonb_build_object('event_id', v_event_id, 'check_in_code', v_code);
end;
$$;

create function public.update_event(
  p_event_id uuid,
  p_title text default null,
  p_area_label text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_m integer default null,
  p_code_check_in_enabled boolean default null,
  p_rotate_code boolean default false,
  p_is_test boolean default null,
  p_ticket_url text default null,
  p_source text default null,
  p_summary text default null,
  p_is_21_plus boolean default null,
  p_state text default null,
  p_entry_url text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: changes any of an event's details, and can replace the party
  code with a new one ("code rotate", e.g. if a photo of the card leaked).
  Inputs: p_event_id (required), then the same fields as create_event, each
  optional (null = keep). Also:
    p_rotate_code - true makes a brand-new party code.
    p_lat, p_lng  - give both to move the pin, or neither.
    p_state       - (VC-37) 'DC', 'MD' or 'VA'; null keeps it, '' removes it.
    p_entry_url   - (VC-40) "How to get in" link; null keeps it, '' removes it.
  Returns: {"event_id": "...", "check_in_code": "..."} with the current code
  (the new one if it was rotated).
  Why null means "keep": the app can send just what changed, for example
  only p_rotate_code => true, without knowing the secret pin.
*/
declare
  v_event public.events%rowtype;
  v_private public.event_private%rowtype;
  v_ticket_url text;
  v_summary text;
  v_source text;
  v_state text;
  v_entry_url text;
begin
  -- 1. Admins only.
  if not private.is_admin() then
    raise exception 'Only admins can edit events.' using errcode = '42501';
  end if;

  -- 2. Load the event and lock it ("for update"), so two admins saving at
  --    once can't overwrite each other halfway.
  select * into v_event from public.events e where e.id = p_event_id for update;
  if not found then
    raise exception 'That event doesn''t exist.' using errcode = 'VCNFD';
  end if;
  select * into v_private from public.event_private ep where ep.event_id = p_event_id for update;

  -- 3. Work out the final values: the new one if given, otherwise the old.
  --    For the ticket link, summary, state and entry link, '' means
  --    "remove", so it becomes null.
  v_ticket_url := case when p_ticket_url is null then v_event.ticket_url
                       else nullif(btrim(p_ticket_url), '') end;
  v_summary := case when p_summary is null then v_event.summary
                    else nullif(btrim(p_summary), '') end;
  v_source := coalesce(nullif(btrim(p_source), ''), v_event.source);
  v_state := case when p_state is null then v_event.state
                  else nullif(btrim(p_state), '') end;
  v_entry_url := case when p_entry_url is null then v_event.entry_url
                      else nullif(btrim(p_entry_url), '') end;

  -- The pin moves only when BOTH coordinates are given (half a pin is a bug).
  if (p_lat is null) <> (p_lng is null) then
    raise exception 'Send both latitude and longitude to move the location.' using errcode = 'VCLOC';
  end if;

  -- 4. Changing the test flag after people checked in would mix test and
  --    real scores (the tester override only works on test events, VC-B07).
  if p_is_test is not null and p_is_test <> v_event.is_test
     and exists (select 1 from public.check_ins c where c.event_id = p_event_id) then
    raise exception 'People have checked in, so the test flag can''t change.' using errcode = 'VCTST';
  end if;

  -- 5. Check the final values with the same rules as create_event.
  perform private.check_event_fields(
    coalesce(p_title, v_event.title),
    coalesce(p_area_label, v_event.area_label),
    coalesce(p_starts_at, v_event.starts_at),
    coalesce(p_ends_at, v_event.ends_at),
    v_ticket_url, v_source, v_summary);
  perform private.check_event_location(
    coalesce(p_lat, v_private.lat),
    coalesce(p_lng, v_private.lng),
    coalesce(p_radius_m, v_private.radius_m));
  perform private.check_event_state(v_state);
  -- Checked against the FINAL source, so turning a host event with a link
  -- into a staff pick needs the link removed in the same save.
  perform private.check_event_entry_url(v_entry_url, v_source);

  -- 6. Save.
  update public.events e set
    title = btrim(coalesce(p_title, v_event.title)),
    area_label = btrim(coalesce(p_area_label, v_event.area_label)),
    starts_at = coalesce(p_starts_at, v_event.starts_at),
    ends_at = coalesce(p_ends_at, v_event.ends_at),
    code_check_in_enabled = coalesce(p_code_check_in_enabled, v_event.code_check_in_enabled),
    is_test = coalesce(p_is_test, v_event.is_test),
    ticket_url = v_ticket_url,
    source = v_source,
    summary = v_summary,
    is_21_plus = coalesce(p_is_21_plus, v_event.is_21_plus),
    state = v_state,
    entry_url = v_entry_url
  where e.id = p_event_id;

  update public.event_private ep set
    lat = coalesce(p_lat, v_private.lat),
    lng = coalesce(p_lng, v_private.lng),
    radius_m = coalesce(p_radius_m, v_private.radius_m),
    check_in_code = case when coalesce(p_rotate_code, false)
                         then private.new_check_in_code()
                         else v_private.check_in_code end
  where ep.event_id = p_event_id
  returning ep.check_in_code into v_private.check_in_code;

  return jsonb_build_object('event_id', p_event_id, 'check_in_code', v_private.check_in_code);
end;
$$;

comment on function public.create_event(text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, text, text, text, boolean, text, text) is
  'VC-B04 + VC-37 + VC-40: admins only. Creates an event (optional state, optional host entry link) and its private pin/radius/code. Returns {event_id, check_in_code}.';
comment on function public.update_event(uuid, text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, boolean, text, text, text, boolean, text, text) is
  'VC-B04 + VC-37 + VC-40: admins only. Changes an event (null = keep, '''' = clear link/summary/state/entry link) and can rotate the party code. Returns {event_id, check_in_code}.';

-- Who may run what: the same as before. New functions start runnable by
-- everyone (PUBLIC), so take that away, then let signed-in users call them
-- (the admin check inside decides). anon can't. The helpers: nobody.
revoke execute on function public.create_event(text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, text, text, text, boolean, text, text) from public, anon;
revoke execute on function public.update_event(uuid, text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, boolean, text, text, text, boolean, text, text) from public, anon;
grant execute on function public.create_event(text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, text, text, text, boolean, text, text) to authenticated;
grant execute on function public.update_event(uuid, text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, boolean, text, text, text, boolean, text, text) to authenticated;
revoke execute on function private.is_allowed_entry_url(text) from public, anon, authenticated;
revoke execute on function private.check_event_entry_url(text, text) from public, anon, authenticated;
