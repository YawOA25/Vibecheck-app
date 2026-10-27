-- =============================================================================
-- Migration 24: "Remove +1s" applies to the person for the whole event
-- (VC-47, cto review fix). Follows 20261027160000_admin_moderation.sql and
-- 20261027160100_tag_reports.sql, which are already on the dev project, so
-- this file adds a table and replaces functions instead of editing them.
--
-- The bug, in plain words: "Remove +1s" only marked the +1 rows the guest
-- had at that moment (heads_up_votes.hidden_at). The same guest could then
-- +1 a DIFFERENT tag (add_heads_up, or picking it while rating), and that
-- new row counted. So a brigading account was only slowed down, not stopped.
--
-- The fix: removal is now a per-person, per-event mark, private.heads_up_bans.
-- While a guest has a mark at an event, NONE of their +1s there count, old or
-- new. "Restore +1s" deletes the mark (and clears the old rows' hidden_at).
-- The guest isn't told: their +1 still answers 'added', so a brigader can't
-- tell when they've been caught (the same as a hidden rating).
--
-- What this file changes:
--   private.heads_up_bans               new table (private, RLS on, no grants)
--   public.admin_set_heads_ups_hidden() sets or lifts the mark (and the rows)
--   public.get_event_heads_ups()        skips marked guests
--   private.counted_tag_votes()         skips marked guests
--   public.admin_get_event_moderation() shows a marked guest's +1s as removed
--                                       (also ones added after the removal),
--                                       plus "heads_ups_removed"
-- Existing removed rows (from before this file) get a mark, so nothing that
-- was removed starts counting again.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table: guests whose +1s don't count at one event. Private, RLS on, no
-- policies, no grants: only the definer functions use it.
-- -----------------------------------------------------------------------------
create table private.heads_up_bans (
  event_id uuid not null references public.events (id) on delete cascade,
  -- Deleting the guest's account deletes the mark (their +1s go too).
  user_id uuid not null references public.profiles (id) on delete cascade,
  banned_at timestamptz not null default now(),
  -- The admin who removed them (null if that admin's account is deleted).
  banned_by uuid references public.profiles (id) on delete set null,
  primary key (event_id, user_id)
);

comment on table private.heads_up_bans is
  'VC-47 (cto fix): guests whose +1s don''t count at one event, including +1s they add later. Set by "Remove +1s", deleted by "Restore +1s".';

revoke all on table private.heads_up_bans from public, anon, authenticated;
alter table private.heads_up_bans enable row level security;

comment on column public.heads_up_votes.hidden_at is
  'VC-47: set when an admin removes this +1 (history). Whether a guest''s +1s count is decided by private.heads_up_bans, which also covers +1s added after the removal.';

-- Carry over removals made before this file.
insert into private.heads_up_bans (event_id, user_id, banned_at)
select v.event_id, v.user_id, min(v.hidden_at)
from public.heads_up_votes v
where v.hidden_at is not null
group by v.event_id, v.user_id
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- admin_set_heads_ups_hidden: now sets or lifts the per-event mark.
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_heads_ups_hidden(
  p_event_id uuid,
  p_user_id uuid,
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
  What it does: removes (or restores) one person's heads-up +1s at one event,
  for the whole event, and logs it. While removed, none of their +1s there
  count, including ones they add later (any tag). Works whether or not they
  rated.
  Inputs:
    p_event_id, p_user_id  the event and the guest
    p_hidden               true = remove, false = restore
    p_reason               removing: not_checked_in, coordinated or
                           broke_tester_rules; restoring: no_rule_broken or
                           mistake
    p_note                 optional admin-only note (500 characters at most)
  Returns: {"status": "done"}, or {"status": "unchanged"} when they were
    already removed (or already not removed). Nothing is logged then.
  Why no republish: +1s aren't part of the score.
  Raises: 42501 non-admins, VCRSN a reason that doesn't fit, VCNFD the
    person has no +1s at this event.
*/
declare
  v_changed integer;
begin
  perform private.require_admin();
  perform private.check_moderation_reason(coalesce(p_hidden, false), p_reason, p_note);
  if p_hidden is null then
    raise exception 'Say whether to remove or restore.' using errcode = 'VCRSN';
  end if;
  if not exists (
    select 1 from public.heads_up_votes v
    where v.event_id = p_event_id and v.user_id = p_user_id
  ) then
    raise exception 'That person has no heads-ups here.' using errcode = 'VCNFD';
  end if;

  -- The mark decides. Two admins at once: the primary key keeps one mark,
  -- and only the call that changed it logs.
  if p_hidden then
    insert into private.heads_up_bans (event_id, user_id, banned_by)
    values (p_event_id, p_user_id, auth.uid())
    on conflict do nothing;
  else
    delete from private.heads_up_bans b
    where b.event_id = p_event_id and b.user_id = p_user_id;
  end if;
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    return jsonb_build_object('status', 'unchanged');
  end if;

  -- The rows' own flag, kept in step for the record.
  update public.heads_up_votes v
  set hidden_at = case when p_hidden then now() end
  where v.event_id = p_event_id
    and v.user_id = p_user_id
    and (v.hidden_at is null) = p_hidden;

  insert into private.moderation_log (admin_id, action, event_id, target_user_id, reason, note)
  values (auth.uid(), case when p_hidden then 'remove_heads_ups' else 'restore_heads_ups' end,
          p_event_id, p_user_id, p_reason, nullif(btrim(p_note), ''));

  return jsonb_build_object('status', 'done');
end;
$$;

comment on function public.admin_set_heads_ups_hidden(uuid, uuid, boolean, text, text) is
  'VC-47: admins only. Removes or restores one person''s +1s at an event for the whole event (later +1s included), with a logged reason.';

-- -----------------------------------------------------------------------------
-- counted_tag_votes: as in 20261027160100, plus marked guests don't count.
-- -----------------------------------------------------------------------------
create or replace function private.counted_tag_votes(p_event_id uuid, p_tag text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  /*
    What it does: counts the +1s for one tag at one event that still count:
    not from a guest whose +1s an admin removed at this event (any time, so
    later +1s too), and not from a guest whose rating there is hidden.
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
      select 1 from private.heads_up_bans b
      where b.event_id = v.event_id and b.user_id = v.user_id
    )
    and not exists (
      select 1 from public.ratings r
      where r.user_id = v.user_id and r.event_id = v.event_id and r.hidden_at is not null
    );
$$;

comment on function private.counted_tag_votes(uuid, text) is
  'VC-58: counted +1s (not from removed guests, not from hidden raters) for one tag at one event, all night.';

-- -----------------------------------------------------------------------------
-- get_event_heads_ups: as in 20261027160100, plus marked guests don't count.
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
  Not counted: tags an admin hid at this event (VC-58); any +1 from a guest
  whose +1s an admin removed at this event, including +1s they add later
  (VC-47); and +1s from a guest whose rating here is hidden.
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
  ) t;

  return v_result;
end;
$$;

comment on function public.get_event_heads_ups(uuid) is
  'VC-43 + VC-46 + VC-47 + VC-58: counts of heads-up tags at an event over the last 3 hours (most first), with "mine". Excludes hidden tags, removed guests'' +1s (later ones too) and +1s from guests whose rating there is hidden.';

-- -----------------------------------------------------------------------------
-- admin_get_event_moderation: as in 20261027160000, but a removed guest's +1s
-- all show as removed (also ones added afterwards), plus "heads_ups_removed".
-- -----------------------------------------------------------------------------
create or replace function public.admin_get_event_moderation(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: lists everyone who rated or +1'd at an event, with what they
  said, plus the latest moderation decisions there. Admins only.
  Input: p_event_id, the event (test events included).
  Returns: JSON
    {
      "people": [ {
          "user_id", "display_name",
          "joined_at"          when the account was made (very new accounts
                               are a brigading sign),
          "check_in_method"    'gps', 'code', 'tester' or null,
          "rating"             null, or {crowd, music, energy, score,
                               reaction, updated_at, hidden},
          "heads_ups_removed"  true while their +1s here are removed,
          "heads_ups"          [{tag, added_at, removed}]
        }, ... ]               newest activity first,
      "log": [ {at, action, reason, note, tag, admin_name, target_name} ]
                               the 50 newest decisions at this event
    }
  Who reported a tag is never listed (VC-58).
  Raises: 42501 for non-admins, VCNFD for an unknown event.
*/
declare
  v_people jsonb;
  v_log jsonb;
begin
  perform private.require_admin();
  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'That event doesn''t exist.' using errcode = 'VCNFD';
  end if;

  select coalesce(jsonb_agg(person.item order by person.last_activity desc, person.name), '[]'::jsonb)
  into v_people
  from (
    select
      jsonb_build_object(
        'user_id', p.id,
        'display_name', p.display_name,
        'joined_at', p.created_at,
        'check_in_method', c.method,
        'rating', case when r.user_id is null then null else jsonb_build_object(
          'crowd', r.crowd,
          'music', r.music,
          'energy', r.energy,
          'score', round(r.score, 1),
          'reaction', r.reaction,
          'updated_at', r.updated_at,
          'hidden', r.hidden_at is not null
        ) end,
        'heads_ups_removed', b.user_id is not null,
        'heads_ups', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'tag', v.tag,
                   'added_at', v.created_at,
                   -- Removed when the row was, or the person is removed here.
                   'removed', v.hidden_at is not null or b.user_id is not null)
                 order by v.tag)
          from public.heads_up_votes v
          where v.event_id = p_event_id and v.user_id = p.id
        ), '[]'::jsonb)
      ) as item,
      -- Sort key: the person's newest rating or +1.
      greatest(
        r.updated_at,
        (select max(v.created_at) from public.heads_up_votes v
         where v.event_id = p_event_id and v.user_id = p.id)
      ) as last_activity,
      p.display_name as name
    from (
      select r2.user_id from public.ratings r2 where r2.event_id = p_event_id
      union
      select v2.user_id from public.heads_up_votes v2 where v2.event_id = p_event_id
    ) who
    join public.profiles p on p.id = who.user_id
    left join public.ratings r on r.user_id = p.id and r.event_id = p_event_id
    left join public.check_ins c on c.user_id = p.id and c.event_id = p_event_id
    left join private.heads_up_bans b on b.user_id = p.id and b.event_id = p_event_id
  ) person;

  select coalesce(jsonb_agg(entry.item order by entry.at desc), '[]'::jsonb)
  into v_log
  from (
    select l.at,
           jsonb_build_object(
             'at', l.at,
             'action', l.action,
             'reason', l.reason,
             'note', l.note,
             'tag', l.tag,
             'admin_name', a.display_name,
             'target_name', t.display_name
           ) as item
    from private.moderation_log l
    left join public.profiles a on a.id = l.admin_id
    left join public.profiles t on t.id = l.target_user_id
    where l.event_id = p_event_id
    order by l.at desc, l.id desc
    limit 50
  ) entry;

  return jsonb_build_object('people', v_people, 'log', v_log);
end;
$$;

comment on function public.admin_get_event_moderation(uuid) is
  'VC-47: admins only. Everyone who rated or +1''d at an event (name, account age, check-in method, rating, +1s with removed flags, heads_ups_removed) and the 50 newest moderation decisions there. Never lists reporters.';

-- -----------------------------------------------------------------------------
-- Rights, restated so this file stands on its own ("create or replace" keeps
-- the old ones, but say it again).
-- -----------------------------------------------------------------------------
revoke execute on function public.admin_set_heads_ups_hidden(uuid, uuid, boolean, text, text) from public, anon;
grant execute on function public.admin_set_heads_ups_hidden(uuid, uuid, boolean, text, text) to authenticated;

revoke execute on function public.get_event_heads_ups(uuid) from public, anon;
grant execute on function public.get_event_heads_ups(uuid) to authenticated;

revoke execute on function public.admin_get_event_moderation(uuid) from public, anon;
grant execute on function public.admin_get_event_moderation(uuid) to authenticated;

revoke execute on function private.counted_tag_votes(uuid, text) from public, anon, authenticated;
