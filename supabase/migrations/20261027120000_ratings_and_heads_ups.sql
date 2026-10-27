-- =============================================================================
-- Migration 14: the 3-tap rating (task VC-B08) and quick "heads-up" tags with
-- +1 (proposal VC-43, approved by the founder 2026-10-27: "fold into B08").
--
-- Plain-language background:
-- * A guest who is checked in to an event rates it in 3 taps: Crowd, Music
--   and Energy (each 1 to 3), plus an optional emoji reaction. The table
--   public.ratings already exists (migration 4, 20261026150300_ratings.sql);
--   this file adds the ONLY way to write it: submit_rating.
-- * Heads-up tags (VC-43) are one-tap notes such as "Lines are long". There
--   is no free text, so there is nothing to moderate. A guest can pick tags
--   while rating, and other checked-in guests can "+1" a tag on the event
--   page. Each +1 is one row in the new table public.heads_up_votes. The
--   event page shows a count per tag (get_event_heads_ups); nobody can see
--   WHO added a tag.
--
-- The rating rules (team/projects/vibecheck/mvp-plan.md, "Rating rules"):
--   who       a signed-up adult (18+). Admins can't rate (the staff rule,
--             VC-05): the founder uses a separate guest account;
--   here now  the guest has a check-in for this event that was confirmed in
--             the last 45 minutes (a GPS check-in, a party code or, on test
--             events only, the tester check-in). Before saving, the app
--             quietly re-checks GPS for GPS check-ins, which refreshes that
--             time;
--   window    from 30 minutes before the start to 60 minutes after the end,
--             both edges included (the same window as check-in);
--   one each  one rating per person per event. Saving again UPDATES it, and
--             only 60 minutes or more after the last save; sooner gives
--             'too_soon' with the minutes left. A person can still rate
--             every event they go to in a night (founder rule, VC-05);
--   hidden    an admin can hide an abusive rating (hidden_at). An update
--             keeps it hidden, and hidden ratings count nowhere. A hidden
--             guest's heads-up tags don't count either.
--
-- The heads-up rules (VC-43): the same "who", "here now" and "window" rules
-- as rating. Six fixed tags. One +1 per person per tag per event (the
-- table's unique key), so one person can add at most 6 rows per event: that
-- is the rate limit, and it can't be gamed by calling more often. A +1
-- can't be taken back, just as a rating can't be deleted (VC-05).
--
-- Rate limits and races: each function takes a per-person lock first (the
-- same trick as check_in), so two quick taps can't both slip past the
-- 60-minute rule. Refused calls write nothing at all.
--
-- Privacy (VC-20): no location is stored here. The quiet GPS re-check goes
-- through check_in, which keeps only pass/fail, the time and an accuracy
-- band.
--
-- Answers are returned as JSON (not raised) for the normal "not now"
-- cases. Errors are raised only for calls that should never happen:
--   42501  not signed in, no profile, or under 18
--   VCSTF  the caller is an admin (staff can't rate or add heads-ups)
--   VCNFD  no such event (or a test event and the caller isn't a tester)
--   VCRAT  the rating itself is broken (a row outside 1 to 3, an unknown
--          reaction)
--   VCTAG  an unknown heads-up tag
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table: heads_up_votes. One row = one person saying "this tag is true" at
-- one event. RLS on with NO policies and no grants: app users can't read or
-- write it directly. They see counts only, through get_event_heads_ups.
-- -----------------------------------------------------------------------------
create table public.heads_up_votes (
  -- Deleting a profile (account deletion) deletes that person's +1s.
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  -- The six tags (VC-43). The app shows the words; keep both lists in sync
  -- (src/lib/rating.ts, HEADS_UP_TAGS).
  tag text not null
    check (tag in ('lines_long', 'music_fire', 'packed', 'overpriced', 'good_crowd', 'sound_bad')),
  created_at timestamptz not null default now(),
  -- One +1 per person per tag per event.
  primary key (user_id, event_id, tag)
);

comment on table public.heads_up_votes is
  'VC-43 heads-up tags: one row per person, event and tag. No RLS policies: not readable by app users. Written only by submit_rating and add_heads_up; counted by get_event_heads_ups.';
comment on column public.heads_up_votes.user_id is 'Who added or +1''d the tag.';
comment on column public.heads_up_votes.event_id is 'Which event.';
comment on column public.heads_up_votes.tag is 'lines_long, music_fire, packed, overpriced, good_crowd or sound_bad.';
comment on column public.heads_up_votes.created_at is 'When the +1 was added.';

-- The event page counts one event's tags, so index by event.
create index heads_up_votes_event_idx on public.heads_up_votes (event_id, tag);

revoke all on table public.heads_up_votes from anon, authenticated;
alter table public.heads_up_votes enable row level security;

-- -----------------------------------------------------------------------------
-- Helper: the shared "here now and in the window" gate.
-- -----------------------------------------------------------------------------
create function private.rating_gate(
  p_uid uuid,
  p_event_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: checks the two "may this person speak for this event right
  now?" rules shared by submit_rating and add_heads_up.
  Inputs: the caller's id, the event's id, and its start and end times.
  Returns: null when both rules pass, otherwise the refusal to send back:
    'outside_window'  with reason ('too_early' or 'too_late'), opens_at and
                      closes_at (the same shape check_in uses);
    'not_checked_in'  no check-in at all for this event;
    'check_in_stale'  checked in, but not confirmed in the last 45 minutes
                      (the app sends the guest to check in again).
  Why a helper: both functions must apply exactly the same rule, and one
  copy can't drift. It is in the private schema, so the app can't call it.
*/
declare
  v_now timestamptz := now();
  v_opens_at timestamptz := p_starts_at - interval '30 minutes';
  v_closes_at timestamptz := p_ends_at + interval '60 minutes';
  v_last_verified timestamptz;
begin
  if v_now < v_opens_at or v_now > v_closes_at then
    return jsonb_build_object(
      'status', 'outside_window',
      'reason', case when v_now < v_opens_at then 'too_early' else 'too_late' end,
      'opens_at', v_opens_at,
      'closes_at', v_closes_at
    );
  end if;

  select c.last_verified_at into v_last_verified
  from public.check_ins c
  where c.user_id = p_uid and c.event_id = p_event_id;
  if not found then
    return jsonb_build_object('status', 'not_checked_in');
  end if;

  -- "Here now": confirmed within the last 45 minutes, the edge included.
  if v_last_verified < v_now - interval '45 minutes' then
    return jsonb_build_object('status', 'check_in_stale');
  end if;

  return null;
end;
$$;

comment on function private.rating_gate(uuid, uuid, timestamptz, timestamptz) is
  'VC-B08: null when the caller is in the event window and checked in within 45 minutes; otherwise outside_window, not_checked_in or check_in_stale.';

-- -----------------------------------------------------------------------------
-- Helper: the caller may rate at all, and the event exists for them.
-- -----------------------------------------------------------------------------
create function private.rating_event(p_event_id uuid)
returns public.events
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: the checks that come before any rating or heads-up.
  Input: p_event_id, the event.
  Returns: the event's row, or raises:
    42501  not signed in, no profile or under 18;
    VCSTF  the caller is an admin (staff rule, VC-05);
    VCNFD  no such event, or a test event and the caller isn't a tester
           (to them it doesn't exist, as with check-in).
*/
declare
  v_event public.events%rowtype;
begin
  if auth.uid() is null or not private.is_adult_user() then
    raise exception 'Please sign in and finish setting up your profile first.'
      using errcode = '42501';
  end if;
  if private.is_admin() then
    raise exception 'Admins can''t rate events. Use a guest account to rate.'
      using errcode = 'VCSTF';
  end if;
  select * into v_event from public.events e where e.id = p_event_id;
  if not found or (v_event.is_test and not private.is_tester()) then
    raise exception 'That event doesn''t exist.' using errcode = 'VCNFD';
  end if;
  return v_event;
end;
$$;

comment on function private.rating_event(uuid) is
  'VC-B08: returns the event, or raises 42501 (not an adult), VCSTF (admin) or VCNFD (no such event for this caller).';

-- -----------------------------------------------------------------------------
-- Helper: check a list of heads-up tags.
-- -----------------------------------------------------------------------------
create function private.check_heads_up_tags(p_tags text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
/*
  What it does: makes sure every tag in the list is one of the six.
  Input: p_tags, the list (null or empty is fine: tags are optional).
  Returns: nothing, or raises VCTAG with a message the app can show.
  Why: the table rule would also refuse an unknown tag, but with a vague
  "check constraint" error, and only after other work was done.
*/
begin
  if p_tags is not null and exists (
    select 1 from unnest(p_tags) t(tag)
    where t.tag is null
       or t.tag not in ('lines_long', 'music_fire', 'packed', 'overpriced', 'good_crowd', 'sound_bad')
  ) then
    raise exception 'That heads-up isn''t one we know.' using errcode = 'VCTAG';
  end if;
end;
$$;

comment on function private.check_heads_up_tags(text[]) is
  'VC-43: raises VCTAG unless every tag is one of the six.';

-- -----------------------------------------------------------------------------
-- submit_rating: save (or, after an hour, update) the caller's rating.
-- -----------------------------------------------------------------------------
create function public.submit_rating(
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
  heads-up tags they picked.
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
                      included unless it is hidden). The app's "You and 4
                      others" message comes from raters.
    'too_soon'        saved less than 60 minutes ago. Also: minutes_left
                      (rounded up, at least 1) and next_update_at.
    'outside_window', 'not_checked_in', 'check_in_stale'
                      see private.rating_gate.
  Why `security definer`: the app can't write ratings directly (B02 grants),
  so this is the only door, and it applies every rule first.
*/
declare
  v_uid uuid := auth.uid();
  v_event public.events%rowtype;
  v_now timestamptz := now();
  v_refusal jsonb;
  v_last_saved timestamptz;
  v_next timestamptz;
  v_score numeric;
  v_raters integer;
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

  -- 7. The heads-up tags: one +1 each; a tag they already added is skipped.
  insert into public.heads_up_votes (user_id, event_id, tag)
  select distinct v_uid, p_event_id, t.tag
  from unnest(coalesce(p_tags, '{}')) t(tag)
  on conflict do nothing;

  -- 8. How many people's ratings count at this event now (hidden ones don't).
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
  'VC-B08 + VC-43: saves the caller''s 3-tap rating (and heads-up tags). Adults only, no admins, checked in within 45 minutes, inside the window, one per event, updates 60+ minutes apart.';

-- -----------------------------------------------------------------------------
-- add_heads_up: "+1" one heads-up tag on the event page.
-- -----------------------------------------------------------------------------
create function public.add_heads_up(p_event_id uuid, p_tag text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: adds the caller's +1 to one heads-up tag at an event.
  Inputs: p_event_id (the event) and p_tag (one of the six tags).
  Returns: JSON with "status":
    'added'    the +1 was saved;
    'already'  they had already added this tag (nothing changes);
    'outside_window', 'not_checked_in', 'check_in_stale'
               see private.rating_gate.
  Why the same rules as rating: a heads-up is a claim about the party right
  now, so only guests who are there may make it (VC-05, VC-43).
*/
declare
  v_uid uuid := auth.uid();
  v_event public.events%rowtype;
  v_refusal jsonb;
begin
  v_event := private.rating_event(p_event_id);
  if p_tag is null then
    raise exception 'That heads-up isn''t one we know.' using errcode = 'VCTAG';
  end if;
  perform private.check_heads_up_tags(array[p_tag]);

  -- Same per-person lock as submit_rating.
  perform pg_advisory_xact_lock(hashtext('vibecheck.rating:' || v_uid::text));

  v_refusal := private.rating_gate(v_uid, p_event_id, v_event.starts_at, v_event.ends_at);
  if v_refusal is not null then
    return v_refusal;
  end if;

  insert into public.heads_up_votes (user_id, event_id, tag)
  values (v_uid, p_event_id, p_tag)
  on conflict do nothing;

  -- FOUND is true only when the insert added a row.
  return jsonb_build_object('status', case when found then 'added' else 'already' end);
end;
$$;

comment on function public.add_heads_up(uuid, text) is
  'VC-43: the caller''s +1 on one heads-up tag. Same rules as submit_rating (adult, no admins, checked in within 45 minutes, in the window). One per person per tag per event.';

-- -----------------------------------------------------------------------------
-- get_event_heads_ups: the counts for the event page.
-- -----------------------------------------------------------------------------
create function public.get_event_heads_ups(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: counts the heads-up tags at one event.
  Input: p_event_id, the event.
  Returns: a JSON list, most +1s first, e.g.
    [{"tag": "lines_long", "count": 3, "mine": true}, ...]
  Only tags with at least one counted +1 are listed. "mine" says whether
  the caller has +1'd it (so the app can show "You +1'd"). Never says who
  else did.
  Rules: any signed-up adult who can see the event may read the counts
  (admins too). +1s from a guest whose rating here was hidden by an admin
  don't count (so one abuser can't skew the tags).
  Raises: 42501 for non-adults, VCNFD for an event the caller can't see.
*/
declare
  v_uid uuid := auth.uid();
  v_event public.events%rowtype;
  v_result jsonb;
begin
  if v_uid is null or not private.is_adult_user() then
    raise exception 'Please sign in and finish setting up your profile first.'
      using errcode = '42501';
  end if;
  select * into v_event from public.events e where e.id = p_event_id;
  if not found or (v_event.is_test and not private.is_tester()) then
    raise exception 'That event doesn''t exist.' using errcode = 'VCNFD';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('tag', t.tag, 'count', t.n, 'mine', t.mine)
      order by t.n desc, t.tag
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select v.tag,
           count(*)::int as n,
           bool_or(v.user_id = v_uid) as mine
    from public.heads_up_votes v
    where v.event_id = p_event_id
      -- Skip +1s from guests whose rating at this event is hidden.
      and not exists (
        select 1 from public.ratings r
        where r.user_id = v.user_id
          and r.event_id = v.event_id
          and r.hidden_at is not null
      )
    group by v.tag
  ) t;

  return v_result;
end;
$$;

comment on function public.get_event_heads_ups(uuid) is
  'VC-43: counts of heads-up tags at an event (most first), with "mine" for the caller. Excludes +1s from guests whose rating there is hidden.';

-- -----------------------------------------------------------------------------
-- Who may run what: signed-in users may call the three public functions
-- (the checks inside decide the rest); anon can't call them; nobody from the
-- app can call the private helpers.
-- -----------------------------------------------------------------------------
revoke execute on function public.submit_rating(uuid, integer, integer, integer, text, text[]) from public, anon;
grant execute on function public.submit_rating(uuid, integer, integer, integer, text, text[]) to authenticated;

revoke execute on function public.add_heads_up(uuid, text) from public, anon;
grant execute on function public.add_heads_up(uuid, text) to authenticated;

revoke execute on function public.get_event_heads_ups(uuid) from public, anon;
grant execute on function public.get_event_heads_ups(uuid) to authenticated;

revoke execute on function private.rating_gate(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function private.rating_event(uuid) from public, anon, authenticated;
revoke execute on function private.check_heads_up_tags(text[]) from public, anon, authenticated;
