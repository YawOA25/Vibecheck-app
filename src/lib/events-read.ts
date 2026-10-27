/**
 * The app's reads of public event details (task VC-B05, week view VC-61):
 * the home list and one event's page.
 *
 * What it does: asks Supabase for events in the home list's time range
 * (now through the next 7 nights by default, or the nights of the date
 * filter, VC-63), or for
 * one event by id, and turns failures into a short message to show.
 *
 * Privacy (VC-20): we name every column we read, and they are all public
 * facts from the `events` table. Where a party actually is (the map pin) is
 * in `event_private`, which no app user can read at all, so it can't leak
 * from here even by mistake.
 *
 * Who sees what is decided by the server, not the app: the `events` RLS
 * policy (migration 20261026150100_events.sql) only returns events to
 * signed-up adults, and test events (`is_test`) only to testers.
 */
import type { ErrorLike } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { filterWindow, THIS_WEEK } from '@/lib/date-filter';
import type { DateFilter } from '@/lib/date-filter';
import type { PublicEvent } from '@/lib/tonight';

/**
 * The columns the app reads. All are public facts; there is no address or
 * pin in the `events` table. Keep in sync with {@link PublicEvent}.
 */
export const PUBLIC_EVENT_COLUMNS =
  'id, title, area_label, starts_at, ends_at, source, ticket_url, summary, is_21_plus, is_test, entry_url, state';

/** The most events the list asks for at once (a busy week is far fewer). */
const LIST_LIMIT = 100;

/** The answer from {@link listHomeEvents}. */
export type EventListOutcome = { ok: true; events: PublicEvent[] } | { ok: false; message: string };

/** The answer from {@link getEvent}. `event` is null when it doesn't exist (or is hidden). */
export type EventOutcome = { ok: true; event: PublicEvent | null } | { ok: false; message: string };

/**
 * Turns a read error into a short sentence.
 *
 * @param error - the error from supabase-js.
 * @returns "check your connection" for network trouble, otherwise a general
 *   "couldn't load" message.
 */
export function describeReadError(error: ErrorLike): string {
  if (/network request failed|failed to fetch/i.test(error.message ?? '')) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  return "We couldn't load events. Please try again.";
}

/**
 * Reads the events for the home list, soonest first.
 *
 * @param now - the current moment (a parameter so tests can fix it).
 * @param filter - the date filter (VC-63); "This week" by default (VC-61:
 *   tonight through the next 7 nights).
 * @returns the events, or a message to show.
 * The conditions (see filterWindow in src/lib/date-filter.ts): the event
 * hasn't ended yet, it starts before 5 AM New York after the filter's last
 * night, and, when the filter starts on a later night, not before that
 * night begins.
 */
export async function listHomeEvents(
  now: Date = new Date(),
  filter: DateFilter = THIS_WEEK,
): Promise<EventListOutcome> {
  const { endsAfter, startsFrom, startsBefore } = filterWindow(filter, now);
  try {
    let query = supabase
      .from('events')
      .select(PUBLIC_EVENT_COLUMNS)
      .gt('ends_at', endsAfter.toISOString());
    // Only for filters that start on a later night (e.g. next weekend).
    if (startsFrom) query = query.gte('starts_at', startsFrom.toISOString());
    const { data, error } = await query
      .lt('starts_at', startsBefore.toISOString())
      .order('starts_at', { ascending: true })
      .limit(LIST_LIMIT);
    if (error) return { ok: false, message: describeReadError(error) };
    return { ok: true, events: (data ?? []) as PublicEvent[] };
  } catch (thrown) {
    // supabase-js normally returns errors, but a dropped connection can throw.
    return { ok: false, message: describeReadError(thrown as ErrorLike) };
  }
}

/**
 * Reads one event by its id.
 *
 * @param id - the event's id (from the address, e.g. /event/<id>).
 * @returns the event, `event: null` if there is no such event or this person
 *   isn't allowed to see it (for example a test event and they aren't a
 *   tester), or a message to show.
 */
export async function getEvent(id: string): Promise<EventOutcome> {
  try {
    // maybeSingle: "zero or one row", so a missing event is null, not an error.
    const { data, error } = await supabase
      .from('events')
      .select(PUBLIC_EVENT_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      // 22P02 = the id isn't a valid uuid (a broken link): treat as not found.
      if (error.code === '22P02') return { ok: true, event: null };
      return { ok: false, message: describeReadError(error) };
    }
    return { ok: true, event: (data as PublicEvent | null) ?? null };
  } catch (thrown) {
    return { ok: false, message: describeReadError(thrown as ErrorLike) };
  }
}
