-- =============================================================================
-- Migration: the profile stats row on the Me screen (VC-81, founder approved
-- 2026-10-29, built with VC-80). Follows 20261029110000_map_points.sql.
-- One new read-only function; no table changes.
--
-- What the app gets, in plain words:
--   get_my_stats() -> {"nights_out": 4, "ratings": 7, "member_since": "..."}
--     nights_out    how many different event nights YOU checked in to (two
--                   parties on the same night count once; a night runs 5 AM
--                   to 5 AM New York, private.night_start);
--     ratings       how many events YOU rated (one rating per event; a
--                   rating an admin hid is left out, as everywhere, VC-47);
--     member_since  when your profile was made (profiles.created_at).
--
-- Privacy (the rules for VC-81):
--   * Only the caller's own rows, picked by auth.uid(). There is no input at
--     all, so nobody can ask for someone else's numbers.
--   * Counts only: no event names, no scores, no rating values. The caller
--     could already read every one of these rows themselves (RLS lets each
--     person read their own check-ins and ratings), so nothing new leaves
--     the database; this just counts them in one round trip.
--   * Test events count only for people who may see them (the same rule as
--     the list and the recap), so a tester's count never mentions an event a
--     plain user couldn't see.
--
-- New error codes: none (42501 for a caller who isn't a signed-up adult,
-- the same as get_my_recap).
-- =============================================================================

create function public.get_my_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
/*
  What it does: counts the caller's own nights out and ratings, and says
  when they joined.
  Inputs: none (the caller is auth.uid()).
  Returns: {"nights_out": int, "ratings": int, "member_since": timestamptz}.
  Rules: any signed-up adult (an admin, who can't rate, gets 0 ratings).
  Raises: 42501 when not signed in or not a signed-up adult.
  Why `security definer`: private.night_start and the test-event rule live
  in the private schema, which the app can't call directly. The rows are
  still picked by auth.uid() only.
*/
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.is_adult_user() then
    raise exception 'Please sign in and finish setting up your profile first.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    -- Different event nights with a check-in (the night the event starts in).
    'nights_out', (
      select count(distinct private.night_start(e.starts_at))
      from public.check_ins c
      join public.events e on e.id = c.event_id
      where c.user_id = v_uid
        and (not e.is_test or private.can_read_test_events())),
    -- Events rated (one row per event), without hidden ratings.
    'ratings', (
      select count(*)
      from public.ratings r
      join public.events e on e.id = r.event_id
      where r.user_id = v_uid
        and r.hidden_at is null
        and (not e.is_test or private.can_read_test_events())),
    'member_since', (
      select p.created_at from public.profiles p where p.id = v_uid));
end;
$$;

comment on function public.get_my_stats() is
  'VC-81: the caller''s own counts for the Me screen: distinct event nights checked in to, unhidden ratings, and profile created_at. Own rows only (auth.uid()).';

-- Signed-in people only; anon (not signed in) can't call it at all.
revoke execute on function public.get_my_stats() from public, anon;
grant execute on function public.get_my_stats() to authenticated;
