-- =============================================================================
-- Migration 12: each event's state, DC, Maryland or Virginia (proposal VC-37,
-- founder's clarification 2026-10-27).
--
-- Plain-language background:
-- * The admin event form now asks for the state first (DC / Maryland /
--   Virginia), then searches neighbourhoods in that state. The state is
--   saved next to the area label so the app can group or filter by it later.
-- * New column public.events.state: 'DC', 'MD' or 'VA', or empty (null) for
--   events made before this change. It's a public fact like the area label,
--   and the existing "signed-in adults may read events" grant and policy
--   already cover it. It says nothing about where exactly the party is.
-- * create_event and update_event gain one optional input, p_state, at the
--   end. Postgres treats a function with a different list of inputs as a
--   DIFFERENT function, so the old versions are dropped first; otherwise
--   both would exist and calls would be ambiguous. Calls that don't pass
--   p_state work exactly as before.
-- * The area label itself is NOT tied to the state on the server: "Other"
--   areas are free text, and the list of neighbourhoods lives in the app
--   (src/data/dmv-areas.ts).
--
-- New error code (the app shows its message):
--   VCSTA  state is not DC, MD or VA
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The new column, with a rule that only allows the three codes (or nothing).
-- -----------------------------------------------------------------------------
alter table public.events
  add column state text
    constraint events_state_known check (state is null or state in ('DC', 'MD', 'VA'));

comment on column public.events.state is
  'VC-37: ''DC'', ''MD'' or ''VA'' (null for older events). Public, like the area label.';

-- -----------------------------------------------------------------------------
-- Helper: check a state code, raising a clear error.
-- -----------------------------------------------------------------------------
create function private.check_event_state(p_state text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
/*
  What it does: checks the event's state code before saving.
  Input: p_state, the final value (null = not set, which is allowed).
  Returns: nothing, or raises VCSTA with a message the app can show.
  Why: the table rule would also refuse a bad code, but with a vague
  "check constraint" error.
*/
begin
  if p_state is not null and p_state not in ('DC', 'MD', 'VA') then
    raise exception 'Pick DC, Maryland or Virginia.' using errcode = 'VCSTA';
  end if;
end;
$$;

comment on function private.check_event_state(text) is
  'VC-37: raises VCSTA unless the state is null, DC, MD or VA.';

-- -----------------------------------------------------------------------------
-- Replace create_event and update_event with versions that take p_state.
-- Everything else in them is unchanged from migration 7
-- (20261026180000_admin_events.sql); the only additions are the p_state
-- input and the v_state lines that check and save it.
-- -----------------------------------------------------------------------------
drop function public.create_event(text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, text, text, text, boolean);
drop function public.update_event(uuid, text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, boolean, text, text, text, boolean);

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
  p_state text default null
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
  -- A brand-new event that is already over is almost always an AM/PM slip.
  if p_ends_at <= now() then
    raise exception 'That end time has already passed. Check the date and AM/PM.' using errcode = 'VCTIM';
  end if;

  -- 3. Save the public row. created_by records which admin made it.
  insert into public.events (
    title, area_label, starts_at, ends_at, code_check_in_enabled, is_test,
    created_by, ticket_url, source, summary, is_21_plus, state
  ) values (
    btrim(p_title), btrim(p_area_label), p_starts_at, p_ends_at,
    coalesce(p_code_check_in_enabled, false), coalesce(p_is_test, false),
    auth.uid(), v_ticket_url, v_source, v_summary, coalesce(p_is_21_plus, false), v_state
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
  p_state text default null
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
  v_state := case when p_state is null then v_event.state
                  else nullif(btrim(p_state), '') end;

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
    state = v_state
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

comment on function public.create_event(text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, text, text, text, boolean, text) is
  'VC-B04 + VC-37: admins only. Creates an event (with optional state DC/MD/VA) and its private pin/radius/code. Returns {event_id, check_in_code}.';
comment on function public.update_event(uuid, text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, boolean, text, text, text, boolean, text) is
  'VC-B04 + VC-37: admins only. Changes an event (null = keep, '''' = clear link/summary/state) and can rotate the party code. Returns {event_id, check_in_code}.';

-- Who may run what: the same as before. New functions start runnable by
-- everyone (PUBLIC), so take that away, then let signed-in users call them
-- (the admin check inside decides). anon can't. The helper: nobody.
revoke execute on function public.create_event(text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, text, text, text, boolean, text) from public, anon;
revoke execute on function public.update_event(uuid, text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, boolean, text, text, text, boolean, text) from public, anon;
grant execute on function public.create_event(text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, text, text, text, boolean, text) to authenticated;
grant execute on function public.update_event(uuid, text, text, timestamptz, timestamptz, double precision, double precision, integer, boolean, boolean, boolean, text, text, text, boolean, text) to authenticated;
revoke execute on function private.check_event_state(text) from public, anon, authenticated;
