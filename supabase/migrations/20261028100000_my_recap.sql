-- =============================================================================
-- Migration 34: the next-morning recap and the "Nights out" list (VC-B12).
-- Follows 20261027230000_tags_need_five_raters.sql. New functions only; no
-- table changes.
--
-- What the app gets, in plain words:
--   * get_my_recap()            the events YOU rated in the last 36 hours
--                               (the "Your night" screen the 11 AM
--                               notification opens).
--   * get_my_recap(p_all=>true) every event you rated, newest first, at most
--                               50 (the "Nights out" list on the Me screen).
-- Each item holds the event's public details, YOUR OWN rating (your three
-- words and your reaction, which you could already read yourself), and the
-- event's PUBLISHED vibe: exactly the JSON the event page gets from
-- private.published_vibe, read at the same moment.
--
-- Why 36 hours: the notification fires at 11 AM the morning after the
-- night (the app works it out, src/lib/recap.ts). The latest a rating can
-- be saved before its 11 AM is just before 5 AM (6 hours ahead), the
-- earliest just after 5 AM the day before (30 hours ahead, 31 on the night
-- the clocks go back). So 36 hours
-- always covers the morning the notification arrives, with a few hours to
-- spare for opening it late.
--
-- Privacy (the cto's rules for this task):
--   * Nothing is worked out fresh. The vibe is the published snapshot, the
--     same numbers and words anyone sees on the event page, so the recap
--     can't reveal more than the event page already does.
--   * The night is words only (published_vibe never sends a night number).
--   * The reactions are the published tally, which is empty under 5 raters.
--   * When the snapshot hides the score ('none' or 'early', or the night
--     word withheld), the recap item hides it too, because it IS that
--     snapshot.
--   * Your own rating is never put next to an unpublished average; the only
--     averages anywhere in the answer are the published ones.
--   * A rating an admin hid is left out (it counts nowhere, VC-47), and so is
--     a test event you can no longer see.
--
-- New error codes: none (42501 for a caller who isn't a signed-up adult,
-- the same as get_event_vibe).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Private core: the recap at a given moment (pgTAP pins the moment).
-- -----------------------------------------------------------------------------
create function private.my_recap(p_now timestamptz, p_all boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  /*
    What it does: lists the caller's own rated events with the published
    vibe of each.
    Inputs: p_now (the moment; the app function passes the real time, tests
      a fixed one) and p_all (false: only ratings saved in the 36 hours up to
      p_now; true: every rating, newest event first, at most 50).
    Returns: a JSON list, newest event first (then by id, so the order is
      stable), each item:
        event_id, title, area_label, starts_at, ends_at   public event facts
        rated_at   when the caller last saved this rating
        mine       {crowd, music, energy (1-3 each), reaction (or null),
                    label (the word for the caller's own score)}
        vibe       private.published_vibe(event, p_now), unchanged
      An empty list when there is nothing to show.
    Why `security definer`: the published snapshot lives in a private table
    the app can't read. The caller's own ratings are picked by auth.uid(),
    so nobody can ask for someone else's recap.
  */
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'event_id', t.event_id,
             'title', t.title,
             'area_label', t.area_label,
             'starts_at', t.starts_at,
             'ends_at', t.ends_at,
             'rated_at', t.rated_at,
             'mine', jsonb_build_object(
               'crowd', t.crowd,
               'music', t.music,
               'energy', t.energy,
               'reaction', t.reaction,
               -- The same rounding as the live score (1 decimal), then the
               -- same word boundaries (private.vibe_label).
               'label', private.vibe_label(round(t.score, 1))),
             -- The event page's own answer, read at the same moment.
             'vibe', private.published_vibe(t.event_id, p_now))
           order by t.starts_at desc, t.event_id), '[]'::jsonb)
  from (
    -- Pick the rows first (with the limit), then build the JSON for only
    -- those, so the snapshot is read at most 50 times.
    select e.id as event_id, e.title, e.area_label, e.starts_at, e.ends_at,
           r.updated_at as rated_at, r.crowd, r.music, r.energy, r.reaction, r.score
    from public.ratings r
    join public.events e on e.id = r.event_id
    where r.user_id = auth.uid()
      -- A rating an admin hid counts nowhere, the recap included.
      and r.hidden_at is null
      -- Nothing from "the future" when a test pins an earlier moment.
      and r.updated_at <= p_now
      -- The morning recap: saved within the last 36 hours (see the header).
      and (p_all or r.updated_at > p_now - interval '36 hours')
      -- Same rule as the events list: test events only for testers/admins.
      and (not e.is_test or private.can_read_test_events())
    order by e.starts_at desc, e.id
    limit 50
  ) t;
$$;

comment on function private.my_recap(timestamptz, boolean) is
  'VC-B12: the caller''s own rated events (last 36 hours, or all up to 50) with their own rating and the PUBLISHED vibe (private.published_vibe). Hidden ratings excluded.';

-- The app can never call the core directly (it would pick its own moment).
revoke execute on function private.my_recap(timestamptz, boolean) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- get_my_recap: what the app calls.
-- -----------------------------------------------------------------------------
create function public.get_my_recap(p_all boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: the caller's recap, right now.
  Input: p_all, false (the default) for the morning recap (last 36 hours),
    true for the whole "Nights out" list (at most 50, newest first).
  Returns: the JSON list from private.my_recap.
  Rules: any signed-up adult (admins can't rate, so theirs is empty).
  Raises: 42501 when not signed in or not a signed-up adult.
*/
begin
  if auth.uid() is null or not private.is_adult_user() then
    raise exception 'Please sign in and finish setting up your profile first.'
      using errcode = '42501';
  end if;
  return private.my_recap(now(), coalesce(p_all, false));
end;
$$;

comment on function public.get_my_recap(boolean) is
  'VC-B12: the caller''s next-morning recap (p_all false: last 36 hours) or Nights out list (p_all true: up to 50). Own rating plus the published vibe only.';

-- Signed-in people only; anon (not signed in) can't call it at all.
revoke execute on function public.get_my_recap(boolean) from public, anon;
grant execute on function public.get_my_recap(boolean) to authenticated;
