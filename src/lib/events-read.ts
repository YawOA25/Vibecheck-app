/**
 * The app's reads of public event details (task VC-B05, week view VC-61):
 * the home list and one event's page.
 *
 * What it does: asks Supabase for events in the home list's time range
 * (now through the next 7 nights by default, or the nights of the date
 * filter, VC-63), or for
 * one event by id, and turns failures into a short message to show.
 *
 * Paging (VC-66): the list comes in pages of 100. Each answer says whether
 * there are more, and the next page starts right after the last event
 * already shown (by start time, then id), so a long custom range never
 * silently drops events past 100.
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

/** How many events one page of the list holds (a busy week is far fewer). */
export const PAGE_SIZE = 100;

/**
 * The answer from {@link listHomeEvents}. `hasMore` is true when there are
 * more events after this page (ask again with the last one as `after`).
 */
export type EventListOutcome =
  { ok: true; events: PublicEvent[]; hasMore: boolean } | { ok: false; message: string };

/** Where the next page starts: the last event already shown. */
export type PageCursor = Pick<PublicEvent, 'id' | 'starts_at'>;

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
 * The filter that keeps only events AFTER the cursor in the list's order
 * (start time, then id for events starting at the same moment).
 *
 * @param after - the last event already shown.
 * @returns a PostgREST "or" filter: starts later, or starts at the same
 *   moment with a larger id. The start time is the server's own text (so no
 *   precision is lost), in double quotes because it holds ":" and "+".
 */
export function afterCursorFilter(after: PageCursor): string {
  const at = `"${after.starts_at}"`;
  return `starts_at.gt.${at},and(starts_at.eq.${at},id.gt.${after.id})`;
}

/**
 * Reads one page of events for the home list, soonest first.
 *
 * @param now - the moment the list was first loaded (a parameter so tests
 *   can fix it). Later pages pass the SAME moment, so every page uses the
 *   same date window.
 * @param filter - the date filter (VC-63); "This week" by default (VC-61:
 *   tonight through the next 7 nights).
 * @param after - null for the first page; otherwise the last event already
 *   shown, and the page starts right after it (VC-66).
 * @returns up to {@link PAGE_SIZE} events and whether more follow, or a
 *   message to show.
 * The conditions (see filterWindow in src/lib/date-filter.ts): the event
 * hasn't ended yet, it starts before 5 AM New York after the filter's last
 * night, and, when the filter starts on a later night, not before that
 * night begins.
 */
export async function listHomeEvents(
  now: Date = new Date(),
  filter: DateFilter = THIS_WEEK,
  after: PageCursor | null = null,
): Promise<EventListOutcome> {
  const { endsAfter, startsFrom, startsBefore } = filterWindow(filter, now);
  try {
    let query = supabase
      .from('events')
      .select(PUBLIC_EVENT_COLUMNS)
      .gt('ends_at', endsAfter.toISOString());
    // Only for filters that start on a later night (e.g. next weekend).
    if (startsFrom) query = query.gte('starts_at', startsFrom.toISOString());
    // Later pages: only events after the last one shown (VC-66).
    if (after) query = query.or(afterCursorFilter(after));
    const { data, error } = await query
      .lt('starts_at', startsBefore.toISOString())
      .order('starts_at', { ascending: true })
      // Same start time: by id, so the order (and the cursor) is exact.
      .order('id', { ascending: true })
      // One extra row tells us whether another page follows; it isn't shown.
      .limit(PAGE_SIZE + 1);
    if (error) return { ok: false, message: describeReadError(error) };
    const rows = (data ?? []) as PublicEvent[];
    return { ok: true, events: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
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
