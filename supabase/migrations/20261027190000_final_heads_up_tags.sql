-- =============================================================================
-- Migration 27: the final heads-up tag list and when a tag may be shown
-- (VC-45, VC-56, VC-57, VC-59, VC-60). Follows 20261027180100_report_tag_compat.sql,
-- which is already on the dev project, so this file replaces functions
-- instead of editing older files.
--
-- In plain words:
--   1. The tag list (VC-45 + VC-57). Nine tags from now on:
--        lines_long, overpriced, dress_code, friendly_crowd, sound_bad,
--        felt_unsafe, picking_up, clearing_out, parking_rough.
--      Three are RETIRED: music_fire, packed, good_crowd (they repeated a
--      rating choice). Retired tags can't be picked any more (VCTAG), but
--      old rows stay exactly as they are; they are simply never shown to
--      guests again. Admins can still close old reports about them.
--   2. A tag shows on the event page only once 2 or more different guests
--      picked it (VC-56). One person alone can't put a claim on an event.
--   3. "Felt unsafe" is stricter (VC-59, legal review section 5): it shows
--      only when BOTH are true:
--        - at least 3 guests picked it, AND
--        - those guests are at least 10% of tonight's raters.
--      The legal text says "3+ picks or at least 10% of that night's raters,
--      whichever is higher", so the bar is the higher of the two, which
--      means both must be met. Example: 50 raters tonight -> 5 picks needed;
--      12 raters -> 3 picks needed.
--   4. "Felt unsafe" counts that night only (VC-60): only picks made since
--      5 AM New York time (when an event night starts) count, on top of the
--      usual 3-hour window. So it never carries over to the next night.
--   5. The thresholds are applied HERE, on the server. A tag below its bar
--      is not sent to the app at all (no count, no "mine"), so nobody can
--      read a lone pick from the network. Admin moderation screens use
--      their own functions (admin_get_event_tags, admin_get_event_moderation)
--      and still see every count.
--
-- What this file changes:
--   private.heads_up_tags_active()     new: the nine tags guests can pick
--   private.heads_up_tags_retired()    new: the three retired tags
--   private.night_start(timestamptz)   new: 5 AM New York that began the night
--   private.check_heads_up_tags()      now accepts only the nine tags
--   private.check_known_heads_up_tag() new: nine + retired (admin actions)
--   public.heads_up_votes tag check    allows nine + retired (old rows stay)
--   private.event_heads_ups()          new: the counting core at a given
--                                       moment (retired tags out, VC-56/59/60
--                                       bars), so tests can pick the time
--   public.get_event_heads_ups()       same checks, counts through the core
--   public.admin_set_tag_hidden()      accepts retired tags (old reports)
--   public.admin_keep_tag()            accepts retired tags (old reports)
--
-- Keep in step with the app: src/lib/rating.ts (HEADS_UP_TAGS,
-- RETIRED_HEADS_UP_TAGS) and src/lib/ratings-api.ts.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The tag lists, in one place, so the checks below can't disagree.
-- -----------------------------------------------------------------------------
create function private.heads_up_tags_active()
returns text[]
language sql
immutable
set search_path = ''
as $$
  /*
    What it does: lists the nine heads-up tags guests can pick (VC-45 +
    VC-57), in the order the app shows them.
    Inputs: none.
    Returns: the tag keys.
    Why a function: the pick check and the event page both need the same
    list; one copy means they can't drift apart.
  */
  select array['lines_long', 'overpriced', 'dress_code', 'friendly_crowd', 'sound_bad',
               'felt_unsafe', 'picking_up', 'clearing_out', 'parking_rough']::text[];
$$;

comment on function private.heads_up_tags_active() is
  'VC-45 + VC-57: the nine heads-up tags guests can pick.';

create function private.heads_up_tags_retired()
returns text[]
language sql
immutable
set search_path = ''
as $$
  /*
    What it does: lists the tags that were retired in VC-45.
    Inputs: none.
    Returns: the tag keys.
    Why keep them: old rows still hold these keys, and admins may still need
    to close an old report about one. Guests never see them again.
  */
  select array['music_fire', 'packed', 'good_crowd']::text[];
$$;

comment on function private.heads_up_tags_retired() is
  'VC-45: retired heads-up tags. Old rows keep them; they can''t be picked or shown.';

-- -----------------------------------------------------------------------------
-- night_start: the 5 AM New York that started the current event night.
-- -----------------------------------------------------------------------------
create function private.night_start(p_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  /*
    What it does: finds when the event night that p_at falls in began.
    An event night runs from 5 AM to 5 AM New York time (founder decision,
    VC-54), so 1 AM Saturday still belongs to Friday's night.
    Input: p_at, a moment.
    Returns: 5 AM New York on the night's day, as a timestamptz.
    How: take the New York clock time, step back 5 hours (so 00:00-04:59
    lands on the day before), keep the date, add 05:00 back, and turn that
    New York time into a real moment. 5 AM is never a daylight-saving
    change hour (those happen at 2 AM), so it is never ambiguous.
  */
  select ((((p_at at time zone 'America/New_York') - interval '5 hours')::date
           + time '05:00') at time zone 'America/New_York');
$$;

comment on function private.night_start(timestamptz) is
  'VC-60: 5 AM New York that began the event night containing p_at.';

-- -----------------------------------------------------------------------------
-- check_heads_up_tags: guests can pick only the nine tags now.
-- -----------------------------------------------------------------------------
create or replace function private.check_heads_up_tags(p_tags text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
/*
  What it does: makes sure every tag in the list is one of the nine tags
  guests can pick. Used by every "new pick" path: submit_rating,
  add_heads_up and report_heads_up_tag.
  Input: p_tags, the list (null or empty is fine: tags are optional).
  Returns: nothing, or raises VCTAG with a message the app can show.
  Why retired tags are refused: VC-45 retired them. An old app build that
  still offers "Packed" gets this message and can unpick it and save.
*/
begin
  if p_tags is not null and exists (
    select 1 from unnest(p_tags) t(tag)
    where t.tag is null
       or not (t.tag = any (private.heads_up_tags_active()))
  ) then
    raise exception 'That heads-up isn''t one we know.' using errcode = 'VCTAG';
  end if;
end;
$$;

comment on function private.check_heads_up_tags(text[]) is
  'VC-43 + VC-45: raises VCTAG unless every tag is one of the nine that can be picked (retired tags are refused).';

-- -----------------------------------------------------------------------------
-- check_known_heads_up_tag: for admin actions, retired tags are fine too.
-- -----------------------------------------------------------------------------
create function private.check_known_heads_up_tag(p_tag text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
/*
  What it does: makes sure a tag is one that exists or once existed (the
  nine plus the retired three).
  Input: p_tag, the tag key.
  Returns: nothing, or raises VCTAG.
  Why: a report filed about "Packed" before VC-45 must still be closable by
  an admin (hide or keep), even though guests can't pick "Packed" any more.
*/
begin
  if p_tag is null
     or not (p_tag = any (private.heads_up_tags_active() || private.heads_up_tags_retired())) then
    raise exception 'That heads-up isn''t one we know.' using errcode = 'VCTAG';
  end if;
end;
$$;

comment on function private.check_known_heads_up_tag(text) is
  'VC-45: raises VCTAG unless the tag is current or retired (for admin actions on old reports).';

-- -----------------------------------------------------------------------------
-- The table rule: the nine plus the retired three, so old rows stay valid.
-- -----------------------------------------------------------------------------
alter table public.heads_up_votes drop constraint heads_up_votes_tag_check;
alter table public.heads_up_votes add constraint heads_up_votes_tag_check
  check (tag in ('lines_long', 'overpriced', 'dress_code', 'friendly_crowd', 'sound_bad',
                 'felt_unsafe', 'picking_up', 'clearing_out', 'parking_rough',
                 -- Retired in VC-45: kept only so old rows stay valid.
                 'music_fire', 'packed', 'good_crowd'));

comment on column public.heads_up_votes.tag is
  'One of the nine tags (VC-45 + VC-57), or a retired one (music_fire, packed, good_crowd) on rows saved before VC-45. New picks are checked by private.check_heads_up_tags.';

-- -----------------------------------------------------------------------------
-- event_heads_ups: the counting core, at a given moment. Split out of
-- get_event_heads_ups so the pgTAP tests can pick "now" (for example one
-- minute after 5 AM) and prove the night rule, the same way
-- private.event_vibe takes p_now.
-- -----------------------------------------------------------------------------
create function private.event_heads_ups(p_event_id uuid, p_uid uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
/*
  What it does: counts the heads-up tags at one event over the 3 hours up to
  p_now, and returns only the tags that have reached their bar.
  Inputs:
    p_event_id  the event
    p_uid       the person asking (for "mine"; null = nobody)
    p_now       the moment to count at (get_event_heads_ups passes now())
  Returns: a JSON list, most +1s first, e.g.
    [{"tag": "lines_long", "count": 3, "mine": true}, ...]
  Counted: +1s added (or refreshed) in the 3 hours up to p_now (VC-46).
  Not counted: tags an admin hid at this event (VC-58); any +1 from a guest
  whose +1s an admin removed at this event, including later ones (VC-47);
  +1s from a guest whose rating here is hidden; retired tags (VC-45).
  Shown only when (decided here, so lower counts never leave the server):
    - any tag: 2 or more different guests (VC-56);
    - felt_unsafe: 3 or more guests AND at least 10% of tonight's raters
      (VC-59), counting only picks made since 5 AM New York tonight (VC-60).
  "mine" says whether p_uid's own counted +1 is among them. Never says who
  else did.
  Who may call it: nobody from the app (no grants); only the definer
  function get_event_heads_ups, which checks the caller first.
*/
declare
  -- VC-56: the usual bar.
  c_min_guests constant integer := 2;
  -- VC-59: the "Felt unsafe" bar: this many guests, and this share of raters.
  c_unsafe_min_guests constant integer := 3;
  c_unsafe_min_percent constant integer := 10;
  v_night_start timestamptz := private.night_start(p_now);
  v_raters_tonight integer;
  v_result jsonb;
begin
  -- VC-59: tonight's raters = visible ratings at this event saved since
  -- 5 AM New York (an update moves updated_at, which is still tonight).
  select count(*)::int
  into v_raters_tonight
  from public.ratings r
  where r.event_id = p_event_id
    and r.hidden_at is null
    and r.updated_at >= v_night_start
    and r.updated_at <= p_now;

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
           -- One row per guest per tag (primary key), but say "distinct"
           -- so the rule "different guests" is plain to read.
           count(distinct v.user_id)::int as n,
           coalesce(bool_or(v.user_id = p_uid), false) as mine
    from public.heads_up_votes v
    where v.event_id = p_event_id
      -- VC-45: retired tags are never shown again.
      and v.tag = any (private.heads_up_tags_active())
      -- VC-46: only the last 3 hours.
      and v.created_at >= p_now - interval '3 hours'
      and v.created_at <= p_now
      -- VC-60: "Felt unsafe" counts that night only.
      and (v.tag <> 'felt_unsafe' or v.created_at >= v_night_start)
      -- VC-47: not removed by an admin (the row, or the whole person here).
      and v.hidden_at is null
      and not exists (
        select 1 from private.heads_up_bans b
        where b.event_id = v.event_id and b.user_id = v.user_id
      )
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
    -- The bars. "n * 100 >= percent * raters" is "n is at least 10% of
    -- raters" in whole numbers (no rounding questions).
    having count(distinct v.user_id) >= c_min_guests
       and (v.tag <> 'felt_unsafe'
            or (count(distinct v.user_id) >= c_unsafe_min_guests
                and count(distinct v.user_id) * 100 >= c_unsafe_min_percent * v_raters_tonight))
  ) t;

  return v_result;
end;
$$;

comment on function private.event_heads_ups(uuid, uuid, timestamptz) is
  'VC-45/46/47/56/58/59/60: the heads-up counting core at p_now. Only current tags at 2+ guests; felt_unsafe needs 3+ guests and 10%+ of tonight''s raters, counting tonight only.';

-- -----------------------------------------------------------------------------
-- get_event_heads_ups: as in 20261027170000 (same checks, same answer
-- shape), now counting through private.event_heads_ups.
-- -----------------------------------------------------------------------------
create or replace function public.get_event_heads_ups(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: the event page's heads-up counts (see
  private.event_heads_ups for every rule: 3-hour window, removed and hidden
  +1s left out, retired tags left out, the 2-guest bar and the stricter
  "Felt unsafe" bar).
  Input: p_event_id, the event.
  Returns: a JSON list, most +1s first, e.g.
    [{"tag": "lines_long", "count": 3, "mine": true}, ...]
    Tags under their bar are not in the list at all.
  Rules: any signed-up adult who can see the event (admins too; admins see
  every count, bars or not, on their moderation screens instead).
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

  return private.event_heads_ups(p_event_id, auth.uid(), now());
end;
$$;

comment on function public.get_event_heads_ups(uuid) is
  'VC-43/45/46/47/56/58/59/60: heads-up counts at an event over the last 3 hours (most first), with "mine". Only current tags at 2+ guests; felt_unsafe needs 3+ guests and 10%+ of tonight''s raters, counting tonight only. Excludes hidden tags, removed guests'' +1s and hidden raters'' +1s.';

-- -----------------------------------------------------------------------------
-- admin_set_tag_hidden: as in 20261027160100, but retired tags are accepted
-- (check_known_heads_up_tag), so old reports can still be closed.
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_tag_hidden(
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
    p_event_id, p_tag  the event and the tag (current or retired)
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
  -- VC-45: retired tags allowed here (old reports about them).
  perform private.check_known_heads_up_tag(p_tag);
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
  'VC-58 + VC-45: admins only. Hides or unhides one tag (current or retired) at one event with a logged reason; hiding closes its open reports as hidden.';

-- -----------------------------------------------------------------------------
-- admin_keep_tag: as in 20261027160100, but retired tags are accepted.
-- -----------------------------------------------------------------------------
create or replace function public.admin_keep_tag(
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
  Inputs: the event, the tag (current or retired), the reason
    (no_rule_broken or mistake) and an optional note.
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
  -- VC-45: retired tags allowed here (old reports about them).
  perform private.check_known_heads_up_tag(p_tag);

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
  'VC-58 + VC-45: admins only. Closes a tag''s open reports (current or retired tag) at an event as kept, with a logged reason.';

-- -----------------------------------------------------------------------------
-- Rights. Helpers are private (definer functions call them); the public
-- functions are for signed-in users only, never anon.
-- -----------------------------------------------------------------------------
revoke execute on function private.heads_up_tags_active() from public, anon, authenticated;
revoke execute on function private.heads_up_tags_retired() from public, anon, authenticated;
revoke execute on function private.night_start(timestamptz) from public, anon, authenticated;
revoke execute on function private.check_heads_up_tags(text[]) from public, anon, authenticated;
revoke execute on function private.check_known_heads_up_tag(text) from public, anon, authenticated;
revoke execute on function private.event_heads_ups(uuid, uuid, timestamptz) from public, anon, authenticated;

revoke execute on function public.get_event_heads_ups(uuid) from public, anon;
grant execute on function public.get_event_heads_ups(uuid) to authenticated;

revoke execute on function public.admin_set_tag_hidden(uuid, text, boolean, text, text) from public, anon;
grant execute on function public.admin_set_tag_hidden(uuid, text, boolean, text, text) to authenticated;

revoke execute on function public.admin_keep_tag(uuid, text, text, text) from public, anon;
grant execute on function public.admin_keep_tag(uuid, text, text, text) to authenticated;
