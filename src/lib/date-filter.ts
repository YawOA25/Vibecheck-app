/**
 * The home list's date filter (VC-63, approved by the founder 2026-10-27:
 * "users should able to filter for dates to see events they can do single
 * dates this weekend or custom dates").
 *
 * What it does: describes the four filters and works out, for each, which
 * nights it covers, the time range to ask the server for, and the words the
 * screen shows (title, small line above it, empty state).
 *
 * The four filters:
 *   - "This week" (the default): tonight and the next 6 nights (VC-61);
 *   - "This weekend": Friday, Saturday and Sunday nights. If it's already
 *     the weekend (Friday 5 AM to Monday 5 AM, New York), the current one;
 *   - "Pick a date": one night;
 *   - "Custom": a range of nights, from one date to another (up to
 *     MAX_RANGE_NIGHTS).
 *
 * The same night rule as everywhere (src/lib/tonight.ts): a night runs from
 * 5 AM to 5 AM New York time, so a 1 AM party belongs to the evening before.
 * Like the rest of that file, every function takes `now` as an input so
 * tests can pin the time.
 *
 * The filter is never saved: it goes back to "This week" when the app
 * restarts (founder's brief).
 */
import {
  addDays,
  daysBetween,
  monthDay,
  nightBegins,
  nightOf,
  shortDate,
  weekdayName,
  weekKicker,
  WEEK_NIGHTS,
} from '@/lib/tonight';
import type { CivilDate } from '@/lib/tonight';

/**
 * The most nights a custom range can cover. A cap keeps the server query
 * light (one range, at most LIST_LIMIT events, src/lib/events-read.ts); 60
 * nights is about two months, plenty for planning ahead.
 */
export const MAX_RANGE_NIGHTS = 60;

/** One of the four filters. Dates are night dates (the evening's date). */
export type DateFilter =
  | { kind: 'week' }
  | { kind: 'weekend' }
  | { kind: 'date'; night: CivilDate }
  | { kind: 'range'; from: CivilDate; to: CivilDate };

/** The default filter: this week (VC-61). */
export const THIS_WEEK: DateFilter = { kind: 'week' };

/** Chip words, in the order the chips show (exported so tests use the same words). */
export const FILTER_LABELS = {
  week: 'This week',
  weekend: 'This weekend',
  date: 'Pick a date',
  range: 'Custom',
} as const;

/** JavaScript's weekday numbers (Sunday = 0) for the weekend nights. */
const FRIDAY = 5;
const SUNDAY = 0;

/**
 * The weekday number of a date (Sunday = 0 ... Saturday = 6).
 *
 * @param date - the calendar date.
 * @returns 0 to 6.
 */
function weekdayOf(date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/**
 * Says whether date `a` is before date `b`.
 *
 * @returns true when `a` is an earlier day.
 */
function isBefore(a: CivilDate, b: CivilDate): boolean {
  return daysBetween(a, b) > 0;
}

/**
 * The first and last nights a filter covers.
 *
 * @param filter - the filter.
 * @param now - the current moment.
 * @returns `first` and `last` night dates (both included). Rules:
 *   - week: tonight to tonight + 6;
 *   - weekend: Friday to Sunday. Tonight is Friday, Saturday or Sunday
 *     night (so up to Monday 5 AM): this weekend; otherwise the coming one;
 *   - date: that one night, but never before tonight;
 *   - range: as picked, put in order if picked backwards, starting no
 *     earlier than tonight, and cut to MAX_RANGE_NIGHTS nights.
 */
export function filterNights(filter: DateFilter, now: Date): { first: CivilDate; last: CivilDate } {
  const tonight = nightOf(now);
  switch (filter.kind) {
    case 'week':
      return { first: tonight, last: addDays(tonight, WEEK_NIGHTS - 1) };
    case 'weekend': {
      const day = weekdayOf(tonight);
      // Days to this weekend's Friday: back 0, 1 or 2 on Friday, Saturday or
      // Sunday night; forward 4 ... 1 on Monday ... Thursday night.
      // (Sunday is day 0, so it needs its own case.)
      const toFriday = day === SUNDAY ? -2 : FRIDAY - day;
      const friday = addDays(tonight, toFriday);
      return { first: friday, last: addDays(friday, 2) };
    }
    case 'date': {
      const night = isBefore(filter.night, tonight) ? tonight : filter.night;
      return { first: night, last: night };
    }
    case 'range': {
      // Picked backwards (end before start): swap them.
      let [from, to] = isBefore(filter.to, filter.from)
        ? [filter.to, filter.from]
        : [filter.from, filter.to];
      if (isBefore(from, tonight)) from = tonight;
      if (isBefore(to, from)) to = from;
      // The cap: at most MAX_RANGE_NIGHTS nights, counting both ends.
      if (daysBetween(from, to) >= MAX_RANGE_NIGHTS) to = addDays(from, MAX_RANGE_NIGHTS - 1);
      return { first: from, last: to };
    }
  }
}

/**
 * The time range to ask the server for.
 *
 * @param filter - the filter.
 * @param now - the current moment.
 * @returns
 *   - `endsAfter`: now (events already over are left out);
 *   - `startsFrom`: when the first night begins (5 AM New York), or null
 *     when the first night is tonight, so a party still going from earlier
 *     stays on the list (as in VC-61);
 *   - `startsBefore`: 5 AM New York the morning after the last night.
 */
export function filterWindow(
  filter: DateFilter,
  now: Date,
): { endsAfter: Date; startsFrom: Date | null; startsBefore: Date } {
  const { first, last } = filterNights(filter, now);
  const startsLater = isBefore(nightOf(now), first);
  return {
    endsAfter: now,
    startsFrom: startsLater ? nightBegins(first) : null,
    startsBefore: nightBegins(addDays(last, 1)),
  };
}

/**
 * The screen title for a filter.
 *
 * @param filter - the filter.
 * @param now - the current moment.
 * @returns "This week", "This weekend", one night's short date ("Sat,
 *   Nov 8"), or a range ("Nov 6 – Nov 15"; just the date if it is one night).
 */
export function filterTitle(filter: DateFilter, now: Date): string {
  if (filter.kind === 'week') return FILTER_LABELS.week;
  if (filter.kind === 'weekend') return FILTER_LABELS.weekend;
  const { first, last } = filterNights(filter, now);
  if (filter.kind === 'date' || daysBetween(first, last) === 0) return shortDate(first);
  return `${monthDay(first)} – ${monthDay(last)}`;
}

/**
 * The small line above the title.
 *
 * @param filter - the filter.
 * @param now - the current moment.
 * @returns in capitals: the week's nights ("SATURDAY TO FRIDAY"), the
 *   weekend's dates ("FRI, NOV 6 – SUN, NOV 8"), one night's weekday
 *   ("SATURDAY NIGHT"), or the number of nights in a range ("10 NIGHTS").
 */
export function filterKicker(filter: DateFilter, now: Date): string {
  const { first, last } = filterNights(filter, now);
  switch (filter.kind) {
    case 'week':
      return weekKicker(now);
    case 'weekend':
      return `${shortDate(first)} – ${shortDate(last)}`.toUpperCase();
    case 'date':
      return `${weekdayName(first)} night`.toUpperCase();
    case 'range': {
      const nights = daysBetween(first, last) + 1;
      return nights === 1 ? '1 NIGHT' : `${nights} NIGHTS`;
    }
  }
}

/**
 * The empty-state words for a filter with no events.
 *
 * @param filter - the filter.
 * @param now - the current moment.
 * @returns a heading and a sentence. Every filter but "This week" also
 *   gets a "Show this week" button on screen (the way back).
 */
export function filterEmptyText(filter: DateFilter, now: Date): { title: string; body: string } {
  const hint = 'Pull down to refresh, or check back later.';
  switch (filter.kind) {
    case 'week':
      return {
        title: 'Nothing on this week yet',
        body: `No events in the next 7 nights yet. ${hint}`,
      };
    case 'weekend':
      return {
        title: 'Nothing on this weekend yet',
        body: `No events Friday to Sunday night yet. ${hint}`,
      };
    case 'date':
      return {
        title: `Nothing on ${filterTitle(filter, now)} yet`,
        body: `No events that night yet. ${hint}`,
      };
    case 'range':
      return {
        title: `Nothing on ${filterTitle(filter, now)} yet`,
        body: `No events in those dates yet. ${hint}`,
      };
  }
}
