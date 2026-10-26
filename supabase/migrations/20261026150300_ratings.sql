-- =============================================================================
-- Migration 4 of 4: `ratings`. Task: VC-B02.
--
-- A rating is three taps (Crowd, Music, Energy, each 1 to 3) plus an optional
-- reaction. It is written only by the `submit_rating` server function (VC-B08),
-- which checks the person is checked in, 18+, not an admin, and not updating
-- too soon. App users may read only their own ratings; everyone else's are
-- private, and the public only sees totals from `get_event_vibe` (VC-B09).
-- =============================================================================

create table public.ratings (
  -- A simple counter id; nothing outside the database refers to it.
  id bigint generated always as identity primary key,
  -- Deleting a profile (account deletion) deletes that person's ratings.
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  -- Each row is 1 = Low, 2 = Good, 3 = Fire.
  crowd smallint not null check (crowd between 1 and 3),
  music smallint not null check (music between 1 and 3),
  energy smallint not null check (energy between 1 and 3),
  -- Optional emoji reaction, one of the six on the rating screen (or none).
  reaction text
    check (reaction in ('fire', 'dancing', 'packed', 'chill', 'too_loud', 'dead')),
  -- The rating's score from 0 to 10, worked out by the database so it can't be
  -- faked: (crowd + music + energy - 3) / 6 x 10.
  -- All Low = 0, all Good = 5, all Fire = 10. Not rounded here; the live score
  -- rounds once at the end so small differences aren't lost.
  score numeric generated always as ((crowd + music + energy - 3) * 10.0 / 6) stored,
  created_at timestamptz not null default now(),
  -- Last save time. submit_rating allows an update only 60+ minutes after this.
  updated_at timestamptz not null default now(),
  -- Set by an admin to hide an abusive rating. Hidden ratings count nowhere.
  hidden_at timestamptz,
  -- One rating per person per event (they update it instead of adding more).
  constraint ratings_one_per_user_event unique (user_id, event_id)
);

comment on table public.ratings is
  'One rating per person per event. Users read only their own rows; written only by submit_rating. Others see totals only, via get_event_vibe.';
comment on column public.ratings.user_id is 'Who rated.';
comment on column public.ratings.event_id is 'Which event.';
comment on column public.ratings.crowd is 'Crowd: 1 Low, 2 Good, 3 Fire.';
comment on column public.ratings.music is 'Music: 1 Low, 2 Good, 3 Fire.';
comment on column public.ratings.energy is 'Energy: 1 Low, 2 Good, 3 Fire.';
comment on column public.ratings.reaction is 'Optional reaction: fire, dancing, packed, chill, too_loud or dead.';
comment on column public.ratings.score is 'Computed 0-10 score: (crowd + music + energy - 3) / 6 x 10.';
comment on column public.ratings.created_at is 'When the rating was first saved.';
comment on column public.ratings.updated_at is 'When the rating was last saved (updates allowed 60+ minutes later).';
comment on column public.ratings.hidden_at is 'Set when an admin hides an abusive rating; hidden ratings are excluded everywhere.';

-- The live score reads one event's recent ratings, so index by event and time.
-- (Look-ups by user use the unique constraint's index, which starts with user_id.)
create index ratings_event_updated_idx on public.ratings (event_id, updated_at);

-- Grants: read only. All writes go through submit_rating.
revoke all on table public.ratings from anon, authenticated;
grant select on table public.ratings to authenticated;

alter table public.ratings enable row level security;

-- Policy: a signed-in user can read only their own ratings.
create policy "Users read their own ratings"
  on public.ratings
  for select
  to authenticated
  using (user_id = (select auth.uid()));
