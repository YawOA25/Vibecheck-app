/**
 * The delete-account Edge Function's decisions (task VC-B13), kept apart
 * from the Supabase and Deno plumbing in index.ts so Jest can test them on
 * a PC (__tests__/delete-account-function.test.ts).
 *
 * What a request goes through:
 *   1. CORS pre-check (OPTIONS): answered at once. Browsers send one before a
 *      web build's POST; the phone apps never do.
 *   2. Only POST may delete. Anything else: 405.
 *   3. The login token must be in the "Authorization: Bearer <token>" header.
 *      No token: 401.
 *   4. The token is checked with Supabase Auth (verifyUser). A forged,
 *      expired or non-user token: 401.
 *   5. The account deleted is ALWAYS the one the verified token belongs to.
 *      The request body is never read, so sending someone else's id in it
 *      does nothing. This is the "you can only delete yourself" rule; the
 *      database function it calls can't be reached by app users at all
 *      (pgTAP test 027).
 *   6. The answer: 200 {deleted: true}; 409 {error: 'locked'} for a login
 *      locked by the 18+ gate (database code VCLCK); 500 for anything else.
 *
 * Privacy: nothing here logs the user id, the token or the email. Only the
 * database error CODE is logged on a failure, so the founder can see why in
 * the Supabase function logs.
 */

/** The parts of an incoming request the function looks at. */
export interface DeleteAccountRequest {
  /** 'POST', 'OPTIONS', ... */
  method: string;
  /** The Authorization header, or null when there is none. */
  authorization: string | null;
}

/** What the function answers: an HTTP status and a JSON body (or none). */
export interface DeleteAccountResponse {
  status: number;
  body: Record<string, unknown> | null;
}

/** What the database call reports back: nothing on success, or an error code. */
export type DeleteResult = { error: null } | { error: { code?: string } };

/**
 * The outside services the function needs, passed in so tests can fake them.
 * index.ts fills these in with real Supabase calls.
 */
export interface DeleteAccountDeps {
  /**
   * Checks a login token with Supabase Auth.
   * @returns the user id it belongs to, or null when it isn't a valid user token.
   */
  verifyUser: (token: string) => Promise<string | null>;
  /**
   * Calls public.delete_account for exactly this user id (service role).
   * @returns the database's answer.
   */
  deleteAccount: (userId: string) => Promise<DeleteResult>;
  /** Where failures are noted (console.error in the real function). */
  logError?: (message: string) => void;
}

/**
 * Headers every answer carries so a web build may call the function. The
 * phone apps ignore them. Allowing any origin is safe here: nothing happens
 * without a valid login token, which a third-party site doesn't have.
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Reads the token out of an "Authorization: Bearer <token>" header.
 *
 * @param header - the header's value, or null.
 * @returns the token, or null when the header is missing or not in that shape.
 */
export function bearerToken(header: string | null): string | null {
  const match = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
  return match ? match[1] : null;
}

/**
 * Handles one call to the delete-account function (the steps at the top).
 *
 * @param req - the request's method and Authorization header.
 * @param deps - the Supabase calls (real or faked).
 * @returns the status and JSON body to send back. It never throws: a failed
 *   service call becomes a 500 answer.
 */
export async function handleDeleteAccount(
  req: DeleteAccountRequest,
  deps: DeleteAccountDeps,
): Promise<DeleteAccountResponse> {
  const logError = deps.logError ?? (() => {});

  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };

  const token = bearerToken(req.authorization);
  if (!token) return { status: 401, body: { error: 'not_signed_in' } };

  try {
    const userId = await deps.verifyUser(token);
    if (!userId) return { status: 401, body: { error: 'not_signed_in' } };

    const { error } = await deps.deleteAccount(userId);
    if (!error) return { status: 200, body: { deleted: true } };
    // Already gone (two taps racing, or a retry after a lost answer): the
    // person wanted their account deleted, and it is.
    if (error.code === 'VCNFD') return { status: 200, body: { deleted: true } };
    if (error.code === 'VCLCK') return { status: 409, body: { error: 'locked' } };
    logError(`delete_account failed with code ${error.code ?? 'unknown'}`);
    return { status: 500, body: { error: 'failed' } };
  } catch {
    logError('delete-account: a Supabase call threw');
    return { status: 500, body: { error: 'failed' } };
  }
}
