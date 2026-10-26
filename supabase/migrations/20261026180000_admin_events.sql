-- =============================================================================
-- Migration 7: admins create and edit events (task VC-B04), plus the VC-29
-- "staff pick" fields.
--
-- Plain-language background:
-- * App users can only READ events (VC-B02). Nobody can write the tables
--   directly. This migration adds the two doors admins use:
--     public.create_event(...)  makes a new event and its secret details
--     public.update_event(...)  changes an event, and can make a new party code
--   Both are `security definer` (they run with the table owner's rights) and
--   start by checking "is the caller an admin?". Everyone else gets error
--   42501, even with a hand-made request that skips the app.
-- * Where the party is (map pin, radius, party code) goes ONLY into
--   public.event_private, which no app user can read. The public `events`
--   row holds a neighbourhood label, never an address or coordinates.
-- * VC-29 (approved 2026-10-26) lets the team list real venue events as
--   "staff picks" that link out to the ticket page. The legal check
--   (team/projects/vibecheck/legal/eventbrite-terms-2026-10-26.md) says: copy
--   only facts, write our own short summary, no flyer images, no logos. So the
--   new columns are: a ticket link (https, allowed sites only), a source label,
--   our own summary of 15 words or fewer, and a 21+ flag (VC-10).
--
-- Error codes the app reads from `error.code` (each comes with a plain
-- English message):
--   42501  not signed in, or not an admin
--   VCTTL  title empty or longer than 80 characters
--   VCARE  area label empty, too long, or looks like a street address
--   VCTIM  times missing, end not after start, longer than 24 hours, too far
--          ahead, or (new events only) already over
--   VCLOC  map pin missing or impossible, or radius outside 25-1000 m
--   VCURL  ticket link not https or not on an allowed ticket site
--   VCSUM  summary longer than 15 words or 120 characters
--   VCSRC  source is not 'host' or 'staff_pick'
--   VCNFD  no event with that id
--   VCTST  the test flag can't change once people have checked in
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: is the caller an admin?
-- -----------------------------------------------------------------------------
create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  /*
    What it does: answers "is the person making this request an admin?"
    Inputs: none; it uses auth.uid(), the id of the signed-in caller.
    Returns: true only when the caller has a profile with role = 'admin'.
    Why: only admins may create or edit events. Users can't change their own
    role (column grants plus a trigger, VC-B02), so the founder is made an
    admin once by hand with SQL (see the README).
  */
  select coalesce(
    (select p.role = 'admin' from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

comment on function private.is_admin() is
  'True when the caller''s profile has role = ''admin''. Used by create_event and update_event.';

-- -----------------------------------------------------------------------------
-- Helper: is this ticket link allowed? (VC-29)
-- The list of allowed sites lives ONLY here. The app has a copy of the same
-- rule (src/lib/event-form.ts) just to show a friendly message early; this
-- one is the rule that counts.
-- -----------------------------------------------------------------------------
create function private.is_allowed_ticket_url(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  /*
    What it does: checks a ticket link is safe to show as a button.
    Input: p_url, the link as typed.
    Returns: true when the link
      - starts with https:// (no plain http, no javascript: tricks),
      - is at most 500 characters,
      - has a web address made only of letters, digits, dots and dashes
        (so "https://eventbrite.com@evil.example" is refused: the @ trick
        hides the real site), optionally followed by a path starting with /,
      - is on an allowed ticket site: eventbrite.com or any of its
        subdomains (www.eventbrite.com).
    Returns null for a null link (the caller treats "no link" as fine).
    Why: a link in our app is a promise that it goes where it says. Adding a
    new site (Posh, DICE...) is a proposal, then one line here.
    `substring(... from pattern)` returns the part in brackets: the host.
  */
  select char_length(p_url) <= 500
     and p_url ~ '^https://[A-Za-z0-9.-]+(/[^[:space:]]*)?$'
     and (
       lower(substring(p_url from '^https://([A-Za-z0-9.-]+)')) = 'eventbrite.com'
       or lower(substring(p_url from '^https://([A-Za-z0-9.-]+)')) like '%.eventbrite.com'
     );
$$;

comment on function private.is_allowed_ticket_url(text) is
  'VC-29: true when a ticket link is https and on an allowed site (eventbrite.com and subdomains).';

-- -----------------------------------------------------------------------------
-- Helper: count the words in our own summary.
-- -----------------------------------------------------------------------------
create function private.word_count(p_text text)
returns integer
language sql
immutable
set search_path = ''
as $$
  /*
    What it does: counts the words in a piece of text.
    Input: p_text.
    Returns: the number of words (pieces separated by spaces); 0 for empty
    or null text.
    Why: VC-29's legal condition is a SHORT summary in our own words. 15
    words is the limit the founder set, and a database rule makes it stick.
    `regexp_split_to_array` cuts the text at each run of spaces.
  */
  select case
    when p_text is null or btrim(p_text) = '' then 0
    else cardinality(regexp_split_to_array(btrim(p_text), '\s+'))
  end;
$$;

comment on function private.word_count(text) is
  'Number of space-separated words in a text (0 for empty). Used for the 15-word summary limit.';

-- -----------------------------------------------------------------------------
-- Helper: does an area label look like a street address?
-- -----------------------------------------------------------------------------
create function private.looks_like_street_address(p_label text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  /*
    What it does: a simple guard that catches the most common slip, typing
    a house address ("1420 U St NW") where the neighbourhood belongs.
    Input: p_label, the area label.
    Returns: true when the label starts with a number followed by a space
    (a house number). "14th Street corridor" is fine: "14th" isn't a bare
    number.
    Why: the area label is shown to every guest. A house party's address
    must never be public (VC-20). This can't catch every address, so the
    screen also says "Neighbourhood only, never an address".
  */
  select coalesce(p_label ~ '^\s*[0-9]+\s', false);
$$;

comment on function private.looks_like_street_address(text) is
  'True when an area label starts with a house number (e.g. "1420 U St"). A guard, not a guarantee.';

-- -----------------------------------------------------------------------------
-- New columns on events (VC-29 staff picks and VC-10 21+ flag).
-- All are public facts guests may see, so the existing "select" grant covers
-- them. Nothing about the exact location is added here.
-- -----------------------------------------------------------------------------
alter table public.events
  -- Optional link to the event's ticket page, for staff picks.
  add column ticket_url text
    constraint events_ticket_url_allowed
    check (ticket_url is null or private.is_allowed_ticket_url(ticket_url)),
  -- Who put the event in the app: 'host' (a party the team runs or was told
  -- about) or 'staff_pick' (a venue event the team picked; shown with a
  -- "Staff pick" label, VC-14).
  add column source text not null default 'host'
    constraint events_source_known check (source in ('host', 'staff_pick')),
  -- Our own one-line summary. Never pasted from the organiser (legal, VC-29).
  add column summary text
    constraint events_summary_short
    check (
      summary is null
      or (char_length(btrim(summary)) between 1 and 120 and private.word_count(summary) <= 15)
    ),
  -- True when the event is 21 and over (VC-10), so the app can say so.
  add column is_21_plus boolean not null default false;

comment on column public.events.ticket_url is 'VC-29: optional https ticket link on an allowed site (eventbrite.com). Facts only, no images.';
comment on column public.events.source is '''host'' or ''staff_pick'' (venue event picked by the team, shown labelled).';
comment on column public.events.summary is 'VC-29: our own summary, 15 words or fewer. Never copied from the organiser.';
comment on column public.events.is_21_plus is 'VC-10: true when the event is 21 and over.';

-- -----------------------------------------------------------------------------
-- Helper: make a new party code.
-- -----------------------------------------------------------------------------
create function private.new_check_in_code()
returns text
language sql
volatile
set search_path = ''
as $$
  /*
    What it does: makes a random 6-character party code, like "K7MX2Q".
    Inputs: none.
    Returns: 6 characters from a 32-letter alphabet.
    Why this alphabet: capital letters and digits (what event_private
    allows), minus the look-alikes O/0 and I/1, so guests reading a printed
    card don't mix them up. 32 letters also divides 256 evenly, so taking
    each random byte "mod 32" gives every letter the same chance.
    `extensions.gen_random_bytes` is pgcrypto's secure random generator
    (spelled out in full because search_path is empty). `get_byte` reads one
    byte (0-255) and `substr` picks the matching letter (1-based).
  */
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b.bytes, i) % 32) + 1, 1),
    ''
    order by i
  )
  from (select extensions.gen_random_bytes(6) as bytes) as b,
       generate_series(0, 5) as i;
$$;

comment on function private.new_check_in_code() is
  'A random 6-character party code (A-Z and 2-9, no O/0/I/1). Used by create_event and update_event.';

-- -----------------------------------------------------------------------------
-- Helper: check every public event field, raising a clear error.
-- Shared by create_event and update_event so the rules can't drift apart.
-- -----------------------------------------------------------------------------
create function private.check_event_fields(
  p_title text,
  p_area_label text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_ticket_url text,
  p_source text,
  p_summary text
)
returns void
language plpgsql
stable
set search_path = ''
as $$
/*
  What it does: checks the public details of an event before saving.
  Inputs: the final values (after "keep the old value" is worked out).
  Returns: nothing when all is well; otherwise raises one of the error codes
  listed at the top of this file, with a message the app can show.
  Why: the table's own rules would also refuse bad values, but with a vague
  "check constraint" error. These messages say exactly what to fix.
*/
begin
  if p_title is null or char_length(btrim(p_title)) not between 1 and 80 then
    raise exception 'Give the event a name of 1 to 80 characters.' using errcode = 'VCTTL';
  end if;

  if p_area_label is null or char_length(btrim(p_area_label)) not between 1 and 60 then
    raise exception 'Add an area of 1 to 60 characters, like "Shaw, DC".' using errcode = 'VCARE';
  end if;
  if private.looks_like_street_address(p_area_label) then
    raise exception 'Use the neighbourhood, not a street address.' using errcode = 'VCARE';
  end if;

  if p_starts_at is null or p_ends_at is null then
    raise exception 'Add a start and an end time.' using errcode = 'VCTIM';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'The end must be after the start.' using errcode = 'VCTIM';
  end if;
  -- A party longer than a day is almost certainly a typo in the end date.
  if p_ends_at - p_starts_at > interval '24 hours' then
    raise exception 'An event can last 24 hours at most. Check the end date.' using errcode = 'VCTIM';
  end if;
  -- More than a year ahead is almost certainly a typo in the year.
  if p_starts_at > now() + interval '1 year' then
    raise exception 'The start is more than a year away. Check the year.' using errcode = 'VCTIM';
  end if;

  if p_ticket_url is not null and not private.is_allowed_ticket_url(p_ticket_url) then
    raise exception 'Ticket links must start with https:// and be on eventbrite.com.' using errcode = 'VCURL';
  end if;

  if p_source is null or p_source not in ('host', 'staff_pick') then
    raise exception 'Source must be host or staff_pick.' using errcode = 'VCSRC';
  end if;

  if p_summary is not null
     and (char_length(btrim(p_summary)) > 120 or private.word_count(p_summary) > 15) then
    raise exception 'Keep the summary to 15 words or fewer, in our own words.' using errcode = 'VCSUM';
  end if;
end;
$$;

comment on function private.check_event_fields(text, text, timestamptz, timestamptz, text, text, text) is
  'Validates public event fields for create_event/update_event and raises VCTTL/VCARE/VCTIM/VCURL/VCSRC/VCSUM.';

-- -----------------------------------------------------------------------------
-- Helper: check the secret location fields.
-- -----------------------------------------------------------------------------
create function private.check_event_location(p_lat double precision, p_lng double precision, p_radius_m integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
/*
  What it does: checks the map pin and the check-in radius.
  Inputs: latitude and longitude in degrees, radius in metres.
  Returns: nothing, or raises VCLOC with a message.
  Why: a missing or impossible pin would make check-in fail for everyone at
  the party, and a huge radius would make a whole city count as "here".
*/
begin
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Add the location with "Use my current location".' using errcode = 'VCLOC';
  end if;
  if p_radius_m is null or p_radius_m not between 25 and 1000 then
    raise exception 'The check-in radius must be 25 to 1000 metres.' using errcode = 'VCLOC';
  end if;
end;
$$;

comment on function private.check_event_location(double precision, double precision, integer) is
  'Validates an event''s map pin and radius for create_event/update_event and raises VCLOC.';

-- -----------------------------------------------------------------------------
-- create_event: admins make a new event.
-- -----------------------------------------------------------------------------
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
  p_is_21_plus boolean default false
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
begin
  -- 1. Admins only. Not signed in, no profile, or role 'user': refused.
  if not private.is_admin() then
    raise exception 'Only admins can create events.' using errcode = '42501';
  end if;

  -- 2. Check every field (each failure says what to fix).
  perform private.check_event_fields(
    p_title, p_area_label, p_starts_at, p_ends_at, v_ticket_url, v_source, v_summary);
  perform private.check_event_location(p_lat, p_lng, p_radius_m);
  -- A brand-new event that is already over is almost always an AM/PM slip.
  if p_ends_at <= now() then
    raise exception 'That end time has already passed. Check the date and AM/PM.' using errcode = 'VCTIM';
  end if;

  -- 3. Save the public row. created_by records which admin made it.
  insert into public.events (
    title, area_label, starts_at, ends_at, code_check_in_enabled, is_test,
    created_by, ticket_url, source, summary, is_21_plus
  ) values (
    btrim(p_title), btrim(p_area_label), p_starts_at, p_ends_at,
    coalesce(p_code_check_in_enabled, false), coalesce(p_is_test, false),
    auth.uid(), v_ticket_url, v_source, v_summary, coalesce(p_is_21_plus, false)
  )
  returning id into v_event_id;

  -- 4. Save the secret details. A code is made even when the code fallback
  --    is off, so turning it on later needs no extra step.
  insert into public.event_private (event_id, lat, lng, radius_m, check_in_code)
  values (v_event_id, p_lat, p_lng, p_radius_m, v_code);

  return jsonb_build_object('event_id', v_event_id, 'check_in_code', v_code);
end;
$$;

comment on function public.create_event(text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, text, text, text, boolean) is
  'VC-B04: admins only. Creates an event and its private pin/radius/code. Returns {event_id, check_in_code}.';

-- -----------------------------------------------------------------------------
-- update_event: admins change an event.
-- Every input except the id is optional: null means "keep what's there".
-- For the optional text fields (ticket link, summary), an empty string
-- means "remove it".
-- -----------------------------------------------------------------------------
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
  p_is_21_plus boolean default null
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
  --    For the ticket link and summary, '' means "remove", so it becomes null.
  v_ticket_url := case when p_ticket_url is null then v_event.ticket_url
                       else nullif(btrim(p_ticket_url), '') end;
  v_summary := case when p_summary is null then v_event.summary
                    else nullif(btrim(p_summary), '') end;
  v_source := coalesce(nullif(btrim(p_source), ''), v_event.source);

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
    is_21_plus = coalesce(p_is_21_plus, v_event.is_21_plus)
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

comment on function public.update_event(uuid, text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, boolean, text, text, text, boolean) is
  'VC-B04: admins only. Changes an event (null = keep, '''' = clear link/summary) and can rotate the party code. Returns {event_id, check_in_code}.';

-- -----------------------------------------------------------------------------
-- Who may run what. Postgres lets everyone (PUBLIC) run new functions by
-- default, so take that away first, then grant on purpose.
-- * The two public functions: signed-in users may CALL them (the admin check
--   inside decides). anon (not signed in) can't even call them.
-- * The private helpers: no app role needs to call them directly. The two
--   used inside table rules (ticket link, word count) run as the table owner
--   when the definer functions write, so no grant is needed.
-- -----------------------------------------------------------------------------
revoke execute on function public.create_event(text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, text, text, text, boolean) from public, anon;
revoke execute on function public.update_event(uuid, text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, boolean, text, text, text, boolean) from public, anon;
grant execute on function public.create_event(text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, text, text, text, boolean) to authenticated;
grant execute on function public.update_event(uuid, text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, boolean, text, text, text, boolean) to authenticated;

revoke execute on function private.is_admin() from public, anon, authenticated;
revoke execute on function private.is_allowed_ticket_url(text) from public, anon, authenticated;
revoke execute on function private.word_count(text) from public, anon, authenticated;
revoke execute on function private.looks_like_street_address(text) from public, anon, authenticated;
revoke execute on function private.new_check_in_code() from public, anon, authenticated;
revoke execute on function private.check_event_fields(text, text, timestamptz, timestamptz, text, text, text) from public, anon, authenticated;
revoke execute on function private.check_event_location(double precision, double precision, integer) from public, anon, authenticated;
