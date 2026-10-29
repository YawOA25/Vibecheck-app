/**
 * The app's calls to the server's party-code check-in and tester check-in
 * (task VC-B07).
 *
 * What it does:
 *   - {@link cleanPartyCode} tidies what the guest types into the code box;
 *   - {@link submitCodeCheckIn} sends the event id and the typed code to the
 *     server's `check_in_with_code`;
 *   - {@link submitTesterCheckIn} asks `tester_check_in` to check a tester in
 *     to a test event with no GPS and no code;
 *   - both turn the server's answer into a tidy result for the join screen,
 *     or a short error message.
 *
 * Why the server decides: the real code lives in event_private, which the
 * app can't read. The server compares, applies the window, the 5-wrong-codes
 * lock and the limits, and keeps only the result and the time
 * (supabase/migrations/20261026200000_check_in_with_code.sql).
 *
 * Privacy: the typed code goes into the request and nowhere else. Nothing in
 * this file logs it, and no message repeats it. (Sentry also scrubs, but the
 * rule is not to hand it over in the first place.)
 */
import type { ErrorLike } from '@/lib/auth-errors';
import type { CheckInResult } from '@/lib/check-in-api';
import { parseCheckInResult } from '@/lib/check-in-api';
import { TIMEOUT_MESSAGE, withTimeout } from '@/lib/network-timeout';
import { supabase } from '@/lib/supabase';

/** How many characters a party code has (server rule: 6 of A-Z and 0-9). */
export const PARTY_CODE_LENGTH = 6;

/** Wrong codes allowed in an hour before entry locks (server rule). */
export const MAX_WRONG_CODES = 5;

/**
 * The server's answer to a code or tester check-in. It includes every
 * GPS answer that can also happen here (passed, outside the window, the two
 * limits), plus the code-only ones.
 */
export type CodeCheckInResult =
  | Exclude<CheckInResult, { status: 'too_far' } | { status: 'weak_signal' }>
  /** Not the code; `triesLeft` (1-4) more before entry locks. */
  | { status: 'wrong_code'; triesLeft: number }
  /** 5 wrong codes in the last hour; wait this many minutes. */
  | { status: 'locked'; retryAfterMinutes: number }
  /** The host hasn't switched the party code on for this event. */
  | { status: 'code_off' };

/**
 * Kinds of failure the join screen treats differently. 'timeout' (Q8b): no
 * answer within 15 seconds, so we stopped waiting (the next try shows the
 * server's real answer, e.g. "already checked in").
 */
export type CodeCheckInErrorKind =
  'notFound' | 'notAllowed' | 'badCode' | 'realEvent' | 'network' | 'timeout' | 'unknown';

/** What the submit functions return. */
export type CodeCheckInOutcome =
  | { ok: true; result: CodeCheckInResult }
  | { ok: false; kind: CodeCheckInErrorKind; message: string };

/** Error codes the two server functions raise (see the migration). Keep in sync. */
export const CodeCheckInErrorCode = {
  notAllowed: '42501',
  notFound: 'VCNFD',
  badCode: 'VCCOD',
  realEvent: 'VCOVR',
} as const;

/** The general "something went wrong" sentence. */
const GENERIC_MESSAGE = "We couldn't check you in. Please try again.";

/**
 * Tidies what the guest typed into the code box: capital letters, and only
 * letters and digits (spaces, dashes and anything else dropped), at most 6.
 *
 * @param text - the raw text from the box.
 * @returns the cleaned code, e.g. "k7m-x2" becomes "K7MX2".
 */
export function cleanPartyCode(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, PARTY_CODE_LENGTH);
}

/**
 * Turns a "minutes" number from the server into a whole number of at least 1.
 *
 * @param value - whatever the server sent.
 * @returns a safe number of minutes.
 */
function minutes(value: unknown): number {
  return typeof value === 'number' && value >= 1 ? Math.ceil(value) : 1;
}

/**
 * Reads the server's JSON answer into a {@link CodeCheckInResult}.
 *
 * @param data - whatever check_in_with_code or tester_check_in returned.
 * @returns the tidy result, or null if the answer isn't one we know.
 */
export function parseCodeCheckInResult(data: unknown): CodeCheckInResult | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  switch (value.status) {
    case 'wrong_code':
      return {
        status: 'wrong_code',
        // 1 to 4 tries left; anything odd is shown as 1, the careful choice.
        triesLeft:
          typeof value.tries_left === 'number' && value.tries_left >= 1
            ? Math.min(Math.floor(value.tries_left), MAX_WRONG_CODES - 1)
            : 1,
      };
    case 'locked':
      return { status: 'locked', retryAfterMinutes: minutes(value.retry_after_minutes) };
    case 'code_off':
      return { status: 'code_off' };
    default: {
      // The answers shared with GPS check-in are read by the B06 parser.
      // A GPS-only answer (too far, weak signal) can't come from these
      // functions, so it counts as unknown.
      const shared = parseCheckInResult(data);
      if (!shared || shared.status === 'too_far' || shared.status === 'weak_signal') return null;
      return shared;
    }
  }
}

/**
 * Turns an error from either function into a kind plus a sentence to show.
 *
 * @param error - the error from supabase-js (or one that was thrown).
 * @returns the kind of failure and a short message. Never repeats the code.
 */
export function describeCodeCheckInError(error: ErrorLike): {
  kind: CodeCheckInErrorKind;
  message: string;
} {
  if (/network request failed|failed to fetch/i.test(error.message ?? '')) {
    return {
      kind: 'network',
      message: "We couldn't reach the server. Check your connection and try again.",
    };
  }
  switch (error.code) {
    case CodeCheckInErrorCode.notFound:
      return { kind: 'notFound', message: "That event doesn't exist." };
    case CodeCheckInErrorCode.notAllowed:
      return { kind: 'notAllowed', message: 'Please sign in again, then try checking in.' };
    case CodeCheckInErrorCode.badCode:
      return {
        kind: 'badCode',
        message: 'Party codes are 6 letters and numbers. Check the card and try again.',
      };
    case CodeCheckInErrorCode.realEvent:
      return { kind: 'realEvent', message: 'The tester check-in works only on test events.' };
    default:
      return { kind: 'unknown', message: GENERIC_MESSAGE };
  }
}

/**
 * Calls one of the two server functions and tidies the answer.
 *
 * @param name - the server function's name.
 * @param args - its inputs (names match the SQL function's).
 * @returns the result, or an error kind and message. Never throws.
 */
async function callCheckIn(
  name: 'check_in_with_code' | 'tester_check_in',
  args: Record<string, string>,
): Promise<CodeCheckInOutcome> {
  try {
    // Gives up after 15 seconds (Q8b): the form is locked while sending.
    const timed = await withTimeout((signal) => supabase.rpc(name, args).abortSignal(signal));
    if (timed.timedOut) return { ok: false, kind: 'timeout', message: TIMEOUT_MESSAGE };
    const { data, error } = timed.value;
    if (error) return { ok: false, ...describeCodeCheckInError(error) };
    const result = parseCodeCheckInResult(data);
    return result ? { ok: true, result } : { ok: false, kind: 'unknown', message: GENERIC_MESSAGE };
  } catch (thrown) {
    // supabase-js normally returns errors, but a dropped connection can throw.
    return { ok: false, ...describeCodeCheckInError(thrown as ErrorLike) };
  }
}

/**
 * Asks the server to check the caller in with the party code.
 *
 * @param eventId - the event's id.
 * @param code - what the guest typed (cleaned again here, to be safe).
 * @returns the server's result, or an error kind and message. Never throws.
 */
export function submitCodeCheckIn(eventId: string, code: string): Promise<CodeCheckInOutcome> {
  return callCheckIn('check_in_with_code', { p_event_id: eventId, p_code: cleanPartyCode(code) });
}

/**
 * Asks the server to check a tester in to a test event (no GPS, no code).
 * The server refuses non-testers and real events.
 *
 * @param eventId - the test event's id.
 * @returns the server's result, or an error kind and message. Never throws.
 */
export function submitTesterCheckIn(eventId: string): Promise<CodeCheckInOutcome> {
  return callCheckIn('tester_check_in', { p_event_id: eventId });
}
