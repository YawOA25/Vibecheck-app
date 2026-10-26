-- =============================================================================
-- Migration 3 of 4: `check_ins` (who is at which event) and
-- `check_in_attempts` (every try, pass or fail). Task: VC-B02.
--
-- Both tables are written only by the `check_in` server function (VC-B06).
-- The app can read a user's own check-ins (to show "You're here"), and can't
-- read attempts at all. No GPS coordinates are stored anywhere (VC-20): only
-- pass/fail, the time and a rough accuracy bucket.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table: check_ins
-- -----------------------------------------------------------------------------
create table public.check_ins (
  -- Deleting a profile (account deletion) deletes that person's check-ins.
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  -- How the person proved they were there:
  --   'gps'    = their phone's location was within the radius,
  --   'code'   = they typed the party code (indoor fallback),
  --   'tester' = tester override, allowed only on test events.
  method text not null check (method in ('gps', 'code', 'tester')),
  -- The first successful check-in at this event.
  first_at timestamptz not null default now(),
  -- The latest successful check (the app re-checks before a rating; a rating
  -- needs this to be within the last 45 minutes).
  last_verified_at timestamptz not null default now(),
  -- One check-in row per person per event. Re-checking updates the row.
  primary key (user_id, event_id)
);

comment on table public.check_ins is
  'One row per person per event they checked in to. Users read their own rows; written only by the check_in server function.';
comment on column public.check_ins.user_id is 'Who checked in.';
comment on column public.check_ins.event_id is 'Which event.';
comment on column public.check_ins.method is '''gps'', ''code'' (party code) or ''tester'' (test events only).';
comment on column public.check_ins.first_at is 'Time of the first successful check-in.';
comment on column public.check_ins.last_verified_at is 'Time of the latest successful location or code check.';

-- Look-ups by event (e.g. counting guests) use this index; look-ups by user
-- already use the primary key, which starts with user_id.
create index check_ins_event_id_idx on public.check_ins (event_id);

-- Grants: read only. All writes go through the check_in function.
revoke all on table public.check_ins from anon, authenticated;
grant select on table public.check_ins to authenticated;

alter table public.check_ins enable row level security;

-- Policy: a signed-in user can read only their own check-ins.
create policy "Users read their own check-ins"
  on public.check_ins
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Table: check_in_attempts
-- Every check-in try, so the server can apply limits (20 tries an hour, 5 wrong
-- codes an hour) and the team can learn how often GPS fails indoors.
-- RLS on, NO policies, no grants: app users can't read or write it.
-- -----------------------------------------------------------------------------
create table public.check_in_attempts (
  -- A simple counter id; nothing outside the database refers to it.
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  -- What happened:
  --   'passed'         = check-in succeeded,
  --   'too_far'        = GPS said they were outside the radius,
  --   'weak_signal'    = GPS accuracy worse than 300 m, so we offered the code,
  --   'bad_code'       = wrong party code,
  --   'outside_window' = too early or too late for this event.
  result text not null
    check (result in ('passed', 'too_far', 'weak_signal', 'bad_code', 'outside_window')),
  -- A rough GPS accuracy band instead of exact numbers or coordinates.
  -- Null for code and tester attempts, which have no GPS reading.
  accuracy_bucket text
    check (accuracy_bucket in ('0-25m', '25-75m', '75-300m', '300m+')),
  at timestamptz not null default now()
);

comment on table public.check_in_attempts is
  'Every check-in try (result, accuracy band, time). No coordinates. No RLS policies: not readable by app users. Used for rate limits and GPS-failure stats.';
comment on column public.check_in_attempts.id is 'Row number.';
comment on column public.check_in_attempts.user_id is 'Who tried.';
comment on column public.check_in_attempts.event_id is 'Which event.';
comment on column public.check_in_attempts.result is 'passed, too_far, weak_signal, bad_code or outside_window.';
comment on column public.check_in_attempts.accuracy_bucket is 'GPS accuracy band (0-25m, 25-75m, 75-300m, 300m+); null when no GPS was used.';
comment on column public.check_in_attempts.at is 'When the attempt happened.';

-- The rate limits ask "how many tries did this person make in the last hour
-- (for this event)?", so index by user, event and time.
create index check_in_attempts_user_event_at_idx
  on public.check_in_attempts (user_id, event_id, at);
create index check_in_attempts_user_at_idx
  on public.check_in_attempts (user_id, at);

revoke all on table public.check_in_attempts from anon, authenticated;
alter table public.check_in_attempts enable row level security;
