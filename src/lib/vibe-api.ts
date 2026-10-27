/**
 * The app's calls to the server for the live vibe (task VC-B09) and the
 * headcount (VC-42).
 *
 * What it does:
 *   - {@link getEventVibe} asks `get_event_vibe` for one event (the event
 *     page's meter);
 *   - {@link getEventsVibe} asks `get_events_vibe` for the whole Tonight list
 *     in one call.
 * Each checks the answer with parseVibe (src/lib/vibe.ts). Neither throws;
 * failures come back as a short message to show.
 *
 * Why a separate file: screen tests replace these two calls with fakes but
 * keep the real wording helpers in src/lib/vibe.ts.
 */
import type { ErrorLike } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { MAX_EVENTS_PER_CALL, VIBE_LOAD_ERROR, parseVibe } from '@/lib/vibe';
import type { VibeOutcome, VibesOutcome, Vibe } from '@/lib/vibe';

/**
 * Turns a failed call into a short sentence.
 *
 * @param error - the error from supabase-js (or one that was thrown).
 * @returns "check your connection" for network trouble, otherwise the
 *   general "couldn't load the vibe".
 */
function describeVibeError(error: ErrorLike): string {
  if (/network request failed|failed to fetch/i.test(error.message ?? '')) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  return VIBE_LOAD_ERROR;
}

/**
 * Reads one event's live vibe.
 *
 * @param eventId - the event's id.
 * @returns the vibe, or a message to show. Never throws.
 */
export async function getEventVibe(eventId: string): Promise<VibeOutcome> {
  try {
    const { data, error } = await supabase.rpc('get_event_vibe', { p_event_id: eventId });
    if (error) return { ok: false, message: describeVibeError(error) };
    const vibe = parseVibe(data);
    return vibe ? { ok: true, vibe } : { ok: false, message: VIBE_LOAD_ERROR };
  } catch (thrown) {
    // supabase-js normally returns errors, but a dropped connection can throw.
    return { ok: false, message: describeVibeError(thrown as ErrorLike) };
  }
}

/**
 * Reads the vibes of several events at once (the Tonight list).
 *
 * @param eventIds - the events' ids (the list only sends the started ones).
 *   The server takes at most 100 per call, so a longer list (possible with
 *   paging, VC-66) is split into calls of 100, sent together.
 * @returns each event's vibe by id (events the server left out, or whose
 *   answer didn't make sense, are simply missing), or a message if any of
 *   the calls failed. Never throws.
 */
export async function getEventsVibe(eventIds: string[]): Promise<VibesOutcome> {
  if (eventIds.length === 0) return { ok: true, vibes: {} };
  const chunks: string[][] = [];
  for (let i = 0; i < eventIds.length; i += MAX_EVENTS_PER_CALL) {
    chunks.push(eventIds.slice(i, i + MAX_EVENTS_PER_CALL));
  }
  const answers = await Promise.all(chunks.map(getVibeChunk));
  const vibes: Record<string, Vibe> = {};
  for (const answer of answers) {
    // One failed call fails the whole answer, so the list keeps its last
    // good scores instead of showing some cards without theirs.
    if (!answer.ok) return answer;
    Object.assign(vibes, answer.vibes);
  }
  return { ok: true, vibes };
}

/**
 * One get_events_vibe call for up to 100 ids.
 *
 * @param ids - at most {@link MAX_EVENTS_PER_CALL} event ids.
 * @returns their vibes by id, or a message. Never throws.
 */
async function getVibeChunk(ids: string[]): Promise<VibesOutcome> {
  try {
    const { data, error } = await supabase.rpc('get_events_vibe', { p_event_ids: ids });
    if (error) return { ok: false, message: describeVibeError(error) };
    const vibes: Record<string, Vibe> = {};
    if (Array.isArray(data)) {
      for (const item of data) {
        const id =
          item && typeof item === 'object' ? (item as { event_id?: unknown }).event_id : null;
        const vibe = parseVibe(item);
        if (typeof id === 'string' && vibe) vibes[id] = vibe;
      }
    }
    return { ok: true, vibes };
  } catch (thrown) {
    // supabase-js normally returns errors, but a dropped connection can throw.
    return { ok: false, message: describeVibeError(thrown as ErrorLike) };
  }
}
