-- =============================================================================
-- Migration 20: publish a new live score only after 2 or more new ratings
-- (proposal VC-51, approved by the founder 2026-10-27, "4-13 approve").
-- Also finishes VC-46 (heads-up tags picked while rating refresh an old +1).
-- Follows 20261027130000 / 130100 / 120000, which are already on the dev
-- project, so this file replaces functions instead of editing those files.
--
-- The problem, in plain words: the event page asks for the score every 20
-- seconds. Before this file, the score, the rater count and the reaction
-- tally were worked out fresh on every ask. So someone polling could watch
-- for the moment ONE new rating arrived, and the jump in the score (and a
-- "fire" reaction going from 3 to 4) told them roughly what that one person
-- rated, maybe someone they had just watched tap their phone.
--
-- The design: a published snapshot per event.
--   * private.vibe_snapshots holds, for each event, the last PUBLISHED vibe:
--     the score, the rater count, the night average and the reaction tally,
--     all frozen at the moment of publishing. No user ids, no single rating.
--   * The app's functions (get_event_vibe, get_events_vibe) now read that
--     snapshot (private.published_vibe) instead of working anything out
--     fresh. Between publishes, every polled answer is the same (apart from
--     the "N here" count and "updated N min ago", which say nothing about
--     any rating), so polling learns nothing from a single new rating.
--   * submit_rating publishes a new snapshot only when 2 or more DIFFERENT
--     people have saved a visible rating since the last snapshot. Counting
--     people, not saves, matters: one guest's first rating and their update
--     an hour later must not count as 2, or the change would be that one
--     guest's alone. (Each person has one ratings row per event, so "rows
--     saved after the last snapshot" is exactly "people who saved since".)
--   * The reaction tally and the rater count are in the snapshot too: both
--     leaked a single new rating the same way (VC-51 asked for this).
--   * Publishing takes a per-event lock, so two guests saving at the same
--     moment can't both publish (or both skip) on a count that misses the
--     other. A rating whose save raced with a publish and missed it is simply
--     included in a later snapshot, mixed with 2+ others: the safe direction.
--
-- What this still does NOT stop (honest limits, see the README):
--   * 2 is a floor, not real anonymity. A guest who rates can know their own
--     rating, so if exactly one other person rated since the last snapshot,
--     the jump caused by THEIR rating tells them roughly what that one
--     other person gave. Each guest can do this at most once an hour per
--     event (the 60-minute update rule). A higher number (3, 5) would make it
--     harder at the cost of a slower meter: a founder call (proposal).
--   * The submit_rating answer "You and 4 others" still gives the live
--     rater count to the person who just rated. That is a count, not anyone's
--     rating.
--   * Hiding a rating (an admin, today by hand in SQL) only shows up at the
--     next publish. To update right away, run
--     `select private.publish_event_vibe('<event id>', now());` after hiding.
--     The admin hide screen (VC-47) should call it.
--   * The meter moves a little less often: it waits for a second rating.
--     Before the first snapshot an event shows 'none' (No vibe yet) even if
--     one person has rated.
--
-- Unchanged: the maths (20261027140000), the 5-rating floor, the states
-- (none, early, stale, live) and the JSON keys the app reads.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table: the last published vibe of each event. Private schema, RLS on, no
-- policies, no grants: the app can't read or write it directly.
-- -----------------------------------------------------------------------------
create table private.vibe_snapshots (
  -- One snapshot per event; deleting the event deletes it.
  event_id uuid primary key references public.events (id) on delete cascade,
  -- When this snapshot was published.
  published_at timestamptz not null,
  -- The newest visible rating included (null with no ratings). "Updated N
  -- min ago" and the 90-minute 'stale' rule count from here.
  scored_at timestamptz,
  -- How many people's visible ratings were included.
  raters integer not null check (raters >= 0),
  -- The score at publishing (private.event_vibe); null with fewer than 5.
  score numeric,
  -- The plain average of all included ratings (shown only when stale).
  night_average numeric,
  -- The reaction tally at publishing; [] with fewer than 5 raters.
  reactions jsonb not null default '[]'::jsonb
);

comment on table private.vibe_snapshots is
  'VC-51: the last PUBLISHED vibe per event (totals only, no user ids). Written only by private.publish_event_vibe; read by private.published_vibe.';
comment on column private.vibe_snapshots.published_at is 'When the snapshot was published.';
comment on column private.vibe_snapshots.scored_at is 'The newest visible rating included; minutes_since_last and the stale rule count from here.';
comment on column private.vibe_snapshots.raters is 'How many people''s visible ratings were included.';
comment on column private.vibe_snapshots.score is 'The score at publishing (null under 5 raters).';
comment on column private.vibe_snapshots.night_average is 'Plain average of the included ratings (shown only when stale).';
comment on column private.vibe_snapshots.reactions is 'The reaction tally at publishing ([] under 5 raters).';

revoke all on table private.vibe_snapshots from public, anon, authenticated;
alter table private.vibe_snapshots enable row level security;

-- -----------------------------------------------------------------------------
-- Helper: publish (or re-publish) one event's snapshot.
-- -----------------------------------------------------------------------------
create function private.publish_event_vibe(p_event_id uuid, p_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: freezes the event's vibe as it stands at p_at and saves it as
  the event's published snapshot (replacing the old one).
  Inputs: p_event_id (the event) and p_at (the moment; submit_rating passes
    the time of the save, tests pass a fixed one).
  Returns: nothing.
  Who calls it: submit_rating, once 2+ people have saved since the last
    snapshot; this migration (once per event, to start); and an admin after
    hiding a rating, so the hidden rating drops out right away.
  Why `security definer`: it reads every rating and writes the private
    table. It's in the private schema, so the app can't call it directly.
*/
declare
  v_vibe jsonb;
  v_last timestamptz;
  v_average numeric;
begin
  -- Everything the meter shows, worked out fresh at p_at (the same maths
  -- and the same 5-rating rules as before).
  v_vibe := private.event_vibe(p_event_id, p_at);

  -- The newest included rating and the plain night average. event_vibe
  -- sends the average only when stale, so it is worked out here to keep it
  -- ready for when the snapshot goes stale.
  select max(r.updated_at), round(avg(r.score), 1)
  into v_last, v_average
  from public.ratings r
  where r.event_id = p_event_id
    and r.hidden_at is null
    and r.updated_at <= p_at;

  insert into private.vibe_snapshots as s
    (event_id, published_at, scored_at, raters, score, night_average, reactions)
  values (
    p_event_id,
    p_at,
    v_last,
    (v_vibe ->> 'raters')::int,
    (v_vibe ->> 'score')::numeric,
    v_average,
    coalesce(v_vibe -> 'reactions', '[]'::jsonb)
  )
  on conflict (event_id) do update
    set published_at = excluded.published_at,
        scored_at = excluded.scored_at,
        raters = excluded.raters,
        score = excluded.score,
        night_average = excluded.night_average,
        reactions = excluded.reactions;
end;
$$;

comment on function private.publish_event_vibe(uuid, timestamptz) is
  'VC-51: saves the event''s vibe as it stands at p_at as its published snapshot (totals only). Called by submit_rating after 2+ new raters, and by an admin after hiding a rating.';

-- -----------------------------------------------------------------------------
-- Helper: the published vibe, as the app sees it.
-- -----------------------------------------------------------------------------
create function private.published_vibe(p_event_id uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: the vibe the app shows, from the event's last published
  snapshot.
  Inputs: p_event_id (the event) and p_now (the moment; the app functions
    always pass the real time, tests pass a fixed one).
  Returns: JSON with the same keys as before (the app is unchanged):
    state               'none'  no snapshot yet, or 0 raters in it;
                        'early' fewer than 5 raters in it (no number);
                        'stale' its newest rating is 90+ minutes old;
                        'live'  otherwise
    raters              the snapshot's rater count
    here                the "N here" count, worked out NOW (VC-55): a
                        headcount says nothing about anyone's rating
    score, label        stale and live: the snapshot's score and its word
    night_average       stale only: the snapshot's plain average
    minutes_since_last  whole minutes since the snapshot's newest rating
    reactions           stale and live: the snapshot's tally; otherwise []
  Why: between publishes every answer is the same, so polling can't reveal
  one new rating (VC-51). Never returns who rated or any single rating.
*/
declare
  c_min_raters constant integer := 5;
  c_stale_after constant interval := interval '90 minutes';
  v_snap private.vibe_snapshots%rowtype;
  v_state text;
  v_shown boolean;
begin
  select * into v_snap from private.vibe_snapshots s where s.event_id = p_event_id;

  if not found or v_snap.raters = 0 then
    v_state := 'none';
  elsif v_snap.raters < c_min_raters then
    v_state := 'early';
  elsif v_snap.scored_at <= p_now - c_stale_after then
    v_state := 'stale';
  else
    v_state := 'live';
  end if;
  -- A number (and the tally) only in the live and stale states.
  v_shown := v_state in ('live', 'stale');

  return jsonb_build_object(
    'state', v_state,
    'raters', coalesce(v_snap.raters, 0),
    'here', private.event_here(p_event_id, p_now),
    'score', case when v_shown then v_snap.score end,
    'label', private.vibe_label(case when v_shown then v_snap.score end),
    'night_average', case when v_state = 'stale' then v_snap.night_average end,
    'minutes_since_last',
      case when v_snap.scored_at is not null
           then greatest(0, floor(extract(epoch from (p_now - v_snap.scored_at)) / 60))::int end,
    'reactions', case when v_shown then v_snap.reactions else '[]'::jsonb end
  );
end;
$$;

comment on function private.published_vibe(uuid, timestamptz) is
  'VC-51: the vibe the app sees, from the last published snapshot (state, raters, here, score, label, night_average when stale, minutes_since_last, reactions). Totals only.';

-- -----------------------------------------------------------------------------
-- get_event_vibe: as in 20261027130000, but reads the published snapshot.
-- -----------------------------------------------------------------------------
create or replace function public.get_event_vibe(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: the published vibe of one event, right now.
  Input: p_event_id, the event.
  Returns: the JSON from private.published_vibe (state, raters, here, score,
    label, night_average, minutes_since_last, reactions). The app asks again
    every 20 seconds while the event page is open; the answer only changes
    when 2+ new people have rated (VC-51), the headcount changes, or time
    passes.
  Rules: any signed-up adult who can see the event (admins too).
  Raises: 42501 for non-adults, VCNFD for an event the caller can't see.
*/
begin
  if auth.uid() is null or not private.is_adult_user() then
    raise exception 'Please sign in and finish setting up your profile first.'
      using errcode = '42501';
  end if;
  if not private.can_see_event(p_event_id) then
    raise exception 'That event doesn''t exist.' using errcode = 'VCNFD';
  end if;
  return private.published_vibe(p_event_id, now());
end;
$$;

comment on function public.get_event_vibe(uuid) is
  'VC-B09 + VC-42 + VC-51: the published vibe (totals only) of one event for the event page. Adults only; VCNFD for events the caller can''t see.';

-- -----------------------------------------------------------------------------
-- get_events_vibe: as in 20261027130000, but reads the published snapshots.
-- -----------------------------------------------------------------------------
create or replace function public.get_events_vibe(p_event_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: the published vibe of several events at once, for the
  Tonight list.
  Input: p_event_ids, the events on the list (at most 100).
  Returns: a JSON list, one item per event the caller can see, each the
    private.published_vibe JSON plus "event_id". Events that don't exist or
    that the caller can't see are left out; repeated ids appear once.
  Raises: 42501 for non-adults, 22023 for more than 100 ids.
*/
begin
  if auth.uid() is null or not private.is_adult_user() then
    raise exception 'Please sign in and finish setting up your profile first.'
      using errcode = '42501';
  end if;
  if coalesce(cardinality(p_event_ids), 0) > 100 then
    raise exception 'Too many events at once.' using errcode = '22023';
  end if;

  return coalesce(
    (select jsonb_agg(private.published_vibe(ids.id, now()) || jsonb_build_object('event_id', ids.id))
     from (select distinct u.id from unnest(p_event_ids) u(id)) ids
     where ids.id is not null and private.can_see_event(ids.id)),
    '[]'::jsonb
  );
end;
$$;

comment on function public.get_events_vibe(uuid[]) is
  'VC-B09 + VC-42 + VC-51: the published vibe (totals only) of up to 100 events for the Tonight list; skips events the caller can''t see.';

-- -----------------------------------------------------------------------------
-- submit_rating: as in 20261027120000, plus the publish gate (VC-51, step 8)
-- and the refresh of a heads-up +1 older than 3 hours (VC-46, step 7).
-- -----------------------------------------------------------------------------
create or replace function public.submit_rating(
  p_event_id uuid,
  p_crowd integer,
  p_music integer,
  p_energy integer,
  p_reaction text default null,
  p_tags text[] default '{}'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: saves the caller's 3-tap rating for an event, plus any
  heads-up tags they picked, and publishes a new vibe snapshot when 2 or more
  people have rated since the last one.
  Inputs:
    p_event_id                  the event
    p_crowd, p_music, p_energy  each 1 (low), 2 (good) or 3 (top)
    p_reaction                  optional: fire, dancing, packed, chill,
                                too_loud or dead (null for none)
    p_tags                      optional heads-up tags (VC-43)
  Returns: a small JSON answer. "status" is one of:
    'saved'           saved. Also: updated (true when it replaced an older
                      rating), saved_at, next_update_at (60 minutes later),
                      score (this rating, 0 to 10) and raters (how many
                      people's visible ratings this event has now, this one
                      included unless it is hidden).
    'too_soon'        saved less than 60 minutes ago. Also: minutes_left
                      (rounded up, at least 1) and next_update_at.
    'outside_window', 'not_checked_in', 'check_in_stale'
                      see private.rating_gate.
  Why `security definer`: the app can't write ratings directly (B02 grants),
  so this is the only door, and it applies every rule first.
*/
declare
  -- How many different people must rate before a new snapshot (VC-51).
  c_publish_after constant integer := 2;
  v_uid uuid := auth.uid();
  v_event public.events%rowtype;
  v_now timestamptz := now();
  v_refusal jsonb;
  v_last_saved timestamptz;
  v_next timestamptz;
  v_score numeric;
  v_raters integer;
  v_published_at timestamptz;
  v_new_raters integer;
begin
  -- 1. Adult, not an admin, and an event they can see (raises otherwise).
  v_event := private.rating_event(p_event_id);

  -- 2. The rating must make sense. Raised (nothing to record).
  if p_crowd is null or p_music is null or p_energy is null
     or p_crowd not between 1 and 3
     or p_music not between 1 and 3
     or p_energy not between 1 and 3 then
    raise exception 'Pick one option in each row.' using errcode = 'VCRAT';
  end if;
  if p_reaction is not null
     and p_reaction not in ('fire', 'dancing', 'packed', 'chill', 'too_loud', 'dead') then
    raise exception 'That reaction isn''t one we know.' using errcode = 'VCRAT';
  end if;
  perform private.check_heads_up_tags(p_tags);

  -- 3. One save at a time per person, so two quick taps can't both pass
  --    the 60-minute rule below. Released when this call ends.
  perform pg_advisory_xact_lock(hashtext('vibecheck.rating:' || v_uid::text));

  -- 4. In the window and checked in within 45 minutes.
  v_refusal := private.rating_gate(v_uid, p_event_id, v_event.starts_at, v_event.ends_at);
  if v_refusal is not null then
    return v_refusal;
  end if;

  -- 5. One rating per event; an update only 60+ minutes after the last
  --    save (exactly 60 minutes is allowed).
  select r.updated_at into v_last_saved
  from public.ratings r
  where r.user_id = v_uid and r.event_id = p_event_id;
  if found and v_now < v_last_saved + interval '60 minutes' then
    v_next := v_last_saved + interval '60 minutes';
    return jsonb_build_object(
      'status', 'too_soon',
      'minutes_left', greatest(1, ceil(extract(epoch from (v_next - v_now)) / 60)::int),
      'next_update_at', v_next
    );
  end if;

  -- 6. Save it. On an update, created_at and hidden_at stay as they were
  --    (a hidden rating stays hidden).
  insert into public.ratings as r (user_id, event_id, crowd, music, energy, reaction, created_at, updated_at)
  values (v_uid, p_event_id, p_crowd, p_music, p_energy, p_reaction, v_now, v_now)
  on conflict (user_id, event_id) do update
    set crowd = excluded.crowd,
        music = excluded.music,
        energy = excluded.energy,
        reaction = excluded.reaction,
        updated_at = excluded.updated_at
  returning r.score into v_score;

  -- 7. The heads-up tags: one +1 each. A tag they already added is skipped,
  --    unless that +1 is more than 3 hours old and so no longer counts:
  --    then it is refreshed to now (VC-46).
  insert into public.heads_up_votes as v (user_id, event_id, tag, created_at)
  select distinct v_uid, p_event_id, t.tag, v_now
  from unnest(coalesce(p_tags, '{}')) t(tag)
  on conflict (user_id, event_id, tag) do update
    set created_at = excluded.created_at
    where v.created_at < v_now - interval '3 hours';

  -- 8. The publish gate (VC-51). One publisher at a time per event, so two
  --    guests saving together can't both miss each other. Then count the
  --    DIFFERENT people with a visible rating saved since the last snapshot
  --    (one row per person, so rows = people; this save included). 2 or
  --    more: publish a new snapshot as of now.
  perform pg_advisory_xact_lock(hashtext('vibecheck.vibe_publish:' || p_event_id::text));
  select s.published_at into v_published_at
  from private.vibe_snapshots s
  where s.event_id = p_event_id;
  select count(*)::int into v_new_raters
  from public.ratings r
  where r.event_id = p_event_id
    and r.hidden_at is null
    and r.updated_at <= v_now
    -- No snapshot yet: every visible rating is new.
    and (v_published_at is null or r.updated_at > v_published_at);
  if v_new_raters >= c_publish_after then
    perform private.publish_event_vibe(p_event_id, v_now);
  end if;

  -- 9. How many people's ratings count at this event now (hidden ones don't).
  select count(*) into v_raters
  from public.ratings r
  where r.event_id = p_event_id and r.hidden_at is null;

  return jsonb_build_object(
    'status', 'saved',
    'updated', v_last_saved is not null,
    'saved_at', v_now,
    'next_update_at', v_now + interval '60 minutes',
    'score', round(v_score, 1),
    'raters', v_raters
  );
end;
$$;

comment on function public.submit_rating(uuid, integer, integer, integer, text, text[]) is
  'VC-B08 + VC-43 + VC-46 + VC-51: saves the caller''s 3-tap rating (and heads-up tags); publishes a new vibe snapshot once 2+ people have rated since the last. Adults only, no admins, checked in within 45 minutes, inside the window, one per event, updates 60+ minutes apart.';

-- -----------------------------------------------------------------------------
-- Start: publish a snapshot for every event that already has visible
-- ratings, so their meters don't drop back to "No vibe yet" until two new
-- ratings arrive. These numbers were already visible before this file, so
-- publishing them reveals nothing new.
-- -----------------------------------------------------------------------------
do $$
declare
  v_event_id uuid;
begin
  for v_event_id in
    select distinct r.event_id from public.ratings r where r.hidden_at is null
  loop
    perform private.publish_event_vibe(v_event_id, now());
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rights: the app can call the three public functions (signed-in users
-- only; the checks inside decide the rest); nobody from the app can call the
-- private helpers.
-- -----------------------------------------------------------------------------
revoke execute on function public.get_event_vibe(uuid) from public, anon;
grant execute on function public.get_event_vibe(uuid) to authenticated;

revoke execute on function public.get_events_vibe(uuid[]) from public, anon;
grant execute on function public.get_events_vibe(uuid[]) to authenticated;

revoke execute on function public.submit_rating(uuid, integer, integer, integer, text, text[]) from public, anon;
grant execute on function public.submit_rating(uuid, integer, integer, integer, text, text[]) to authenticated;

revoke execute on function private.publish_event_vibe(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.published_vibe(uuid, timestamptz) from public, anon, authenticated;
