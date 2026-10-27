/**
 * The app's call to the server's `check_in` function (task VC-B06).
 *
 * What it does: sends the event id and ONE location reading to check_in,
 * then turns the server's answer into a tidy result the screen can show
 * ("passed", "too far", "weak signal", and so on), or a short error message.
 *
 * Why the server decides: the party's pin and radius live in event_private,
 * which the app can't read. The server compares the reading, applies the
 * window and the limits, and keeps only pass/fail, the time and a rough
 * accuracy band (supabase/migrations/20261026190000_check_in.sql).
 *
 * Privacy: the reading goes into the request and nowhere else. Nothing in
 * this file logs it, and error messages never include it.
 */
import type { ErrorLike } from '@/lib/auth-errors';
import type { LocationReading } from '@/lib/check-in-location';
import { supabase } from '@/lib/supabase';

/** The server's answer, tidied up. Mirrors the statuses in the migration. */
export type CheckInResult =
  /** Checked in. `alreadyCheckedIn` is true on a repeat check. */
  | { status: 'passed'; firstAt: string; alreadyCheckedIn: boolean }
  /** Outside the party area. The server never says how far. */
  | { status: 'too_far' }
  /** The phone said it could be more than 300 m off. */
  | { status: 'weak_signal' }
  /** Too early or too late, with when check-in opens and closes. */
  | {
      status: 'outside_window';
      reason: 'too_early' | 'too_late';
      opensAt: string;
      closesAt: string;
    }
  /** 20 tries in the last hour; wait this many minutes. */
  | { status: 'too_many_attempts'; retryAfterMinutes: number }
  /** Already checked in to 8 other events in the last 24 hours. */
  | { status: 'too_many_events' }
  /**
   * 5 "too far" answers for this event already (VC-36): GPS check-in is off
   * for this person and this event for the rest of the event. The party
   * code still works.
   */
  | { status: 'gps_locked' };

/** Kinds of failure the screen treats differently. */
export type CheckInErrorKind = 'notFound' | 'notAllowed' | 'badReading' | 'network' | 'unknown';

/** What {@link submitCheckIn} returns. */
export type CheckInOutcome =
  { ok: true; result: CheckInResult } | { ok: false; kind: CheckInErrorKind; message: string };

/** Error codes check_in raises (see the migration). Keep in sync. */
export const CheckInErrorCode = {
  notAllowed: '42501',
  notFound: 'VCNFD',
  badReading: 'VCGPS',
} as const;

/** The general "something went wrong" sentence. */
const GENERIC_MESSAGE = "We couldn't check you in. Please try again.";

/**
 * Reads the server's JSON answer into a {@link CheckInResult}.
 *
 * @param data - whatever check_in returned.
 * @returns the tidy result, or null if the answer isn't one we know (for
 *   example an older app talking to a newer server).
 */
export function parseCheckInResult(data: unknown): CheckInResult | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  switch (value.status) {
    case 'passed':
      return typeof value.first_at === 'string'
        ? {
            status: 'passed',
            firstAt: value.first_at,
            alreadyCheckedIn: value.already_checked_in === true,
          }
        : null;
    case 'too_far':
    case 'weak_signal':
    case 'too_many_events':
    case 'gps_locked':
      return { status: value.status };
    case 'outside_window':
      return (value.reason === 'too_early' || value.reason === 'too_late') &&
        typeof value.opens_at === 'string' &&
        typeof value.closes_at === 'string'
        ? {
            status: 'outside_window',
            reason: value.reason,
            opensAt: value.opens_at,
            closesAt: value.closes_at,
          }
        : null;
    case 'too_many_attempts':
      return {
        status: 'too_many_attempts',
        // At least 1 minute, even if the number is missing or odd.
        retryAfterMinutes:
          typeof value.retry_after_minutes === 'number' && value.retry_after_minutes >= 1
            ? Math.ceil(value.retry_after_minutes)
            : 1,
      };
    default:
      return null;
  }
}

/**
 * Turns an error from check_in into a kind plus a sentence to show.
 *
 * @param error - the error from supabase-js (or one that was thrown).
 * @returns the kind of failure and a short message. The message never
 *   repeats any numbers from the request.
 */
export function describeCheckInError(error: ErrorLike): {
  kind: CheckInErrorKind;
  message: string;
} {
  if (/network request failed|failed to fetch/i.test(error.message ?? '')) {
    return {
      kind: 'network',
      message: "We couldn't reach the server. Check your connection and try again.",
    };
  }
  switch (error.code) {
    case CheckInErrorCode.notFound:
      return { kind: 'notFound', message: "That event doesn't exist." };
    case CheckInErrorCode.notAllowed:
      return { kind: 'notAllowed', message: 'Please sign in again, then try checking in.' };
    case CheckInErrorCode.badReading:
      return { kind: 'badReading', message: "We couldn't read your location. Please try again." };
    default:
      return { kind: 'unknown', message: GENERIC_MESSAGE };
  }
}

/**
 * Asks the server to check the caller in to an event.
 *
 * @param eventId - the event's id.
 * @param reading - one location reading from {@link readLocationForCheckIn}.
 * @returns the server's result, or an error kind and message. Never throws.
 */
export async function submitCheckIn(
  eventId: string,
  reading: LocationReading,
): Promise<CheckInOutcome> {
  try {
    // Parameter names match the SQL function's.
    const { data, error } = await supabase.rpc('check_in', {
      p_event_id: eventId,
      p_lat: reading.lat,
      p_lng: reading.lng,
      p_accuracy_m: reading.accuracyM,
    });
    if (error) return { ok: false, ...describeCheckInError(error) };
    const result = parseCheckInResult(data);
    return result ? { ok: true, result } : { ok: false, kind: 'unknown', message: GENERIC_MESSAGE };
  } catch (thrown) {
    // supabase-js normally returns errors, but a dropped connection can throw.
    return { ok: false, ...describeCheckInError(thrown as ErrorLike) };
  }
}
