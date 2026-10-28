-- =============================================================================
-- Migration: heads-up tags show only once 5 or more guests rated tonight
-- (VC-67, batch Q1 privacy and security). Follows
-- 20261027220100_admins_see_test_event_details.sql, which is already on the
-- dev project, so this file replaces the counting core instead of editing
-- 20261027190000_final_heads_up_tags.sql.
--
-- In plain words:
--   At a tiny event a tag's count can equal everyone there ("2 guests" when
--   only 2 people came), and a guest who adds a +1 and sees the count jump
--   from hidden to "2" learns that exactly one other person picked it. To
--   stop that, NO heads-up tag is shown to anyone on the event page until
--   at least 5 different guests have a visible rating at the event tonight
--   (since 5 AM New York, the start of the event night, VC-60).
--
--   This sits ON TOP of the rules that already exist:
--     - any tag still needs 2 or more different guests (VC-56);
--     - "Felt unsafe" still needs 3+ guests AND 10%+ of tonight's raters,
--       counting tonight's picks only (VC-59, VC-60).
--   So with 4 raters tonight the list is always empty; with 5 or more the
--   usual bars decide.
--
--   "Visible" means the rating isn't hidden by an admin. A guest counts once
--   however many times they update their rating (count distinct user_id).
--
--   It is enforced HERE on the server, so a tag under the bar never leaves
--   the database (no count, no "mine"). Admin moderation screens use their
--   own functions (admin_get_event_tags, admin_get_event_moderation) and
--   still see every count; this file doesn't touch them.
--
-- What this file changes:
--   private.event_heads_ups(uuid, uuid, timestamptz)
--     same inputs and answer shape, plus the 5-raters-tonight bar. Now also
--     security definer (with an empty search_path), like the team rule asks;
--     it still has no grants, so the app can't call it directly. Only
--     public.get_event_heads_ups (unchanged) calls it.
-- =============================================================================

create or replace function private.event_heads_ups(p_event_id uuid, p_uid uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
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
    An empty list ([]) when fewer than 5 guests have rated tonight (VC-67).
  Counted: +1s added (or refreshed) in the 3 hours up to p_now (VC-46).
  Not counted: tags an admin hid at this event (VC-58); any +1 from a guest
  whose +1s an admin removed at this event, including later ones (VC-47);
  +1s from a guest whose rating here is hidden; retired tags (VC-45).
  Shown only when (decided here, so lower counts never leave the server):
    - the event has 5 or more different guests with a visible rating saved
      since 5 AM New York tonight (VC-67). Below that, nothing is shown;
    - any tag: 2 or more different guests (VC-56);
    - felt_unsafe: 3 or more guests AND at least 10% of tonight's raters
      (VC-59), counting only picks made since 5 AM New York tonight (VC-60).
  "mine" says whether p_uid's own counted +1 is among them. Never says who
  else did.
  Who may call it: nobody from the app (no grants); only the definer
  function get_event_heads_ups, which checks the caller first.
*/
declare
  -- VC-67: no tag at all until this many different guests rated tonight.
  c_min_raters_tonight constant integer := 5;
  -- VC-56: the usual bar.
  c_min_guests constant integer := 2;
  -- VC-59: the "Felt unsafe" bar: this many guests, and this share of raters.
  c_unsafe_min_guests constant integer := 3;
  c_unsafe_min_percent constant integer := 10;
  v_night_start timestamptz := private.night_start(p_now);
  v_raters_tonight integer;
  v_result jsonb;
begin
  -- Tonight's raters = different guests with a visible rating at this event
  -- saved since 5 AM New York (an update moves updated_at, which is still
  -- tonight). Used by both VC-67 (the 5-rater bar) and VC-59 (the 10%).
  -- "distinct" so a guest is one person even if the table ever held two
  -- rows for them.
  select count(distinct r.user_id)::int
  into v_raters_tonight
  from public.ratings r
  where r.event_id = p_event_id
    and r.hidden_at is null
    and r.updated_at >= v_night_start
    and r.updated_at <= p_now;

  -- VC-67: too few guests tonight, so any count could point at a person.
  -- Send nothing at all (not even the caller's own "mine").
  if v_raters_tonight < c_min_raters_tonight then
    return '[]'::jsonb;
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
  'VC-45/46/47/56/58/59/60/67: the heads-up counting core at p_now. Nothing until 5+ different guests rated tonight; then only current tags at 2+ guests; felt_unsafe needs 3+ guests and 10%+ of tonight''s raters, counting tonight only.';

-- Keep it closed: "create or replace" keeps old grants, but say it again so
-- this file alone proves nobody in the app can call the core directly.
revoke execute on function private.event_heads_ups(uuid, uuid, timestamptz) from public, anon, authenticated;

-- The public wrapper is unchanged; refresh its description so it names VC-67.
comment on function public.get_event_heads_ups(uuid) is
  'VC-43/45/46/47/56/58/59/60/67: heads-up counts at an event over the last 3 hours (most first), with "mine". Nothing until 5+ different guests rated tonight; then only current tags at 2+ guests; felt_unsafe needs 3+ guests and 10%+ of tonight''s raters, counting tonight only. Excludes hidden tags, removed guests'' +1s and hidden raters'' +1s.';
