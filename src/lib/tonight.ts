/**
 * Date and time helpers for the Tonight list and the event page (VC-B05).
 *
 * What it does: works out which events belong on the Tonight list (tonight's
 * and tomorrow night's), writes times the way people say them ("9 PM",
 * "10:30 PM"), labels each event's night ("On now", "Today", "Tomorrow"),
 * splits the list into a "Today" and a "Tomorrow" section, and makes the
 * "SATURDAY NIGHT" line.
 *
 * Two rules shape everything here:
 *   1. New York time, not the phone's. VibeCheck is a DC-area app and the
 *      server's day rules use America/New_York (like the age gate,
 *      src/lib/age.ts). A visitor's phone, or one set to the wrong zone,
 *      must still see "10 PM" for a 10 PM party.
 *   2. A "night" runs from 5:00 AM to 5:00 AM the next morning (see
 *      NIGHT_ENDS_HOUR). At 1 AM on Sunday it is still "Saturday night", so
 *      "Today" still means Saturday night's events.
 *
 * Every function takes `now` as an input instead of reading the clock, so
 * tests can pin the time.
 */
import { GATE_TIME_ZONE } from '@/lib/age';

/** The time zone all event days and clock times use (the server's zone). */
export const EVENT_TIME_ZONE = GATE_TIME_ZONE;

/**
 * The hour (New York time, 24-hour clock) when one night ends and the next
 * day begins. 5 means 5:00 AM: between midnight and 5 AM it still counts as
 * the previous evening's night. A product default; the founder can change it
 * here and everything else follows.
 */
export const NIGHT_ENDS_HOUR = 5;

/** The public facts about an event, as the app reads them (never a location). */
export interface PublicEvent {
  id: string;
  title: string;
  /** Neighbourhood label such as "Shaw, DC". Never an address. */
  area_label: string;
  /** ISO time text from the server, e.g. "2026-10-31T02:00:00+00:00". */
  starts_at: string;
  ends_at: string;
  /** 'host' or 'staff_pick' (a venue event the team picked, VC-29). */
  source: string;
  /** Ticket page link, only for staff picks (eventbrite.com, VC-29). */
  ticket_url: string | null;
  /**
   * VC-40: the host's "How to get in" page (Partiful, Posh...), host events
   * only, or null. Optional here so older test data needn't list it.
   */
  entry_url?: string | null;
  /** VC-37: 'DC', 'MD' or 'VA', or null for older events. Optional like entry_url. */
  state?: string | null;
  /** Our own short summary (15 words max), or null. */
  summary: string | null;
  /** True when the event is 21 and over (VC-10). */
  is_21_plus: boolean;
  /** True for test events (only testers can read these; RLS decides). */
  is_test: boolean;
}

/** A section of the Tonight list: a heading plus its events. */
export interface EventSection {
  /** 'Today' or 'Tomorrow'. */
  title: string;
  data: PublicEvent[];
}

/** A calendar date with no time (month 1-12). */
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/** A calendar date and clock time in New York (hour 0-23). */
interface ZonedParts extends CivilDate {
  hour: number;
  minute: number;
}

/** Weekday names, Sunday first (the order JavaScript's getUTCDay uses). */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Reads the New York date and clock time of a moment.
 *
 * @param date - the moment.
 * @returns year, month, day, hour (0-23) and minute in New York.
 * How: Intl.DateTimeFormat converts a moment into any time zone (the same
 * approach as todayInZone in src/lib/age.ts). If the phone has no time-zone
 * data (very old phones), we fall back to the phone's own clock, which is
 * right for anyone actually in the DC area.
 */
function zonedParts(date: Date): ZonedParts {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: EVENT_TIME_ZONE,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      // h23 = a 0-23 clock, so midnight is 0, not "24" or "12".
      hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const result = {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      // Some engines still write midnight as 24; "% 24" turns it into 0.
      hour: get('hour') % 24,
      minute: get('minute'),
    };
    if (Object.values(result).every(Number.isFinite)) return result;
  } catch {
    // No time-zone data on this phone. Use the backup below.
  }
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

/**
 * Moves a calendar date by whole days.
 *
 * @param date - the starting date.
 * @param days - how many days to add (negative goes back).
 * @returns the new date. Date.UTC rolls "October 32" over to November 1, and
 *   UTC has no daylight-saving jumps, so this is plain calendar counting.
 */
function addDays(date: CivilDate, days: number): CivilDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

/**
 * Finds the moment when New York's clock shows a given date and time.
 *
 * @param date - the New York calendar date.
 * @param hour - the New York hour (0-23).
 * @param minute - the New York minute (0-59); defaults to 0 (on the hour).
 * @returns that moment.
 * How: first pretend New York is on UTC, see how far New York's clock is
 * from UTC at that moment (4 or 5 hours, depending on daylight saving), and
 * correct by that much. Then check once more, in case the correction crossed
 * a daylight-saving change.
 * Daylight-saving edge cases (changes happen at 2 AM New York time):
 *   - In November, 1:00-1:59 AM happens twice; this returns the first one
 *     (still daylight time), which is what someone typing "1:30 AM" for a
 *     party that started the evening before means.
 *   - In March, 2:00-2:59 AM never happens; a time typed in that gap comes
 *     out one hour earlier (2:30 AM becomes 1:30 AM standard time).
 *   - 5 AM (the night cutoff) always exists exactly once, so night edges are exact.
 * Also used by the admin form (src/lib/event-form.ts) to turn typed times
 * into New York moments.
 */
export function zonedMoment(date: CivilDate, hour: number, minute = 0): Date {
  const wanted = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  /** How far New York's clock reads from UTC at moment `ms` (negative: behind). */
  const offsetAt = (ms: number) => {
    const p = zonedParts(new Date(ms));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - ms;
  };
  let guess = wanted - offsetAt(wanted);
  guess = wanted - offsetAt(guess);
  return new Date(guess);
}

/**
 * Which night a moment belongs to, named by the evening's date.
 *
 * @param date - the moment.
 * @returns New York's date, except between midnight and NIGHT_ENDS_HOUR,
 *   when it's the day before (1 AM Sunday belongs to Saturday night).
 */
function nightOf(date: Date): CivilDate {
  const p = zonedParts(date);
  const day = { year: p.year, month: p.month, day: p.day };
  return p.hour < NIGHT_ENDS_HOUR ? addDays(day, -1) : day;
}

/**
 * Says whether two calendar dates are the same day.
 *
 * @returns true when year, month and day all match.
 */
function sameDate(a: CivilDate, b: CivilDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * The weekday name of a calendar date.
 *
 * @param date - the date.
 * @returns for example "Saturday".
 */
function weekdayName(date: CivilDate): string {
  return WEEKDAYS[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()];
}

/**
 * When a night begins: NIGHT_ENDS_HOUR (5 AM) on its date, New York time.
 *
 * @param now - the current moment.
 * @param nights - 0 for tonight, 1 for tomorrow night, 2 for the night after.
 * @returns that moment.
 */
export function nightStart(now: Date, nights = 0): Date {
  return zonedMoment(addDays(nightOf(now), nights), NIGHT_ENDS_HOUR);
}

/**
 * The small line above the Tonight title, for example "SATURDAY NIGHT".
 *
 * @param now - the current moment.
 * @returns tonight's weekday plus "NIGHT", in capitals. At 1 AM on Sunday it
 *   is still "SATURDAY NIGHT" (the night runs until NIGHT_ENDS_HOUR).
 */
export function tonightKicker(now: Date): string {
  return `${weekdayName(nightOf(now))} night`.toUpperCase();
}

/**
 * The time range the Tonight list asks the server for.
 *
 * @param now - the current moment.
 * @returns `endsAfter` (now: events already over are left out) and
 *   `startsBefore` (when the night after tomorrow begins, 5 AM New York;
 *   later events are left out).
 * Why "ends after now" and not "starts after now": a party that started at
 * 10 PM is still worth showing at 11 PM, while it's going on.
 */
export function tonightWindow(now: Date): { endsAfter: Date; startsBefore: Date } {
  return { endsAfter: now, startsBefore: nightStart(now, 2) };
}

/**
 * Writes a clock time the way people say it, in New York time.
 *
 * @param date - the moment.
 * @returns "9 PM" on the hour, otherwise "9:30 PM"; "12 AM" is midnight.
 * Why not toLocaleTimeString: phones and test machines format it slightly
 * differently (some add a hidden special space before "PM"), so we build
 * the text ourselves and it is the same everywhere.
 */
export function formatClock(date: Date): string {
  const { hour, minute } = zonedParts(date);
  const suffix = hour < 12 ? 'AM' : 'PM';
  // 0 becomes 12 (midnight), 13 becomes 1, and so on.
  const hours12 = hour % 12 === 0 ? 12 : hour % 12;
  const mins = minute === 0 ? '' : `:${String(minute).padStart(2, '0')}`;
  return `${hours12}${mins} ${suffix}`;
}

/**
 * Labels when an event is, relative to now.
 *
 * @param event - needs starts_at and ends_at.
 * @param now - the current moment.
 * @returns "On now" while it's going on; otherwise by the night it starts
 *   in: "Today" (tonight, including 1 AM tonight), "Tomorrow", or the
 *   night's weekday (e.g. "Friday") for anything further away.
 */
export function dayLabel(event: Pick<PublicEvent, 'starts_at' | 'ends_at'>, now: Date): string {
  const starts = new Date(event.starts_at);
  const ends = new Date(event.ends_at);
  if (starts <= now && now < ends) return 'On now';
  const tonight = nightOf(now);
  const eventNight = nightOf(starts);
  if (sameDate(eventNight, tonight)) return 'Today';
  if (sameDate(eventNight, addDays(tonight, 1))) return 'Tomorrow';
  return weekdayName(eventNight);
}

/**
 * The short "when" line for a list card.
 *
 * @param event - needs starts_at and ends_at.
 * @param now - the current moment.
 * @returns "On now · until 2 AM" for a running event, otherwise for example
 *   "Today · 10 PM" or "Tomorrow · 9:30 PM".
 */
export function whenLine(event: Pick<PublicEvent, 'starts_at' | 'ends_at'>, now: Date): string {
  const label = dayLabel(event, now);
  if (label === 'On now') return `On now · until ${formatClock(new Date(event.ends_at))}`;
  return `${label} · ${formatClock(new Date(event.starts_at))}`;
}

/**
 * The full time range for the event page.
 *
 * @param event - needs starts_at and ends_at.
 * @param now - the current moment.
 * @returns for example "Today · 9 PM – 2 AM" or "On now · 9 PM – 2 AM".
 */
export function timeRange(event: Pick<PublicEvent, 'starts_at' | 'ends_at'>, now: Date): string {
  const start = formatClock(new Date(event.starts_at));
  const end = formatClock(new Date(event.ends_at));
  return `${dayLabel(event, now)} · ${start} – ${end}`;
}

/**
 * Splits the list into "Today" and "Tomorrow" sections, keeping the order.
 *
 * @param events - events from the server, sorted by start time.
 * @param now - the current moment.
 * @returns up to two sections; an empty section is left out. Anything that
 *   starts before tomorrow night begins (5 AM New York) goes in "Today",
 *   including a party still going from earlier.
 */
export function groupByDay(events: PublicEvent[], now: Date): EventSection[] {
  const tomorrow = nightStart(now, 1);
  const today: PublicEvent[] = [];
  const next: PublicEvent[] = [];
  for (const event of events) {
    if (new Date(event.starts_at) < tomorrow) today.push(event);
    else next.push(event);
  }
  const sections: EventSection[] = [];
  if (today.length > 0) sections.push({ title: 'Today', data: today });
  if (next.length > 0) sections.push({ title: 'Tomorrow', data: next });
  return sections;
}

/**
 * Whether an event is a staff pick (a venue event the team picked, VC-29).
 *
 * @param event - needs source.
 * @returns true for source 'staff_pick'.
 */
export function isStaffPick(event: Pick<PublicEvent, 'source'>): boolean {
  return event.source === 'staff_pick';
}
