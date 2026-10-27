-- =============================================================================
-- Migration 28: a rating from an older app build that picked a retired tag
-- is saved without that tag (cto review of VC-45). Follows
-- 20261027190000_final_heads_up_tags.sql, which is already on the dev
-- project, so this file replaces submit_rating instead of editing it.
--
-- The problem, in plain words: VC-45 retired three tags (music_fire,
-- packed, good_crowd). App builds made before VC-45 (the founder's Android
-- APK) still show them. Picking one made the server refuse the WHOLE
-- rating ("That heads-up isn't one we know"), so the guest lost their taps.
--
-- The fix: submit_rating now drops retired tags quietly and saves the
-- rating and the other tags. Nothing else changes:
--   - an unknown tag (never existed) is still refused with VCTAG;
--   - add_heads_up and both report_heads_up_tag functions still refuse
--     retired tags (an old build only shows those buttons for tags the
--     server sends, and it never sends retired ones);
--   - get_event_heads_ups never shows retired tags.
--
-- TEMPORARY: only for builds made before VC-45. Remove before outside
-- testers (B14) by checking p_tags as is again (logged as debt).
--
-- The function body below is copied from 20261027180000_gate3_report_reasons.sql
-- (the latest version); only the tag lines (v_tags) are new.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- submit_rating: as in 20261027180000, but retired tags are dropped quietly.
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
    p_tags                      optional heads-up tags (VC-43). Retired
                                tags (VC-45) are dropped quietly; unknown
                                ones are refused (VCTAG).
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
  -- The picked tags without the retired ones (see step 2).
  v_tags text[];
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
  -- TEMPORARY (cto review of VC-45): app builds made before VC-45 still
  -- offer the retired tags (music_fire, packed, good_crowd). Rather than
  -- refuse the whole rating, drop those tags quietly and save the rest.
  -- Unknown tags are still refused below. add_heads_up and both
  -- report_heads_up_tag functions keep refusing retired tags.
  -- REMOVE before outside testers (B14): go back to checking p_tags as is.
  select coalesce(array_agg(t.tag), '{}')
  into v_tags
  from unnest(coalesce(p_tags, '{}')) t(tag)
  where t.tag is null or not (t.tag = any (private.heads_up_tags_retired()));
  perform private.check_heads_up_tags(v_tags);

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
  from unnest(v_tags) t(tag)
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
  'VC-B08 + VC-43 + VC-46 + VC-51 + VC-64 (+ VC-45: retired tags dropped quietly, temporary until B14): saves the caller''s 3-tap rating (and heads-up tags); publishes a new vibe snapshot once 3+ people have rated since the last. Adults only, no admins, checked in within 45 minutes, inside the window, one per event, updates 60+ minutes apart.';

-- Rights, restated so this file stands on its own.
revoke execute on function public.submit_rating(uuid, integer, integer, integer, text, text[]) from public, anon;
grant execute on function public.submit_rating(uuid, integer, integer, integer, text, text[]) to authenticated;
