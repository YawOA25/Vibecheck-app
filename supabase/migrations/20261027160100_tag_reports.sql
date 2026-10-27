-- =============================================================================
-- Migration 23: "Report this tag" and the admin report queue (proposal VC-58,
-- approved by the founder 2026-10-27, "approve 58-60 as recommended").
-- Builds on 20261027160000_admin_moderation.sql (the moderation log, the
-- admin check and the reason rule).
--
-- Plain-language background (legal review, section 5,
-- team/projects/vibecheck/legal/phase0-consents-2026-10-27.md):
-- * Heads-up tags are guests' impressions of a party. A tag such as the
--   coming "Felt unsafe" could be misused against a venue or a private host
--   (an ex, a rival). So anyone signed up, hosts and venues included, can
--   report a tag at an event. Reports go to an admin queue.
-- * The queue shows how long each report has waited. The promise is a
--   review within 48 hours, the same as clips, so anything older is marked
--   overdue.
-- * From the queue an admin either hides the tag at that ONE event, or keeps
--   it. Both are logged with a reason from the written rule (see the
--   moderation_log table): remove only when the pickers weren't really there,
--   the picks look coordinated, or someone broke the tester rules. "The
--   venue asked" is not a reason, so the rule is the same whoever complains.
-- * A reporter's identity is stored (so a flood of fake reports can be dealt
--   with) but no function ever returns it, not even to admins: the queue only
--   shows how many reports there are.
--
-- Rate limits, so reports can't be used to spam the queue:
--   - one report per person per tag per event, ever (a repeat says 'already');
--   - at most 10 reports per person in any 24 hours ('too_many').
--   Each report takes a per-person lock first, so quick repeated taps can't
--   slip past the count.
--
-- What this file adds:
--   private.hidden_event_tags      tags an admin hid at one event
--   private.tag_reports            one row per report
--   public.report_heads_up_tag()   the "Report this tag" button
--   public.admin_get_tag_reports() the queue (admins only)
--   public.admin_get_event_tags()  every tag at one event, for the admin
--   public.admin_set_tag_hidden()  hide or unhide a tag at one event
--   public.admin_keep_tag()        "reviewed, keep it": closes the reports
--   public.get_event_heads_ups()   now skips hidden tags
--
-- Not here (next batch): the new tag list (VC-45), the "Felt unsafe" words
-- and thresholds (VC-56, VC-59, VC-60). Tags are checked with
-- private.check_heads_up_tags, which that batch will update, so nothing here
-- hard-codes the list.
--
-- Errors raised:
--   42501  not signed in, not an adult, or (admin functions) not an admin
--   VCNFD  no such event for the caller
--   VCTAG  an unknown tag
--   VCRSN  a reason that doesn't fit the action, or a note over 500 characters
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table: tags hidden at one event. Private, RLS on, no policies, no grants.
-- -----------------------------------------------------------------------------
create table private.hidden_event_tags (
  event_id uuid not null references public.events (id) on delete cascade,
  tag text not null,
  hidden_at timestamptz not null default now(),
  -- The admin who hid it (null if their account is deleted later).
  hidden_by uuid references public.profiles (id) on delete set null,
  primary key (event_id, tag)
);

comment on table private.hidden_event_tags is
  'VC-58: heads-up tags an admin hid at one event (get_event_heads_ups leaves them out). Unhiding deletes the row; the moderation log keeps the history.';

revoke all on table private.hidden_event_tags from public, anon, authenticated;
alter table private.hidden_event_tags enable row level security;

-- -----------------------------------------------------------------------------
-- Table: reports. Private, RLS on, no policies, no grants. reporter_id is
-- never returned by any function.
-- -----------------------------------------------------------------------------
create table private.tag_reports (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  tag text not null,
  -- Who reported (deleting their account deletes their reports).
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Set when an admin decides: 'hidden' (the tag was hidden) or 'kept'.
  resolved_at timestamptz,
  resolution text check (resolution in ('hidden', 'kept')),
  -- Both set, or neither.
  constraint tag_reports_resolved_together check ((resolved_at is null) = (resolution is null)),
  -- One report per person per tag per event.
  constraint tag_reports_one_each unique (reporter_id, event_id, tag)
);

comment on table private.tag_reports is
  'VC-58: one row per "Report this tag". Open until an admin hides or keeps the tag. The reporter is never shown to anyone.';
comment on column private.tag_reports.reporter_id is 'Who reported. Stored for abuse handling only; never returned by any function.';
comment on column private.tag_reports.resolution is 'hidden or kept, once an admin decided (with resolved_at).';

-- The queue reads open reports; the rate limit reads one person's recent ones.
create index tag_reports_open_idx on private.tag_reports (event_id, tag) where resolved_at is null;
create index tag_reports_reporter_idx on private.tag_reports (reporter_id, created_at);

revoke all on table private.tag_reports from public, anon, authenticated;
alter table private.tag_reports enable row level security;

-- -----------------------------------------------------------------------------
-- report_heads_up_tag: the "Report this tag" button.
-- -----------------------------------------------------------------------------
create function public.report_heads_up_tag(p_event_id uuid, p_tag text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: files the caller's report about one tag at one event.
  Inputs: p_event_id (the event) and p_tag (the tag's key).
  Returns: {"status": ...}
    'reported'  saved; an admin reviews it (48-hour target);
    'already'   this person already reported this tag here (nothing saved);
    'too_many'  10 reports in the last 24 hours already (nothing saved).
  Who may: any signed-up adult who can see the event, checked in or not
    (hosts and venues need this too). Admins may as well, though they can
    hide a tag directly.
  Raises: 42501 non-adults, VCNFD an event the caller can't see, VCTAG an
    unknown tag.
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

  insert into private.tag_reports (event_id, tag, reporter_id)
  values (p_event_id, p_tag, v_uid);

  return jsonb_build_object('status', 'reported');
end;
$$;

comment on function public.report_heads_up_tag(uuid, text) is
  'VC-58: files a report about one heads-up tag at an event (any adult who can see it). One per person per tag per event; at most 10 per person per 24 hours.';

-- -----------------------------------------------------------------------------
-- admin_get_tag_reports: the queue.
-- -----------------------------------------------------------------------------
create function public.admin_get_tag_reports()
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
      first_reported_at  the oldest open report,
      hours_waiting      whole hours since then,
      overdue            true at 48 hours or more (the review promise),
      votes              the tag's counted +1s at the event, all night,
      hidden             whether the tag is already hidden there }
  Never includes who reported.
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
  'VC-58: admins only. Open tag reports grouped by event and tag, oldest first, with hours waiting and an overdue flag at 48 hours. Never shows reporters.';

-- -----------------------------------------------------------------------------
-- Helper: a tag's counted +1s at an event over the whole night.
-- -----------------------------------------------------------------------------
create function private.counted_tag_votes(p_event_id uuid, p_tag text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  /*
    What it does: counts the +1s for one tag at one event that still count:
    not removed by an admin, and not from a guest whose rating is hidden.
    Inputs: the event and the tag.
    Returns: the number (0 when none).
    Why the whole night (not the guests' 3-hour window): an admin reviewing
    a report the next day still needs to see how many people picked it.
  */
  select count(*)::int
  from public.heads_up_votes v
  where v.event_id = p_event_id
    and v.tag = p_tag
    and v.hidden_at is null
    and not exists (
      select 1 from public.ratings r
      where r.user_id = v.user_id and r.event_id = v.event_id and r.hidden_at is not null
    );
$$;

comment on function private.counted_tag_votes(uuid, text) is
  'VC-58: counted +1s (not removed, not from hidden raters) for one tag at one event, all night.';

-- -----------------------------------------------------------------------------
-- admin_get_event_tags: every tag at one event, for the admin screen.
-- -----------------------------------------------------------------------------
create function public.admin_get_event_tags(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: lists each tag that has a +1, a report or a hide at one
  event. Admins only.
  Input: p_event_id, the event.
  Returns: a JSON list of {tag, votes, hidden, open_reports}, most votes
    first. votes is the all-night counted number (private.counted_tag_votes).
  Raises: 42501 for non-admins, VCNFD for an unknown event.
*/
declare
  v_result jsonb;
begin
  perform private.require_admin();
  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'That event doesn''t exist.' using errcode = 'VCNFD';
  end if;

  select coalesce(jsonb_agg(x.item order by x.votes desc, x.tag), '[]'::jsonb)
  into v_result
  from (
    select tags.tag,
           private.counted_tag_votes(p_event_id, tags.tag) as votes,
           jsonb_build_object(
             'tag', tags.tag,
             'votes', private.counted_tag_votes(p_event_id, tags.tag),
             'hidden', exists (
               select 1 from private.hidden_event_tags h
               where h.event_id = p_event_id and h.tag = tags.tag),
             'open_reports', (
               select count(*)::int from private.tag_reports t
               where t.event_id = p_event_id and t.tag = tags.tag and t.resolved_at is null)
           ) as item
    from (
      select v.tag from public.heads_up_votes v where v.event_id = p_event_id
      union
      select t.tag from private.tag_reports t where t.event_id = p_event_id
      union
      select h.tag from private.hidden_event_tags h where h.event_id = p_event_id
    ) tags
  ) x;

  return v_result;
end;
$$;

comment on function public.admin_get_event_tags(uuid) is
  'VC-58: admins only. Each tag with a +1, report or hide at an event: votes (all night), hidden, open_reports.';

-- -----------------------------------------------------------------------------
-- admin_set_tag_hidden: hide or unhide one tag at one event.
-- -----------------------------------------------------------------------------
create function public.admin_set_tag_hidden(
  p_event_id uuid,
  p_tag text,
  p_hidden boolean,
  p_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: hides (or unhides) one heads-up tag at one event, and logs
  the decision with its reason. Hiding also closes that tag's open reports
  there as 'hidden'.
  Inputs:
    p_event_id, p_tag  the event and the tag
    p_hidden           true to hide, false to unhide
    p_reason           hiding: not_checked_in, coordinated or
                       broke_tester_rules; unhiding: no_rule_broken or mistake
    p_note             optional admin-only note (500 characters at most)
  Returns: {"status": "done"}, or {"status": "unchanged"} when it was
    already that way (nothing logged).
  Why no republish: tags aren't part of the score.
  Raises: 42501 non-admins, VCNFD unknown event, VCTAG unknown tag, VCRSN.
*/
declare
  v_changed integer;
begin
  perform private.require_admin();
  perform private.check_moderation_reason(coalesce(p_hidden, false), p_reason, p_note);
  if p_hidden is null then
    raise exception 'Say whether to hide or unhide.' using errcode = 'VCRSN';
  end if;
  if p_tag is null then
    raise exception 'That heads-up isn''t one we know.' using errcode = 'VCTAG';
  end if;
  perform private.check_heads_up_tags(array[p_tag]);
  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'That event doesn''t exist.' using errcode = 'VCNFD';
  end if;

  if p_hidden then
    insert into private.hidden_event_tags (event_id, tag, hidden_by)
    values (p_event_id, p_tag, auth.uid())
    on conflict do nothing;
  else
    delete from private.hidden_event_tags h
    where h.event_id = p_event_id and h.tag = p_tag;
  end if;
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    return jsonb_build_object('status', 'unchanged');
  end if;

  if p_hidden then
    update private.tag_reports t
    set resolved_at = now(), resolution = 'hidden'
    where t.event_id = p_event_id and t.tag = p_tag and t.resolved_at is null;
  end if;

  insert into private.moderation_log (admin_id, action, event_id, tag, reason, note)
  values (auth.uid(), case when p_hidden then 'hide_tag' else 'unhide_tag' end,
          p_event_id, p_tag, p_reason, nullif(btrim(p_note), ''));

  return jsonb_build_object('status', 'done');
end;
$$;

comment on function public.admin_set_tag_hidden(uuid, text, boolean, text, text) is
  'VC-58: admins only. Hides or unhides one tag at one event with a logged reason; hiding closes its open reports as hidden.';

-- -----------------------------------------------------------------------------
-- admin_keep_tag: "reviewed, it stays".
-- -----------------------------------------------------------------------------
create function public.admin_keep_tag(
  p_event_id uuid,
  p_tag text,
  p_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: closes the open reports about one tag at one event as
  'kept', and logs the decision. The tag stays visible.
  Inputs: the event, the tag, the reason (no_rule_broken or mistake) and an
    optional note.
  Returns: {"status": "done"}, or {"status": "unchanged"} when there were no
    open reports (nothing logged).
  Why it matters: the written rule says an honest tag stays even when a
    venue or host complains. Recording the "keep" shows the report was
    reviewed and why.
  Raises: 42501 non-admins, VCTAG unknown tag, VCRSN.
*/
declare
  v_changed integer;
begin
  perform private.require_admin();
  perform private.check_moderation_reason(false, p_reason, p_note);
  if p_tag is null then
    raise exception 'That heads-up isn''t one we know.' using errcode = 'VCTAG';
  end if;
  perform private.check_heads_up_tags(array[p_tag]);

  update private.tag_reports t
  set resolved_at = now(), resolution = 'kept'
  where t.event_id = p_event_id and t.tag = p_tag and t.resolved_at is null;
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    return jsonb_build_object('status', 'unchanged');
  end if;

  insert into private.moderation_log (admin_id, action, event_id, tag, reason, note)
  values (auth.uid(), 'keep_tag', p_event_id, p_tag, p_reason, nullif(btrim(p_note), ''));

  return jsonb_build_object('status', 'done');
end;
$$;

comment on function public.admin_keep_tag(uuid, text, text, text) is
  'VC-58: admins only. Closes a tag''s open reports at an event as kept, with a logged reason (no_rule_broken or mistake).';

-- -----------------------------------------------------------------------------
-- get_event_heads_ups: as in 20261027160000, plus hidden tags are left out.
-- -----------------------------------------------------------------------------
create or replace function public.get_event_heads_ups(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: counts the heads-up tags at one event, over the last 3 hours.
  Input: p_event_id, the event.
  Returns: a JSON list, most +1s first, e.g.
    [{"tag": "lines_long", "count": 3, "mine": true}, ...]
  Only +1s added (or refreshed) in the 3 hours up to now count (VC-46).
  Not counted: tags an admin hid at this event (VC-58), +1s an admin
  removed (VC-47), and +1s from a guest whose rating here is hidden.
  "mine" says whether the caller's own counted +1 is among them. Never says
  who else did.
  Rules: any signed-up adult who can see the event (admins too).
  Raises: 42501 for non-adults, VCNFD for an event the caller can't see.
*/
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_result jsonb;
begin
  if v_uid is null or not private.is_adult_user() then
    raise exception 'Please sign in and finish setting up your profile first.'
      using errcode = '42501';
  end if;
  if not private.can_see_event(p_event_id) then
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
      -- VC-46: only the last 3 hours.
      and v.created_at >= v_now - interval '3 hours'
      and v.created_at <= v_now
      -- VC-47: not removed by an admin.
      and v.hidden_at is null
      -- VC-58: the tag isn't hidden at this event.
      and not exists (
        select 1 from private.hidden_event_tags h
        where h.event_id = v.event_id and h.tag = v.tag
      )
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
  'VC-43 + VC-46 + VC-47 + VC-58: counts of heads-up tags at an event over the last 3 hours (most first), with "mine". Excludes hidden tags, removed +1s and +1s from guests whose rating there is hidden.';

-- -----------------------------------------------------------------------------
-- Rights: signed-in users may call the public functions (the checks inside
-- decide the rest; the admin_ ones refuse everyone but admins); anon can't;
-- nobody from the app can call the private helper.
-- -----------------------------------------------------------------------------
revoke execute on function public.report_heads_up_tag(uuid, text) from public, anon;
grant execute on function public.report_heads_up_tag(uuid, text) to authenticated;

revoke execute on function public.admin_get_tag_reports() from public, anon;
grant execute on function public.admin_get_tag_reports() to authenticated;

revoke execute on function public.admin_get_event_tags(uuid) from public, anon;
grant execute on function public.admin_get_event_tags(uuid) to authenticated;

revoke execute on function public.admin_set_tag_hidden(uuid, text, boolean, text, text) from public, anon;
grant execute on function public.admin_set_tag_hidden(uuid, text, boolean, text, text) to authenticated;

revoke execute on function public.admin_keep_tag(uuid, text, text, text) from public, anon;
grant execute on function public.admin_keep_tag(uuid, text, text, text) to authenticated;

revoke execute on function public.get_event_heads_ups(uuid) from public, anon;
grant execute on function public.get_event_heads_ups(uuid) to authenticated;

revoke execute on function private.counted_tag_votes(uuid, text) from public, anon, authenticated;
