/**
 * How the home screen splits into sections (VC-84, Direction A "Bands",
 * founder chose it 2026-10-29; design/vc84-home-sections-spec.md).
 *
 * Before VC-84 every part of Home sat on the same background under the same
 * small grey label, so the page read as one long run of cards. Direction A
 * gives each question its own full-width colour "band", top to bottom:
 *   1. Live now       events that have started tonight (surface band with a
 *                     gold top line). The VC-80 hero sits here when it is a
 *                     live or on-now pick;
 *   2. Later tonight  tonight's events that haven't started (plain band).
 *                     A "Next up" hero sits here instead;
 *   3. Staff picks    the staff-picked events that haven't ended (on now
 *                     or still to come), repeated from the rest of the
 *                     list (at most 5; surface band);
 *   4. Coming up      tomorrow onwards, one block per night, each night's
 *                     heading saying its date and how many events it has.
 * Empty sections are simply left out (spec: no "0" sections).
 *
 * Special nights (Halloween, New Year's Eve) come from a small list kept
 * here in code and edited by the team (spec section 5), not from the
 * server: a special night's heading turns gold and its first event becomes a
 * gold-edged feature card.
 *
 * Everything here is a plain function with no React and no server calls,
 * so the tests can pin every rule. No new data: only what the screen
 * already has (the events, their start and end times, the staff flag, and
 * the VC-80 hero pick). Counts are only how many cards a section shows.
 */
import type { HeroPick, HomeLayout } from '@/lib/home-layout';
import { hasStarted, isOnNow, isStaffPick, monthDay, nightOf } from '@/lib/tonight';
import type { CivilDate, EventSection, PublicEvent } from '@/lib/tonight';

/** A night that gets the gold treatment, by its calendar date (any year). */
export interface SpecialNight {
  /** Month, 1 to 12. */
  month: number;
  /** Day of the month. */
  day: number;
  /** The name shown on its tag, e.g. "Halloween". */
  name: string;
}

/**
 * The special nights (spec section 5: "a small special-night date list in
 * code, edited by the team"). Dates are NIGHT dates in New York, so a party
 * at 1 AM on Nov 1 still counts as Halloween night (src/lib/tonight.ts
 * nightOf). To add one, add a line here; nothing else changes.
 */
export const SPECIAL_NIGHTS: readonly SpecialNight[] = [
  { month: 10, day: 31, name: 'Halloween' },
  { month: 12, day: 31, name: "New Year's Eve" },
];

/** The most staff picks the Staff picks band shows (spec: "max 5"). */
export const STAFF_PICKS_MAX = 5;

/** Section titles (exported so tests use the same words). */
export const LIVE_NOW_TITLE = 'Live now';
/**
 * The first band's title when everything started tonight has already ended.
 * Not in the spec, which only names "Live now": the spec doesn't cover a
 * band where nothing is on any more (an event that ended while the screen
 * was open), and calling that "Live now" would be untrue. Kept and reported
 * to the product-manager (VC-84 polish).
 */
export const EARLIER_TONIGHT_TITLE = 'Earlier tonight';
export const LATER_TONIGHT_TITLE = 'Later tonight';
export const STAFF_PICKS_TITLE = 'Staff picks';
export const COMING_UP_TITLE = 'Coming up';

/**
 * Looks up a night in the special-night list.
 *
 * @param date - the night's calendar date (New York).
 * @param list - the list to look in (the tests pass their own; the app uses
 *   SPECIAL_NIGHTS).
 * @returns the night's name, e.g. "Halloween", or null for an ordinary night.
 */
export function specialNight(
  date: CivilDate,
  list: readonly SpecialNight[] = SPECIAL_NIGHTS,
): string | null {
  const found = list.find((night) => night.month === date.month && night.day === date.day);
  return found ? found.name : null;
}

/** One tonight band (Live now or Later tonight). */
export interface TonightBand {
  /** 'live' for the surface band with the gold line, 'later' for the plain one. */
  kind: 'live' | 'later';
  /** "Live now", "Earlier tonight" or "Later tonight". */
  title: string;
  /** The VC-80 hero, when it belongs in this band; else null. */
  hero: HeroPick | null;
  /** The band's other events, in the VC-80 carousel order. */
  others: PublicEvent[];
  /** How many events the band shows (hero included). */
  count: number;
}

/**
 * Splits tonight's events (the VC-80 hero and the others) into the Live now
 * and Later tonight bands.
 *
 * The hero RULE is unchanged (src/lib/home-layout.ts pickHero picks the
 * event); this only decides which band it sits in: a hero that has started
 * (live, on now, or the rare "only ended events left" pick) opens the Live
 * now band; a "Next up" hero, which hasn't started, opens Later tonight.
 *
 * @param layout - the VC-80 home layout (hero plus the other tonight events,
 *   already in carousel order).
 * @param now - the current moment.
 * @returns zero, one or two bands, Live now first. A band with no events is
 *   left out. The first band is titled "Live now" when anything in it is on
 *   now, else "Earlier tonight" (everything in it has ended: rare, an event
 *   that finished while the screen was open).
 */
export function tonightBands(
  layout: Pick<HomeLayout, 'hero' | 'others'>,
  now: Date,
): TonightBand[] {
  const { hero, others } = layout;
  const heroStarted = hero !== null && hasStarted(hero.event, now);
  // `others` keeps its carousel order, so each band's cards stay in that
  // order too (live with a score first, then on now, then by start time).
  const startedOthers = others.filter((e) => hasStarted(e, now));
  const laterOthers = others.filter((e) => !hasStarted(e, now));
  const bands: TonightBand[] = [];

  const liveHero = heroStarted ? hero : null;
  const liveCount = (liveHero ? 1 : 0) + startedOthers.length;
  if (liveCount > 0) {
    const anyOnNow =
      (liveHero !== null && isOnNow(liveHero.event, now)) ||
      startedOthers.some((e) => isOnNow(e, now));
    bands.push({
      kind: 'live',
      title: anyOnNow ? LIVE_NOW_TITLE : EARLIER_TONIGHT_TITLE,
      hero: liveHero,
      others: startedOthers,
      count: liveCount,
    });
  }

  const laterHero = hero !== null && !heroStarted ? hero : null;
  const laterCount = (laterHero ? 1 : 0) + laterOthers.length;
  if (laterCount > 0) {
    bands.push({
      kind: 'later',
      title: LATER_TONIGHT_TITLE,
      hero: laterHero,
      others: laterOthers,
      count: laterCount,
    });
  }
  return bands;
}

/**
 * The events for the Staff picks band: staff-picked events that haven't
 * ended, soonest first, at most STAFF_PICKS_MAX. They also stay in their
 * own night below (spec: repeats allowed, founder approved with A).
 *
 * @param events - every event the list loaded (tonight and later).
 * @param now - the current moment.
 * @returns a new array (the input isn't changed). Ties on start time go by
 *   id, so the order never jumps between draws.
 */
export function staffPicks(events: PublicEvent[], now: Date): PublicEvent[] {
  return events
    .filter((e) => isStaffPick(e) && Date.parse(e.ends_at) > now.getTime())
    .sort((a, b) => {
      const diff = Date.parse(a.starts_at) - Date.parse(b.starts_at);
      if (diff !== 0) return diff;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, STAFF_PICKS_MAX);
}

/** One night under "Coming up": the list section plus its heading parts. */
export interface DaySection extends EventSection {
  /** The heading in capitals, e.g. "FRIDAY, OCT 30". */
  heading: string;
  /** The count in capitals, e.g. "2 EVENTS". */
  countText: string;
  /** What screen readers hear, e.g. "Friday, Oct 30, 2 events". */
  spoken: string;
  /** The special night's name (gold heading and feature card), or null. */
  special: string | null;
}

/**
 * "1 event" / "3 events".
 *
 * @param n - how many.
 * @returns the count with the right word.
 */
export function eventsText(n: number): string {
  return `${n} ${n === 1 ? 'event' : 'events'}`;
}

/**
 * Adds the heading parts to each later night (tomorrow onwards).
 *
 * @param sections - the later nights from homeLayout (groupByDay titles:
 *   "Tomorrow", a weekday name, or a short date like "Sat, Nov 14" beyond a
 *   week).
 * @param list - the special nights (tests pass their own).
 * @returns the same sections (same order and events) with a heading such as
 *   "TOMORROW, OCT 30", "FRIDAY, OCT 30" or "SAT, NOV 14" (a short-date title
 *   already holds its date, so none is added), the count text, the spoken
 *   heading, and the special night's name. The night's date is read from its
 *   first event (all of a section's events share one night).
 */
export function comingUpDays(
  sections: EventSection[],
  list: readonly SpecialNight[] = SPECIAL_NIGHTS,
): DaySection[] {
  return sections
    .filter((section) => section.data.length > 0)
    .map((section) => {
      const night = nightOf(new Date(section.data[0].starts_at));
      // groupByDay's short-date titles ("Sat, Nov 14") already carry the date.
      const label = section.title.includes(',')
        ? section.title
        : `${section.title}, ${monthDay(night)}`;
      const special = specialNight(night, list);
      const count = eventsText(section.data.length);
      return {
        ...section,
        heading: label.toUpperCase(),
        countText: count.toUpperCase(),
        spoken: [label, special, count].filter(Boolean).join(', '),
        special,
      };
    });
}

/**
 * What screen readers hear for a section heading (spec: "every section
 * title is a heading and says its count").
 *
 * @param title - e.g. "Live now".
 * @param count - how many events, or null for a heading without one.
 * @param special - tonight's special night name, or null.
 * @returns e.g. "Live now, Halloween, 3 events".
 */
export function headingSpoken(title: string, count: number | null, special: string | null): string {
  return [title, special, count === null ? null : eventsText(count)].filter(Boolean).join(', ');
}
