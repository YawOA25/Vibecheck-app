-- =============================================================================
-- Migration 2 of 4: `events` (what the app lists) and `event_private`
-- (where the party actually is). Task: VC-B02.
--
-- Why two tables: a house party's exact location must never reach the app.
-- `events` holds only what guests may see (a title, a neighbourhood label and
-- times). `event_private` holds the map pin, the check-in radius and the party
-- code. App users can't read `event_private` at all; only server functions
-- (check_in, create_event, written in later tasks) use it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table: events
-- -----------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  -- Short public name, e.g. "Saturday rooftop".
  title text not null
    check (char_length(btrim(title)) between 1 and 80),
  -- Neighbourhood only, e.g. "Adams Morgan, DC". NEVER a house address.
  area_label text not null
    check (char_length(btrim(area_label)) between 1 and 60),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- When true, guests whose GPS fails indoors may check in with the party code.
  code_check_in_enabled boolean not null default false,
  -- Test events are hidden from normal users and are the only events where the
  -- tester check-in works, so testing can never touch a real party's score.
  is_test boolean not null default false,
  -- The admin who created it. Kept as null if that admin's account is deleted,
  -- so the event (and its scores) survive. Null for seed events.
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- An event must end after it starts.
  constraint events_ends_after_start check (ends_at > starts_at)
);

comment on table public.events is
  'Parties and events guests can see: title, area label (never an address) and times. Read by signed-up adults; written only by admin server functions.';
comment on column public.events.title is 'Public event name, 1-80 characters.';
comment on column public.events.area_label is 'Neighbourhood label such as "Adams Morgan, DC". Never a house address.';
comment on column public.events.starts_at is 'Start time. Check-in and rating open 30 minutes before this.';
comment on column public.events.ends_at is 'End time. Check-in and rating close 60 minutes after this.';
comment on column public.events.code_check_in_enabled is 'Whether the party-code check-in fallback is turned on.';
comment on column public.events.is_test is 'Test event: only testers see it, and only here does the tester check-in work.';
comment on column public.events.created_by is 'Admin who created the event (null for seed data or deleted admins).';
comment on column public.events.created_at is 'When the event row was created.';

-- The Tonight list asks for events by start time, so index that column.
create index events_starts_at_idx on public.events (starts_at);

-- Grants: signed-in users may only read. Creating and editing events goes
-- through admin-only server functions (task VC-B04), never direct writes.
-- `anon` (not signed in) gets nothing: the app requires sign-in.
revoke all on table public.events from anon, authenticated;
grant select on table public.events to authenticated;

alter table public.events enable row level security;

-- Policy: signed-up adults see real events; testers also see test events.
-- People who signed in by email but never finished the 18+ step have no
-- profile, so `is_adult_user()` is false and they see nothing.
create policy "Adults read events; testers also read test events"
  on public.events
  for select
  to authenticated
  using (
    (select private.is_adult_user())
    and (not is_test or (select private.is_tester()))
  );

-- -----------------------------------------------------------------------------
-- Table: event_private
-- One row per event with the secret details. RLS is ON with NO policies, and
-- all grants are revoked, so no app user can read or write it (VC-20 privacy).
-- -----------------------------------------------------------------------------
create table public.event_private (
  -- Same id as the event. Deleting the event deletes this row too.
  event_id uuid primary key references public.events (id) on delete cascade,
  -- The map pin (latitude and longitude in degrees).
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  -- How close (in metres) a guest's GPS must be to count as "here".
  -- 150 m by default; limits stop a typo making a whole city "here".
  radius_m integer not null default 150 check (radius_m between 25 and 1000),
  -- The 6-character party code shown on a card at the party (capital letters
  -- and digits). Only used when events.code_check_in_enabled is true.
  check_in_code text not null check (check_in_code ~ '^[A-Z0-9]{6}$')
);

comment on table public.event_private is
  'Secret event details (map pin, radius, party code). No RLS policies: no app user can read it. Only server functions use it.';
comment on column public.event_private.event_id is 'The event these details belong to.';
comment on column public.event_private.lat is 'Latitude of the event pin, in degrees.';
comment on column public.event_private.lng is 'Longitude of the event pin, in degrees.';
comment on column public.event_private.radius_m is 'GPS check-in radius in metres (default 150).';
comment on column public.event_private.check_in_code is '6-character party code (A-Z, 0-9) for the indoor fallback.';

-- No grants at all for app roles, and RLS on with deliberately no policies.
revoke all on table public.event_private from anon, authenticated;
alter table public.event_private enable row level security;
