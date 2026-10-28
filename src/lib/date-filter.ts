/**
 * The home list's date filter (VC-63, revised by the founder 2026-10-27:
 * "I think we should a filter for tonight, this weekend, this week and then
 * custom").
 *
 * What it does: describes the four filters and works out, for each, which
 * nights it covers, the time range to ask the server for, and the words the
 * screen shows (title, small line above it, empty state). It also has the
 * rules for the Custom date flow (start date, optional end date) and for
 * the "where to find your new event" note shown after an admin creates one.
 *
 * The four filters, in the order the chips show:
 *   - "Tonight": tonight's night only, up to 5 AM New York time;
 *   - "This weekend": Friday, Saturday and Sunday nights. If it's already
 *     the weekend (Friday 5 AM to Monday 5 AM, New York), the current one;
 *   - "This week" (the default): tonight and the next 6 nights (VC-61);
 *   - "Custom": one date, or a range of nights from one date to another
 *     (up to MAX_RANGE_NIGHTS). One date is simply a range whose start and
 *     end are the same night.
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

/**
 * One of the four filters. Dates are night dates (the evening's date).
 * For Custom, `from` and `to` are equal when the guest picked one date.
 */
export type DateFilter =
  | { kind: 'tonight' }
  | { kind: 'weekend' }
  | { kind: 'week' }
  | { kind: 'custom'; from: CivilDate; to: CivilDate };

/** The default filter: this week (VC-61). */
export const THIS_WEEK: DateFilter = { kind: 'week' };

/** Chip words (exported so tests use the same words). */
export const FILTER_LABELS = {
  tonight: 'Tonight',
  weekend: 'This weekend',
  week: 'This week',
  custom: 'Custom',
} as const;

/** The chips' order on screen (founder's brief: Tonight first, Custom last). */
export const FILTER_ORDER: DateFilter['kind'][] = ['tonight', 'weekend', 'week', 'custom'];

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
 *   - tonight: just tonight (until 5 AM New York);
 *   - weekend: Friday to Sunday. Tonight is Friday, Saturday or Sunday
 *     night (so up to Monday 5 AM): this weekend; otherwise the coming one;
 *   - week: tonight to tonight + 6;
 *   - custom: as picked, put in order if picked backwards, starting no
 *     earlier than tonight, and cut to MAX_RANGE_NIGHTS nights.
 */
export function filterNights(filter: DateFilter, now: Date): { first: CivilDate; last: CivilDate } {
  const tonight = nightOf(now);
  switch (filter.kind) {
    case 'tonight':
      return { first: tonight, last: tonight };
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
    case 'custom': {
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
 * The short words for a custom choice, e.g. "Sat, Nov 8" for one night or
 * "Nov 6 – Nov 9" for a range. Used for the title and the tappable summary
 * under the chips.
 *
 * @param first - the first night.
 * @param last - the last night.
 * @returns the readable dates.
 */
export function rangeText(first: CivilDate, last: CivilDate): string {
  if (daysBetween(first, last) === 0) return shortDate(first);
  return `${monthDay(first)} – ${monthDay(last)}`;
}

/**
 * The screen title for a filter.
 *
 * @param filter - the filter.
 * @param now - the current moment.
 * @returns "Tonight", "This weekend", "This week", or for Custom one
 *   night's short date ("Sat, Nov 8") or a range ("Nov 6 – Nov 15").
 */
export function filterTitle(filter: DateFilter, now: Date): string {
  if (filter.kind !== 'custom') return FILTER_LABELS[filter.kind];
  const { first, last } = filterNights(filter, now);
  return rangeText(first, last);
}

/**
 * The small line above the title.
 *
 * @param filter - the filter.
 * @param now - the current moment.
 * @returns in capitals: tonight's date ("SAT, OCT 31"), the weekend's dates
 *   ("FRI, NOV 6 – SUN, NOV 8"), the week's nights ("SATURDAY TO FRIDAY"),
 *   or for Custom one night's weekday ("SATURDAY NIGHT") or the number of
 *   nights ("10 NIGHTS").
 */
export function filterKicker(filter: DateFilter, now: Date): string {
  const { first, last } = filterNights(filter, now);
  switch (filter.kind) {
    case 'tonight':
      return shortDate(first).toUpperCase();
    case 'week':
      return weekKicker(now);
    case 'weekend':
      return `${shortDate(first)} – ${shortDate(last)}`.toUpperCase();
    case 'custom': {
      const nights = daysBetween(first, last) + 1;
      return nights === 1 ? `${weekdayName(first)} night`.toUpperCase() : `${nights} NIGHTS`;
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
    case 'tonight':
      return { title: 'Nothing on tonight yet', body: `No events tonight yet. ${hint}` };
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
    case 'custom': {
      const { first, last } = filterNights(filter, now);
      const oneNight = daysBetween(first, last) === 0;
      return {
        title: `Nothing on ${filterTitle(filter, now)} yet`,
        body: `No events ${oneNight ? 'that night' : 'in those dates'} yet. ${hint}`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// The Custom flow: pick a start date, then (optionally) an end date.
// ---------------------------------------------------------------------------

/**
 * What the Custom picker holds while the guest chooses: the start night and
 * the end night, or null when no end is picked (then it's one night).
 */
export interface CustomDraft {
  start: CivilDate;
  end: CivilDate | null;
}

/**
 * The latest end date the picker allows for a start date (60 nights
 * counting both ends).
 *
 * @param start - the start night.
 * @returns the last allowed end night.
 */
export function latestEnd(start: CivilDate): CivilDate {
  return addDays(start, MAX_RANGE_NIGHTS - 1);
}

/**
 * The guest picked a start date.
 *
 * @param draft - what was picked so far.
 * @param start - the new start night.
 * @returns the new draft. The end is kept only if it still makes sense
 *   (after the new start and within the 60-night cap); otherwise it is
 *   cleared, so the picker never shows an impossible range.
 */
export function pickStart(draft: CustomDraft, start: CivilDate): CustomDraft {
  const { end } = draft;
  const keepEnd = end !== null && isBefore(start, end) && !isBefore(latestEnd(start), end);
  return { start, end: keepEnd ? end : null };
}

/**
 * The guest picked an end date.
 *
 * @param draft - what was picked so far.
 * @param end - the picked end night.
 * @returns the new draft. Picking the start night itself means "one night"
 *   (no end); an end before the start is treated as one night too (the
 *   picker doesn't allow it, this is a safety net).
 */
export function pickEnd(draft: CustomDraft, end: CivilDate): CustomDraft {
  return { start: draft.start, end: isBefore(draft.start, end) ? end : null };
}

/**
 * Where the Custom picker starts: the current Custom dates if Custom is
 * picked, else tonight with no end.
 *
 * @param filter - the filter in use.
 * @param now - the current moment.
 * @returns the starting draft.
 */
export function draftFor(filter: DateFilter, now: Date): CustomDraft {
  if (filter.kind !== 'custom') return { start: nightOf(now), end: null };
  const { first, last } = filterNights(filter, now);
  return { start: first, end: daysBetween(first, last) === 0 ? null : last };
}

/**
 * Turns a finished draft into the Custom filter, tidied by the same rules
 * as the list (in order, no earlier than tonight, cut to the cap), so the
 * summary always shows exactly what the list covers.
 *
 * @param draft - the picked start and optional end.
 * @param now - the current moment.
 * @returns the Custom filter.
 */
export function customFromDraft(draft: CustomDraft, now: Date): DateFilter {
  const { first, last } = filterNights(
    { kind: 'custom', from: draft.start, to: draft.end ?? draft.start },
    now,
  );
  return { kind: 'custom', from: first, to: last };
}

// ---------------------------------------------------------------------------
// After creating an event: where to find it.
// ---------------------------------------------------------------------------

/**
 * Says whether a night is covered by a filter.
 *
 * @param filter - the filter.
 * @param night - the night date to check.
 * @param now - the current moment.
 * @returns true when `night` is between the filter's first and last nights.
 */
export function filterCoversNight(filter: DateFilter, night: CivilDate, now: Date): boolean {
  const { first, last } = filterNights(filter, now);
  return !isBefore(night, first) && !isBefore(last, night);
}

/**
 * The short note shown after an admin creates an event that the current
 * filter doesn't show (founder bug report 2026-10-27: "when i create an
 * event it doesnt not appesar on the screen").
 *
 * @param startsAt - the new event's start (an ISO date string or a Date).
 * @param filter - the filter on the home list.
 * @param now - the current moment.
 * @returns null when the list already covers the event's night; otherwise
 *   e.g. "Saved for Fri, Nov 14. Switch to Custom to see it." It names
 *   "This week" when that chip would show it, else "Custom".
 */
export function createdNotice(
  startsAt: string | Date,
  filter: DateFilter,
  now: Date,
): string | null {
  const night = nightOf(new Date(startsAt));
  if (filterCoversNight(filter, night, now)) return null;
  const chip = filterCoversNight(THIS_WEEK, night, now) ? FILTER_LABELS.week : FILTER_LABELS.custom;
  return `Saved for ${shortDate(night)}. Switch to ${chip} to see it.`;
}
