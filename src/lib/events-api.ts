/**
 * The app's calls to the admin event functions on the server (task VC-B04).
 *
 * What it does: sends a new event to `create_event`, asks `update_event` for
 * a fresh party code, and turns the server's error codes into plain English.
 *
 * Why the server decides: these functions refuse anyone who isn't an admin,
 * even if they build the request by hand. The app only hides the screen from
 * non-admins to keep things tidy; that is not the security.
 */
import type { ErrorLike } from '@/lib/auth-errors';
import type { CreateEventInput } from '@/lib/event-form';
import { supabase } from '@/lib/supabase';

/** What the server sends back after a create or an edit. */
export interface EventSaveResult {
  eventId: string;
  /** The 6-character party code, to print on a card. Admins only. */
  checkInCode: string;
}

/** The answer from {@link createEvent} or {@link rotateEventCode}. */
export type EventSaveOutcome =
  { ok: true; result: EventSaveResult } | { ok: false; message: string };

/**
 * Our own error codes from create_event / update_event
 * (supabase/migrations/20261026180000_admin_events.sql). Keep in sync.
 */
export const EventErrorCode = {
  notAllowed: '42501',
  title: 'VCTTL',
  area: 'VCARE',
  times: 'VCTIM',
  location: 'VCLOC',
  ticketUrl: 'VCURL',
  summary: 'VCSUM',
  source: 'VCSRC',
  notFound: 'VCNFD',
  testFlag: 'VCTST',
} as const;

/** Our own codes whose server message is already written for people to read. */
const READABLE_CODES = new Set<string>([
  EventErrorCode.title,
  EventErrorCode.area,
  EventErrorCode.times,
  EventErrorCode.location,
  EventErrorCode.ticketUrl,
  EventErrorCode.summary,
  EventErrorCode.source,
  EventErrorCode.notFound,
  EventErrorCode.testFlag,
]);

/**
 * Turns an error from create_event or update_event into a short message.
 *
 * @param error - the error from supabase-js.
 * @returns a sentence to show under the Save button.
 */
export function describeEventError(error: ErrorLike): string {
  if (/network request failed|failed to fetch/i.test(error.message ?? '')) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  if (error.code === EventErrorCode.notAllowed) {
    return 'Only admins can create or edit events.';
  }
  // For our own codes the server's message says exactly what to fix.
  if (error.code && READABLE_CODES.has(error.code) && error.message) {
    return error.message;
  }
  return "We couldn't save the event. Please try again.";
}

/**
 * Reads the server's reply ({"event_id": ..., "check_in_code": ...}).
 *
 * @param data - whatever the function returned.
 * @returns the tidy result, or null if the reply isn't the expected shape.
 */
function readSaveResult(data: unknown): EventSaveResult | null {
  const value = data as { event_id?: unknown; check_in_code?: unknown } | null;
  if (value && typeof value.event_id === 'string' && typeof value.check_in_code === 'string') {
    return { eventId: value.event_id, checkInCode: value.check_in_code };
  }
  return null;
}

/**
 * Creates an event on the server.
 *
 * @param input - the checked form values (see validateEventForm).
 * @returns the new event's id and party code, or a message to show.
 */
export async function createEvent(input: CreateEventInput): Promise<EventSaveOutcome> {
  // `rpc` calls a server function by name; parameter names match the SQL.
  const { data, error } = await supabase.rpc('create_event', { ...input });
  if (error) return { ok: false, message: describeEventError(error) };
  const result = readSaveResult(data);
  return result
    ? { ok: true, result }
    : { ok: false, message: "We couldn't save the event. Please try again." };
}

/**
 * Replaces an event's party code with a new random one ("code rotate"), for
 * example if a photo of the printed card got shared.
 *
 * @param eventId - the event's id.
 * @returns the event id and the NEW code, or a message to show.
 */
export async function rotateEventCode(eventId: string): Promise<EventSaveOutcome> {
  // Everything else is left out, which update_event reads as "keep as is".
  const { data, error } = await supabase.rpc('update_event', {
    p_event_id: eventId,
    p_rotate_code: true,
  });
  if (error) return { ok: false, message: describeEventError(error) };
  const result = readSaveResult(data);
  return result
    ? { ok: true, result }
    : { ok: false, message: "We couldn't get a new code. Please try again." };
}
