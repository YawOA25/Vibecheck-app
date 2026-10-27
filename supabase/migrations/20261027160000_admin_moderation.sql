-- =============================================================================
-- Migration 22: the admin moderation screen for ratings and +1s (proposal
-- VC-47, approved by the founder 2026-10-27, "4-13 approve").
-- Follows 20261027150000_vibe_publish_fixes.sql, which is already on the dev
-- project, so this file adds and replaces functions instead of editing
-- older files.
--
-- Plain-language background:
-- * Until now an admin hid an abusive rating by setting ratings.hidden_at by
--   hand in the SQL Editor, then republished the score by hand. This file
--   gives the app an admin-only way to do both in one tap, with a reason.
-- * A guest can also "+1" heads-up tags WITHOUT rating (add_heads_up). Hiding
--   a rating already drops that person's +1s, but someone who never rated
--   had no off switch. Each +1 now has its own hidden_at ("removed").
-- * Every action is written to a moderation log with a reason picked from a
--   fixed list. The list is the written removal rule from the legal review
--   (team/projects/vibecheck/legal/phase0-consents-2026-10-27.md, section 5):
--   remove only when the people weren't really there, the picks look
--   coordinated (brigading), or someone broke the tester rules. There is
--   deliberately NO reason like "the venue asked": who complains doesn't
--   change the rule (FTC fake-review rule, 16 CFR 465).
--
-- What this file adds:
--   private.moderation_log            one row per admin action (both VC-47
--                                     and VC-58 actions; the tag actions are
--                                     used by the next file)
--   heads_up_votes.hidden_at          a removed +1 (kept, but counted nowhere)
--   private.require_admin()           raises 42501 unless the caller is an
--                                     adult admin
--   private.check_moderation_reason() checks the reason fits the action
--   private.republish_vibe_after_moderation()
--                                     republishes the event's score snapshot
--                                     under its per-event lock
--   public.admin_get_event_moderation()   what the admin screen lists
--   public.admin_set_rating_hidden()      hide or unhide one rating
--   public.admin_set_heads_ups_hidden()   remove or restore one person's +1s
--   public.get_event_heads_ups()          now skips removed +1s
--
-- Why republishing is careful (VC-51): the published score only moves once
-- 2+ new people have rated, so polling can't reveal one person's rating. If
-- exactly ONE new rating is waiting when an admin hides something,
-- publishing "as of now" would release that single rating. So in that case
-- the snapshot is re-made as of its OWN earlier moment (only the hidden
-- rating drops out) and the waiting rating stays waiting. With 0 or 2+
-- waiting it is published as of now, which the gate would allow anyway.
-- Accepted limit (already in the README): the change caused by a hide shows
-- roughly what the hidden rating was. It's the abuser's rating, and only
-- admins hide.
--
-- Errors raised:
--   42501  not signed in, not an adult, or not an admin
--   VCNFD  no such event, or that person has no rating there
--   VCRSN  a reason that doesn't fit the action, or a note over 500 characters
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table: the moderation log. Private schema, RLS on, no policies, no grants:
-- only the admin functions (running as the owner) read and write it.
-- -----------------------------------------------------------------------------
create table private.moderation_log (
  -- A simple counter id; nothing outside the database refers to it.
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- The admin who acted. Kept as null if that admin's account is deleted,
  -- so the decision itself stays on record.
  admin_id uuid references public.profiles (id) on delete set null,
  -- What was done. The first three remove something, the rest restore or
  -- keep something (the reason rule below depends on which).
  action text not null check (action in (
    'hide_rating', 'remove_heads_ups', 'hide_tag',
    'unhide_rating', 'restore_heads_ups', 'unhide_tag', 'keep_tag'
  )),
  event_id uuid not null references public.events (id) on delete cascade,
  -- The guest it was about (rating and +1 actions); null for tag actions.
  -- Deleting that guest's account blanks it (their data goes, the decision
  -- stays).
  target_user_id uuid references public.profiles (id) on delete set null,
  -- The tag (tag actions only). Not limited to a fixed list here, because
  -- the tag list is about to change (VC-45); the functions check it.
  tag text,
  -- Why. The written removal rule (legal review, section 5):
  --   not_checked_in      the people weren't genuinely there
  --   coordinated         coordinated or brigading pattern (new accounts,
  --                       same device, a sudden burst)
  --   broke_tester_rules  broke the tester rules (e.g. targeting a person)
  -- and for restoring or keeping:
  --   no_rule_broken      reviewed; none of the above applies
  --   mistake             undoing an earlier admin mistake
  reason text not null check (reason in (
    'not_checked_in', 'coordinated', 'broke_tester_rules', 'no_rule_broken', 'mistake'
  )),
  -- Optional admin-only words, never shown to guests.
  note text check (note is null or char_length(note) <= 500),
  -- The rule itself, so even a hand-written insert can't break it: removals
  -- need a removal reason, restores and keeps need a restore reason.
  constraint moderation_log_reason_fits check (
    (action in ('hide_rating', 'remove_heads_ups', 'hide_tag')
       and reason in ('not_checked_in', 'coordinated', 'broke_tester_rules'))
    or (action in ('unhide_rating', 'restore_heads_ups', 'unhide_tag', 'keep_tag')
       and reason in ('no_rule_broken', 'mistake'))
  )
);

comment on table private.moderation_log is
  'VC-47 + VC-58: one row per admin moderation action, with a reason from the written removal rule. Admin-only (no grants).';
comment on column private.moderation_log.admin_id is 'The admin who acted (null if their account was deleted).';
comment on column private.moderation_log.action is 'hide_rating, remove_heads_ups, hide_tag (removals) or unhide_rating, restore_heads_ups, unhide_tag, keep_tag.';
comment on column private.moderation_log.target_user_id is 'The guest a rating or +1 action was about; null for tag actions.';
comment on column private.moderation_log.tag is 'The heads-up tag (tag actions only).';
comment on column private.moderation_log.reason is 'not_checked_in, coordinated, broke_tester_rules (removals); no_rule_broken, mistake (restores and keeps).';
comment on column private.moderation_log.note is 'Optional admin-only note, at most 500 characters.';

create index moderation_log_event_idx on private.moderation_log (event_id, at desc);

revoke all on table private.moderation_log from public, anon, authenticated;
alter table private.moderation_log enable row level security;

-- -----------------------------------------------------------------------------
-- A removed +1: kept for the record, but counted nowhere. On its own this
-- only covers the rows that existed at the time: the same guest could still
-- +1 a DIFFERENT tag afterwards. 20261027170000_heads_up_bans.sql fixes that
-- (cto review): "Remove +1s" now applies to the person for the whole event.
-- -----------------------------------------------------------------------------
alter table public.heads_up_votes add column hidden_at timestamptz;

comment on column public.heads_up_votes.hidden_at is
  'VC-47: set when an admin removes this +1. Removed +1s count nowhere; a later +1 of the same tag by the same person stays removed.';

-- -----------------------------------------------------------------------------
-- Helper: only adult admins get past this line.
-- -----------------------------------------------------------------------------
create function private.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: refuses anyone who isn't a signed-in adult admin.
  Inputs: none; it uses auth.uid(), the caller.
  Returns: nothing, or raises 42501 ("insufficient privilege").
  Why: every moderation function starts with this one line, so the rule
  can't differ between them. The app hides the screens from non-admins too,
  but this server check is the one that counts.
*/
begin
  if auth.uid() is null or not private.is_adult_user() or not private.is_admin() then
    raise exception 'Only admins can moderate.' using errcode = '42501';
  end if;
end;
$$;

comment on function private.require_admin() is
  'VC-47: raises 42501 unless the caller is a signed-in adult admin.';

-- -----------------------------------------------------------------------------
-- Helper: does the reason fit the action?
-- -----------------------------------------------------------------------------
create function private.check_moderation_reason(p_removing boolean, p_reason text, p_note text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
/*
  What it does: checks an admin's reason (and note) before anything changes.
  Inputs:
    p_removing  true when hiding or removing, false when restoring or keeping
    p_reason    the picked reason
    p_note      the optional note
  Returns: nothing, or raises VCRSN with a sentence the app can show.
  Why: the log table refuses a mismatch too, but with a vague error and
  only at the very end. The written rule (legal review, section 5) only
  allows removal for the three listed reasons.
*/
begin
  if p_removing and (p_reason is null or p_reason not in ('not_checked_in', 'coordinated', 'broke_tester_rules')) then
    raise exception 'Pick why: not really there, coordinated, or broke the tester rules.'
      using errcode = 'VCRSN';
  end if;
  if not p_removing and (p_reason is null or p_reason not in ('no_rule_broken', 'mistake')) then
    raise exception 'Pick why: no rule broken, or it was a mistake.' using errcode = 'VCRSN';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'Keep the note to 500 characters or fewer.' using errcode = 'VCRSN';
  end if;
end;
$$;

comment on function private.check_moderation_reason(boolean, text, text) is
  'VC-47: raises VCRSN unless the reason fits (removals: not_checked_in, coordinated, broke_tester_rules; restores: no_rule_broken, mistake) and the note is at most 500 characters.';

-- -----------------------------------------------------------------------------
-- Helper: republish an event's score after a hide or unhide.
-- -----------------------------------------------------------------------------
create function private.republish_vibe_after_moderation(p_event_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: makes the event's published score reflect a rating that was
  just hidden or unhidden, without releasing a single waiting rating.
  Input: p_event_id, the event.
  Returns: nothing.
  Rules:
    - takes the per-event publish lock first (the same one submit_rating and
      publish_event_vibe take), so the count below can't race a guest's
      publish;
    - no snapshot yet: nothing is shown, so there's nothing to fix;
    - exactly 1 visible rating saved since the snapshot: re-make the snapshot
      as of its own moment (that rating stays waiting, VC-51);
    - otherwise (0, or 2+ waiting, which the gate would publish anyway):
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

  if v_waiting = 1 then
    perform private.publish_event_vibe(p_event_id, v_published_at);
  else
    perform private.publish_event_vibe(p_event_id, now());
  end if;
end;
$$;

comment on function private.republish_vibe_after_moderation(uuid) is
  'VC-47: republishes the event''s snapshot under the per-event lock after a hide or unhide; as of the snapshot''s own moment when exactly 1 new rating is waiting (so it isn''t released alone), otherwise as of now.';

-- -----------------------------------------------------------------------------
-- admin_get_event_moderation: what the admin screen lists for one event.
-- -----------------------------------------------------------------------------
create function public.admin_get_event_moderation(p_event_id uuid)
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
          "joined_at"        when the account was made (very new accounts
                             are a brigading sign),
          "check_in_method"  'gps', 'code', 'tester' or null,
          "rating"           null, or {crowd, music, energy, score, reaction,
                             updated_at, hidden},
          "heads_ups"        [{tag, added_at, removed}]
        }, ... ]             newest activity first,
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
        'heads_ups', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'tag', v.tag, 'added_at', v.created_at, 'removed', v.hidden_at is not null)
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
  'VC-47: admins only. Everyone who rated or +1''d at an event (name, account age, check-in method, rating, +1s with hidden flags) and the 50 newest moderation decisions there. Never lists reporters.';

-- -----------------------------------------------------------------------------
-- admin_set_rating_hidden: hide or unhide one guest's rating.
-- -----------------------------------------------------------------------------
create function public.admin_set_rating_hidden(
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
  What it does: hides (or unhides) one guest's rating at one event, logs the
  decision with its reason, and republishes the event's score.
  Inputs:
    p_event_id, p_user_id  the event and the guest
    p_hidden               true to hide, false to unhide
    p_reason               hiding: not_checked_in, coordinated or
                           broke_tester_rules; unhiding: no_rule_broken or
                           mistake
    p_note                 optional admin-only note (500 characters at most)
  Returns: {"status": "done"} or {"status": "unchanged"} (already that way:
    nothing is logged or republished).
  Side effects: a hidden guest's +1s at this event stop counting too (the
    existing rule in get_event_heads_ups).
  Raises: 42501 non-admins, VCRSN a reason that doesn't fit, VCNFD no rating.
*/
declare
  v_was_hidden boolean;
begin
  perform private.require_admin();
  perform private.check_moderation_reason(coalesce(p_hidden, false), p_reason, p_note);
  if p_hidden is null then
    raise exception 'Say whether to hide or unhide.' using errcode = 'VCRSN';
  end if;

  -- Lock the rating row (FOR UPDATE), so two admins can't both act on it.
  select r.hidden_at is not null into v_was_hidden
  from public.ratings r
  where r.event_id = p_event_id and r.user_id = p_user_id
  for update;
  if not found then
    raise exception 'That rating doesn''t exist.' using errcode = 'VCNFD';
  end if;
  if v_was_hidden = p_hidden then
    return jsonb_build_object('status', 'unchanged');
  end if;

  update public.ratings r
  set hidden_at = case when p_hidden then now() end
  where r.event_id = p_event_id and r.user_id = p_user_id;

  insert into private.moderation_log (admin_id, action, event_id, target_user_id, reason, note)
  values (auth.uid(), case when p_hidden then 'hide_rating' else 'unhide_rating' end,
          p_event_id, p_user_id, p_reason, nullif(btrim(p_note), ''));

  -- After the row change (see the helper for why this order avoids a deadlock).
  perform private.republish_vibe_after_moderation(p_event_id);

  return jsonb_build_object('status', 'done');
end;
$$;

comment on function public.admin_set_rating_hidden(uuid, uuid, boolean, text, text) is
  'VC-47: admins only. Hides or unhides one rating with a logged reason, then republishes the event''s score snapshot under its lock.';

-- -----------------------------------------------------------------------------
-- admin_set_heads_ups_hidden: remove or restore one person's +1s at an event.
-- -----------------------------------------------------------------------------
create function public.admin_set_heads_ups_hidden(
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
  What it does: removes (or restores) all of one person's heads-up +1s at
  one event, and logs it. Works whether or not they rated: that is the point
  (someone who only +1'd had no off switch before).
  Inputs: as admin_set_rating_hidden (p_hidden true = remove).
  Returns: {"status": "done"}, or {"status": "unchanged"} when there was
    nothing to change (nothing logged).
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

  update public.heads_up_votes v
  set hidden_at = case when p_hidden then now() end
  where v.event_id = p_event_id
    and v.user_id = p_user_id
    and (v.hidden_at is null) = p_hidden;
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    return jsonb_build_object('status', 'unchanged');
  end if;

  insert into private.moderation_log (admin_id, action, event_id, target_user_id, reason, note)
  values (auth.uid(), case when p_hidden then 'remove_heads_ups' else 'restore_heads_ups' end,
          p_event_id, p_user_id, p_reason, nullif(btrim(p_note), ''));

  return jsonb_build_object('status', 'done');
end;
$$;

comment on function public.admin_set_heads_ups_hidden(uuid, uuid, boolean, text, text) is
  'VC-47: admins only. Removes or restores all of one person''s +1s at an event (rated or not), with a logged reason.';

-- -----------------------------------------------------------------------------
-- get_event_heads_ups: as in 20261027140100, plus removed +1s don't count.
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
  Not counted: +1s an admin removed (VC-47), and +1s from a guest whose
  rating here is hidden. "mine" says whether the caller's own counted +1 is
  among them. Never says who else did.
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
  'VC-43 + VC-46 + VC-47: counts of heads-up tags at an event over the last 3 hours (most first), with "mine". Excludes removed +1s and +1s from guests whose rating there is hidden.';

-- -----------------------------------------------------------------------------
-- Rights: signed-in users may call the public functions (the admin check
-- inside refuses everyone but admins); anon can't call them; nobody from the
-- app can call the private helpers.
-- -----------------------------------------------------------------------------
revoke execute on function public.admin_get_event_moderation(uuid) from public, anon;
grant execute on function public.admin_get_event_moderation(uuid) to authenticated;

revoke execute on function public.admin_set_rating_hidden(uuid, uuid, boolean, text, text) from public, anon;
grant execute on function public.admin_set_rating_hidden(uuid, uuid, boolean, text, text) to authenticated;

revoke execute on function public.admin_set_heads_ups_hidden(uuid, uuid, boolean, text, text) from public, anon;
grant execute on function public.admin_set_heads_ups_hidden(uuid, uuid, boolean, text, text) to authenticated;

revoke execute on function public.get_event_heads_ups(uuid) from public, anon;
grant execute on function public.get_event_heads_ups(uuid) to authenticated;

revoke execute on function private.require_admin() from public, anon, authenticated;
revoke execute on function private.check_moderation_reason(boolean, text, text) from public, anon, authenticated;
revoke execute on function private.republish_vibe_after_moderation(uuid) from public, anon, authenticated;
