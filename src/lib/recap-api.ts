/**
 * Talks to the server for the recap (task VC-B12): one call,
 * get_my_recap, used two ways.
 *
 *   getMyRecap('recent') - the events you rated in the last 36 hours (the
 *                          "Your night" screen the 11 AM notification opens)
 *   getMyRecap('all')    - every event you rated, newest first, at most 50
 *                          (the Nights out list on the Me screen)
 *
 * The server only ever sends your own rating plus each event's PUBLISHED
 * vibe (migration 20261028100000_my_recap.sql), so this file only checks
 * and tidies the answer.
 */
import type { ErrorLike } from '@/lib/auth-errors';
import { parseRecap } from '@/lib/recap';
import type { RecapItem } from '@/lib/recap';
import { supabase } from '@/lib/supabase';

/** The general "it didn't work" message for the recap screens. */
export const RECAP_LOAD_ERROR = "We couldn't load your nights out.";

/** The answer: the items, or a message to show. */
export type RecapOutcome = { ok: true; items: RecapItem[] } | { ok: false; message: string };

/**
 * Turns a server or network error into words for the screen.
 *
 * @param error - the error from supabase-js (or a thrown one).
 * @returns a short message.
 */
function describeRecapError(error: ErrorLike): string {
  if (/network request failed|failed to fetch/i.test(error.message ?? '')) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  return RECAP_LOAD_ERROR;
}

/**
 * Loads the recap.
 *
 * @param scope - 'recent' (last 36 hours) or 'all' (the Nights out list).
 * @returns the items (possibly none), or a message.
 */
export async function getMyRecap(scope: 'recent' | 'all'): Promise<RecapOutcome> {
  try {
    const { data, error } = await supabase.rpc('get_my_recap', { p_all: scope === 'all' });
    if (error) return { ok: false, message: describeRecapError(error) };
    const items = parseRecap(data);
    return items ? { ok: true, items } : { ok: false, message: RECAP_LOAD_ERROR };
  } catch (thrown) {
    // supabase-js normally returns errors, but a dropped connection can throw.
    return { ok: false, message: describeRecapError(thrown as ErrorLike) };
  }
}
