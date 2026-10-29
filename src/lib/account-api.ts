/**
 * Asks the server to delete the signed-in person's account (task VC-B13).
 *
 * It calls the `delete-account` Supabase Edge Function
 * (supabase/functions/delete-account). supabase-js sends the person's login
 * token with the call automatically, and the function deletes ONLY the
 * account that token belongs to; the app sends no id at all.
 *
 * This file only makes the call and turns the answer into words. Signing
 * out and clearing the phone afterwards is done by `deleteAccount` in
 * src/lib/auth-context.tsx.
 *
 * Used from Settings and, since VC-75, from the "sorry" screen of a login
 * locked by the 18+ gate (the server now deletes those too).
 */
import { supabase } from '@/lib/supabase';

/** The answer: deleted, or a sentence saying why not. */
export type DeleteAccountResult = { ok: true } | { ok: false; message: string };

/** Shown for a network problem or an unexpected server error. */
export const DELETE_FAILED =
  "We couldn't delete your account. Check your connection and try again.";

/** Shown when the login has expired (the function's 401). */
export const DELETE_SIGNED_OUT =
  'Your sign-in has expired. Sign out, sign back in, then try again.';

/**
 * Calls the delete-account function.
 *
 * @returns { ok: true } once the server has deleted everything, or
 *   { ok: false, message } with a sentence for the screen. It never throws.
 *   The server's work is one database transaction, so an account is never
 *   left half-deleted. (Rare case: the deletion worked but the answer was
 *   lost on the way back. A retry then gets 401, because the login no longer
 *   exists, and the screen suggests signing out.)
 */
export async function requestAccountDeletion(): Promise<DeleteAccountResult> {
  try {
    const { data, error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
    if (!error && (data as { deleted?: unknown } | null)?.deleted === true) return { ok: true };
    // supabase-js puts the HTTP answer on `error.context` for a non-2xx status.
    const status = (error as { context?: { status?: unknown } } | null)?.context?.status;
    if (status === 401) return { ok: false, message: DELETE_SIGNED_OUT };
    return { ok: false, message: DELETE_FAILED };
  } catch {
    return { ok: false, message: DELETE_FAILED };
  }
}
