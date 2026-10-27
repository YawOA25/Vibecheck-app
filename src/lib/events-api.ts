/**
 * The app's calls to the admin event functions on the server (task VC-B04,
 * plus VC-34 "Edit event" and VC-35 "Show party code").
 *
 * What it does: sends a new event to `create_event`, sends changes (or a
 * request for a fresh party code) to `update_event`, reads an event's
 * editable details, asks `get_event_code` for the current party code, and
 * turns the server's error codes into plain English.
 *
 * Why the server decides: these functions refuse anyone who isn't an admin,
 * even if they build the request by hand. The app only hides the screen from
 * non-admins to keep things tidy; that is not the security.
 */
import type { ErrorLike } from '@/lib/auth-errors';
import type { CreateEventInput, EditableEvent, UpdateEventInput } from '@/lib/event-form';
import { PUBLIC_EVENT_COLUMNS } from '@/lib/events-read';
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
  /** VC-37: state isn't DC, MD or VA (migration 12). */
  state: 'VCSTA',
  /** VC-40: the "How to get in" link isn't allowed, or it's a staff pick (migration 13). */
  entryUrl: 'VCENT',
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
  EventErrorCode.state,
  EventErrorCode.entryUrl,
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

/**
 * Saves an admin's changes to an event (VC-34, the Edit event screen).
 *
 * @param input - the event id plus ONLY the fields that changed (see
 *   validateEventEdit). Anything left out, update_event keeps as it is.
 * @returns the event id and its current party code, or a message to show
 *   (for example VCTST: "People have checked in, so the test flag can't
 *   change."). Never throws.
 */
export async function updateEvent(input: UpdateEventInput): Promise<EventSaveOutcome> {
  try {
    const { data, error } = await supabase.rpc('update_event', { ...input });
    if (error) return { ok: false, message: describeEventError(error) };
    const result = readSaveResult(data);
    return result
      ? { ok: true, result }
      : { ok: false, message: "We couldn't save the event. Please try again." };
  } catch (thrown) {
    // supabase-js normally returns errors, but a dropped connection can throw.
    return { ok: false, message: describeEventError(thrown as ErrorLike) };
  }
}

/** The answer from {@link getEventForEdit}. `event` is null when it doesn't exist. */
export type EditableEventOutcome =
  { ok: true; event: EditableEvent | null } | { ok: false; message: string };

/**
 * Reads the details the Edit event form starts from (VC-34).
 *
 * @param id - the event's id.
 * @returns the public facts plus whether the party-code fallback is on, or
 *   a message to show. The pin, radius and code are NOT here: they live in
 *   event_private, which no app user (admins included) can read. The form
 *   leaves them as they are unless the admin sets new ones.
 */
export async function getEventForEdit(id: string): Promise<EditableEventOutcome> {
  try {
    // code_check_in_enabled (a plain on/off switch) is a public fact on the
    // events row, readable by signed-in adults; state (DC/MD/VA, VC-37) and
    // entry_url (VC-40) come with PUBLIC_EVENT_COLUMNS. None says where
    // exactly the party is.
    const { data, error } = await supabase
      .from('events')
      .select(`${PUBLIC_EVENT_COLUMNS}, code_check_in_enabled`)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      // 22P02 = the id isn't a valid uuid (a broken link): treat as not found.
      if (error.code === '22P02') return { ok: true, event: null };
      return { ok: false, message: describeLoadError(error, 'event') };
    }
    return { ok: true, event: (data as EditableEvent | null) ?? null };
  } catch (thrown) {
    return { ok: false, message: describeLoadError(thrown as ErrorLike, 'event') };
  }
}

/** The answer from {@link getEventCode}. */
export type EventCodeOutcome = { ok: true; code: string } | { ok: false; message: string };

/**
 * Asks the server for an event's current party code (VC-35, admins only).
 *
 * @param eventId - the event's id.
 * @returns the code, or a message to show. The server's get_event_code
 *   refuses anyone who isn't an admin (42501), whatever the app shows.
 * Privacy: the code goes back to the caller only. Nothing here logs it or
 * sends it to crash reports, and error messages never include it.
 */
export async function getEventCode(eventId: string): Promise<EventCodeOutcome> {
  try {
    const { data, error } = await supabase.rpc('get_event_code', { p_event_id: eventId });
    if (error) {
      if (error.code === EventErrorCode.notAllowed) {
        return { ok: false, message: 'Only admins can see the party code.' };
      }
      if (error.code === EventErrorCode.notFound) {
        return { ok: false, message: "That event doesn't exist." };
      }
      return { ok: false, message: describeLoadError(error, 'party code') };
    }
    return typeof data === 'string' && data !== ''
      ? { ok: true, code: data }
      : { ok: false, message: describeLoadError({}, 'party code') };
  } catch (thrown) {
    return { ok: false, message: describeLoadError(thrown as ErrorLike, 'party code') };
  }
}

/**
 * The fallback message when something couldn't be loaded.
 *
 * @param error - the error from supabase-js (or one that was thrown).
 * @param what - what we tried to load, e.g. "party code".
 * @returns "check your connection" for network trouble, otherwise
 *   "We couldn't load the <what>. Please try again."
 */
function describeLoadError(error: ErrorLike, what: string): string {
  return /network request failed|failed to fetch/i.test(error.message ?? '')
    ? "We couldn't reach the server. Check your connection and try again."
    : `We couldn't load the ${what}. Please try again.`;
}
