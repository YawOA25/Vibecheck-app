-- =============================================================================
-- Migration 26: bring back the old two-input "Report this tag" function, as a
-- thin wrapper (cto review of VC-65). Follows 20261027180000_gate3_report_reasons.sql,
-- which is already on the dev project and dropped it.
--
-- Why, in plain words: app builds made before VC-65 (the Android APK built
-- from main that the founder is about to install) still call
-- report_heads_up_tag(event, tag) with no reason. Without this function,
-- reporting would break in those builds. The wrapper files the report with
-- NO reason (null), which the admin queue already shows as "No reason". It
-- deliberately does not pretend the guest picked 'other'.
--
-- TEMPORARY: this exists only for builds made before VC-65. Remove it (drop
-- function public.report_heads_up_tag(uuid, text)) before outside testers,
-- so every new report carries a reason. Logged as debt by the cto.
-- =============================================================================

create function public.report_heads_up_tag(p_event_id uuid, p_tag text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
/*
  What it does: files a report about one tag at one event WITHOUT a reason,
  for app builds made before VC-65. Same rules as the three-input version:
  adults who can see the event, one report per person per tag per event,
  10 per person per 24 hours, the reporter never returned.
  Inputs: p_event_id (the event) and p_tag (the tag's key).
  Returns: the same {"status": 'reported' | 'already' | 'too_many'}.
  Raises: as the three-input version (42501, VCNFD, VCTAG).
  Temporary: remove before outside testers (see the file header).
*/
declare
  c_daily_limit constant integer := 10;
  v_uid uuid := auth.uid();
  v_recent integer;
begin
  -- The same checks, lock and limits as report_heads_up_tag(uuid, text, text);
  -- only the reason check is skipped, and the reason is stored as null.
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

  -- One report at a time per person (the same lock key as the new version,
  -- so old and new builds share the limits).
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

  -- reason null = "No reason" in the queue (never 'other').
  insert into private.tag_reports (event_id, tag, reporter_id, reason)
  values (p_event_id, p_tag, v_uid, null);

  return jsonb_build_object('status', 'reported');
end;
$$;

comment on function public.report_heads_up_tag(uuid, text) is
  'TEMPORARY (cto, VC-65): reason-less report for app builds made before VC-65; stores reason null ("No reason"). Remove before outside testers.';

-- Same rights as the three-input version: signed-in users only, never anon.
revoke execute on function public.report_heads_up_tag(uuid, text) from public, anon;
grant execute on function public.report_heads_up_tag(uuid, text) to authenticated;
