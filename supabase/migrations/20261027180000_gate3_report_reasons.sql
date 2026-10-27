-- =============================================================================
-- Migration 25: a 3-rater publish gate (VC-64) and a reason on every tag
-- report (VC-65). Both approved by the founder 2026-10-27 ("approve").
-- Follows 20261027140200_vibe_publish_gate.sql, 20261027160000_admin_moderation.sql
-- and 20261027160100_tag_reports.sql, which are already on the dev project,
-- so this file replaces functions instead of editing those files.
--
-- VC-64, in plain words: the live score (meter, rater count, reaction tally)
-- used to be republished once 2 different people had rated since the last
-- update (VC-51). With 2, a guest who rated right after exactly one other
-- person could work out roughly what that person gave, because they know
-- their own rating. With 3, the change they see is the average of at least
-- two OTHER people, which is harder to pick apart. The cost: the score
-- updates a little less often.
--   * private.vibe_publish_after() now holds the number (3) in ONE place.
--   * submit_rating publishes when 3 or more different people with a
--     visible rating have saved since the last snapshot.
--   * After an admin hides or unhides a rating, the republish keeps the
--     snapshot at its own earlier moment while 1 or 2 ratings are waiting
--     (fewer than 3), so no waiting rating is ever released below the gate.
--     With 0, or 3 or more waiting, it publishes as of now, as before.
--   Honest limits (updated from VC-51): 3 is still a floor, not real
--   anonymity. A guest who rates right after exactly two others learns the
--   AVERAGE of those two, at most once an hour per event. The first rating
--   at an event shows nothing until two more people rate.
--
-- VC-65, in plain words: when a guest reports a tag they now pick WHY:
--   not_true        "Not true"
--   spam            "Spam or fake"
--   targets_person  "Targets a person"
--   offensive       "Offensive"
--   other           "Other"
--   The reason is stored with the report, and the admin queue shows how many
--   reports gave each reason. Reports from before this file have no reason
--   (null); the queue counts them as "not_given". The reporter is still
--   never returned by any function, and the rate limits are unchanged (one
--   report per person per tag per event; 10 per person per 24 hours).
--   report_heads_up_tag gets a third input, so the old two-input version is
--   dropped (otherwise the app could keep calling it without a reason).
--
-- What this file changes:
--   private.vibe_publish_after()               new: the gate number, 3
--   public.submit_rating()                     uses it (was a constant 2)
--   private.republish_vibe_after_moderation()  holds back 1 or 2 waiting
--   private.tag_reports.reason                 new column
--   public.report_heads_up_tag(uuid, text, text)  replaces (uuid, text)
--   public.admin_get_tag_reports()             adds "reasons" counts
--
-- Errors raised (new): VCRPT  a missing or unknown report reason.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: the publish gate's number, in one place.
-- -----------------------------------------------------------------------------
create function private.vibe_publish_after()
returns integer
language sql
immutable
security definer
set search_path = ''
as $$
  /*
    What it does: says how many DIFFERENT people with a visible rating must
    save since the last published snapshot before a new one is published.
    Inputs: none.
    Returns: 3 (VC-64; it was 2 under VC-51).
    Why a function: submit_rating and the admin republish must agree on the
    number, so it lives here once instead of as two constants.
  */
  select 3;
$$;

comment on function private.vibe_publish_after() is
  'VC-64: the publish gate''s number (3 different new visible raters). Used by submit_rating and republish_vibe_after_moderation.';

-- -----------------------------------------------------------------------------
-- submit_rating: as in 20261027140200, but the gate number comes from
-- private.vibe_publish_after() (3, VC-64). Nothing else changes.
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
  heads-up tags they picked, and publishes a new vibe snapshot when 3 or more
  people have rated since the last one (VC-64).
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
  -- How many different people must rate before a new snapshot (VC-64: 3).
  c_publish_after constant integer := private.vibe_publish_after();
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

  -- 8. The publish gate (VC-51, VC-64). One publisher at a time per event,
  --    so two guests saving together can't both miss each other. Then count
  --    the DIFFERENT people with a visible rating saved since the last
  --    snapshot (one row per person, so rows = people; this save included).
  --    3 or more: publish a new snapshot as of now.
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
  'VC-B08 + VC-43 + VC-46 + VC-51 + VC-64: saves the caller''s 3-tap rating (and heads-up tags); publishes a new vibe snapshot once 3+ people have rated since the last. Adults only, no admins, checked in within 45 minutes, inside the window, one per event, updates 60+ minutes apart.';

-- -----------------------------------------------------------------------------
-- republish_vibe_after_moderation: as in 20261027160000, but it holds back
-- anything below the 3-rater gate (1 or 2 waiting), not only exactly 1.
-- -----------------------------------------------------------------------------
create or replace function private.republish_vibe_after_moderation(p_event_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: makes the event's published score reflect a rating that was
  just hidden or unhidden, without releasing waiting ratings below the gate.
  Input: p_event_id, the event.
  Returns: nothing.
  Rules:
    - takes the per-event publish lock first (the same one submit_rating and
      publish_event_vibe take), so the count below can't race a guest's
      publish;
    - no snapshot yet: nothing is shown, so there's nothing to fix;
    - 1 or 2 visible ratings saved since the snapshot (fewer than the gate's
      3, VC-64): re-make the snapshot as of its own moment, so they stay
      waiting;
    - otherwise (0, or 3+ waiting, which the gate would publish anyway):
      publish as of now.
  Why the caller hides FIRST and calls this after: submit_rating holds the
  guest's rating row and then waits for this lock. Taking this lock before
  touching the rating row could deadlock with it.
*/
declare
  v_published_at timestamptz;
  v_waiting integer;
begin
  perform pg_advisory_xact_lock(hashtext('vibecheck.vibe_publish:' || p_event_id::text));

  select s.published_at into v_published_at
  from private.vibe_snapshots s
  where s.event_id = p_event_id;
  if not found then
    return;
  end if;

  -- The different people whose visible rating is newer than the snapshot
  -- (one row per person, so rows = people).
  select count(*)::int into v_waiting
  from public.ratings r
  where r.event_id = p_event_id
    and r.hidden_at is null
    and r.updated_at > v_published_at
    and r.updated_at <= now();

  if v_waiting between 1 and private.vibe_publish_after() - 1 then
    perform private.publish_event_vibe(p_event_id, v_published_at);
  else
    perform private.publish_event_vibe(p_event_id, now());
  end if;
end;
$$;

comment on function private.republish_vibe_after_moderation(uuid) is
  'VC-47 + VC-64: republishes the event''s snapshot under the per-event lock after a hide or unhide; as of the snapshot''s own moment while 1 or 2 new ratings are waiting (below the 3-rater gate, so none is released), otherwise as of now.';

-- -----------------------------------------------------------------------------
-- tag_reports.reason (VC-65). Null only for reports made before this file.
-- -----------------------------------------------------------------------------
alter table private.tag_reports
  add column reason text
  constraint tag_reports_reason_known
    check (reason in ('not_true', 'spam', 'targets_person', 'offensive', 'other'));

comment on column private.tag_reports.reason is
  'VC-65: why the guest reported (not_true, spam, targets_person, offensive, other). Null only for reports made before 20261027180000.';

-- -----------------------------------------------------------------------------
-- report_heads_up_tag: now with a reason. The old (uuid, text) version goes,
-- so a report can't be filed without one.
-- -----------------------------------------------------------------------------
drop function public.report_heads_up_tag(uuid, text);

create function public.report_heads_up_tag(p_event_id uuid, p_tag text, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: files the caller's report about one tag at one event, with
  the reason they picked (VC-65).
  Inputs: p_event_id (the event), p_tag (the tag's key) and p_reason (one of
    not_true, spam, targets_person, offensive, other).
  Returns: {"status": ...}
    'reported'  saved; an admin reviews it (48-hour target);
    'already'   this person already reported this tag here (nothing saved);
    'too_many'  10 reports in the last 24 hours already (nothing saved).
  Who may: any signed-up adult who can see the event, checked in or not
    (hosts and venues need this too). Admins may as well, though they can
    hide a tag directly.
  Raises: 42501 non-adults, VCNFD an event the caller can't see, VCTAG an
    unknown tag, VCRPT a missing or unknown reason.
*/
declare
  c_daily_limit constant integer := 10;
  v_uid uuid := auth.uid();
  v_recent integer;
begin
  if v_uid is null or not private.is_adult_user() then
    raise exception 'Please sign in and finish setting up your profile first.'
      using errcode = '42501';
  end if;
  if not private.can_see_event(p_event_id) then
    raise exception 'That event doesn''t exist.' using errcode = 'VCNFD';
  end if;
  if p_tag is null then
    raise exception 'That heads-up isn''t one we know.' using errcode = 'VCTAG';
  end if;
  perform private.check_heads_up_tags(array[p_tag]);
  -- The same five reasons as the table's check (and src/lib/moderation.ts).
  if p_reason is null
     or p_reason not in ('not_true', 'spam', 'targets_person', 'offensive', 'other') then
    raise exception 'Pick a reason for the report.' using errcode = 'VCRPT';
  end if;

  -- One report at a time per person, so two quick taps can't both pass the
  -- daily count. Released when this call ends.
  perform pg_advisory_xact_lock(hashtext('vibecheck.tag_report:' || v_uid::text));

  if exists (
    select 1 from private.tag_reports t
    where t.reporter_id = v_uid and t.event_id = p_event_id and t.tag = p_tag
  ) then
    return jsonb_build_object('status', 'already');
  end if;

  select count(*)::int into v_recent
  from private.tag_reports t
  where t.reporter_id = v_uid and t.created_at > now() - interval '24 hours';
  if v_recent >= c_daily_limit then
    return jsonb_build_object('status', 'too_many');
  end if;

  insert into private.tag_reports (event_id, tag, reporter_id, reason)
  values (p_event_id, p_tag, v_uid, p_reason);

  return jsonb_build_object('status', 'reported');
end;
$$;

comment on function public.report_heads_up_tag(uuid, text, text) is
  'VC-58 + VC-65: files a report, with a reason, about one heads-up tag at an event (any adult who can see it). One per person per tag per event; at most 10 per person per 24 hours.';

-- -----------------------------------------------------------------------------
-- admin_get_tag_reports: as in 20261027160100, plus "reasons" (VC-65).
-- -----------------------------------------------------------------------------
create or replace function public.admin_get_tag_reports()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: lists the open reports, grouped per event and tag, oldest
  first. Admins only.
  Inputs: none.
  Returns: a JSON list of
    { event_id, event_title, event_starts_at, tag,
      reports            how many open reports,
      reasons            how many open reports gave each reason, e.g.
                         {"not_true": 2, "spam": 1}; only reasons with at
                         least one report; "not_given" for reports made
                         before reasons existed (VC-65),
      first_reported_at  the oldest open report,
      hours_waiting      whole hours since then,
      overdue            true at 48 hours or more (the review promise),
      votes              the tag's counted +1s at the event, all night,
      hidden             whether the tag is already hidden there }
  Never includes who reported: only counts leave this function.
  Raises: 42501 for non-admins.
*/
declare
  v_result jsonb;
begin
  perform private.require_admin();

  select coalesce(jsonb_agg(q.item order by q.first_at, q.title, q.tag), '[]'::jsonb)
  into v_result
  from (
    select g.first_at, e.title, g.tag,
           jsonb_build_object(
             'event_id', g.event_id,
             'event_title', e.title,
             'event_starts_at', e.starts_at,
             'tag', g.tag,
             'reports', g.n,
             -- Counts per reason for this event and tag's open reports.
             'reasons', (
               select jsonb_object_agg(r.reason_key, r.n)
               from (
                 select coalesce(t.reason, 'not_given') as reason_key, count(*)::int as n
                 from private.tag_reports t
                 where t.event_id = g.event_id and t.tag = g.tag and t.resolved_at is null
                 group by 1
               ) r),
             'first_reported_at', g.first_at,
             'hours_waiting', floor(extract(epoch from (now() - g.first_at)) / 3600)::int,
             'overdue', g.first_at <= now() - interval '48 hours',
             'votes', private.counted_tag_votes(g.event_id, g.tag),
             'hidden', exists (
               select 1 from private.hidden_event_tags h
               where h.event_id = g.event_id and h.tag = g.tag)
           ) as item
    from (
      select t.event_id, t.tag, count(*)::int as n, min(t.created_at) as first_at
      from private.tag_reports t
      where t.resolved_at is null
      group by t.event_id, t.tag
    ) g
    join public.events e on e.id = g.event_id
  ) q;

  return v_result;
end;
$$;

comment on function public.admin_get_tag_reports() is
  'VC-58 + VC-65: admins only. Open tag reports grouped by event and tag, oldest first, with counts per reason, hours waiting and an overdue flag at 48 hours. Never shows reporters.';

-- -----------------------------------------------------------------------------
-- Rights: signed-in users may call the public functions (the checks inside
-- decide the rest); nobody from the app can call the private helper.
-- -----------------------------------------------------------------------------
revoke execute on function private.vibe_publish_after() from public, anon, authenticated;

revoke execute on function public.submit_rating(uuid, integer, integer, integer, text, text[]) from public, anon;
grant execute on function public.submit_rating(uuid, integer, integer, integer, text, text[]) to authenticated;

revoke execute on function private.republish_vibe_after_moderation(uuid) from public, anon, authenticated;

revoke execute on function public.report_heads_up_tag(uuid, text, text) from public, anon;
grant execute on function public.report_heads_up_tag(uuid, text, text) to authenticated;

revoke execute on function public.admin_get_tag_reports() from public, anon;
grant execute on function public.admin_get_tag_reports() to authenticated;
