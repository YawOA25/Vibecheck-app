/**
 * How the home screen lays out tonight's events (VC-80, Concept A "Live hero
 * + carousel", design/vc80-home-redesign-spec.md).
 *
 * The home list used to be one even list of cards. VC-80 splits it in two:
 *   1. TONIGHT at the top: one big "hero" card, then the other tonight
 *      events in a sideways carousel (or one wide card when there is only
 *      one other);
 *   2. LATER (tomorrow onwards) underneath, as the usual cards with a day
 *      heading per night that sticks to the top while you scroll.
 * VC-84 then splits these into colour bands (Live now, Later tonight, Staff
 * picks, Coming up); that split lives in src/lib/home-sections.ts and uses
 * the hero and order worked out here unchanged.
 *
 * Everything here is a plain function with no React and no server calls,
 * so the tests can pin every rule (tonight.test.ts style). The screen
 * (app/(tabs)/index.tsx) passes in the events, the vibes it already loaded
 * and the current moment.
 *
 * Privacy (VC-80 spec "Rules both concepts keep"): the only scores used
 * here are the PUBLISHED snapshots the cards already show (the `vibes` the
 * screen got from getEventsVibe). Nothing here reads ratings, and an event
 * that hasn't started never counts as live, whatever its vibe says.
 */
import type { DateFilter } from '@/lib/date-filter';
import { hasStarted, isOnNow } from '@/lib/tonight';
import type { EventSection, PublicEvent } from '@/lib/tonight';
import type { Vibe } from '@/lib/vibe';

/**
 * Why the hero card was picked, which decides its small label and what it
 * shows on the right:
 *   live    the live event with the highest live score (gauge + LIVE);
 *   next    nothing has a live score: the soonest event still to start
 *           ("Next up": no gauge, no LIVE);
 *   onNow   nothing has a live score and nothing is still to start, but
 *           an event is on (its Early / No vibe yet chip, and LIVE);
 *   tonight only finished events are left (rare: one ended while the
 *           screen was open). Plain label, no LIVE.
 */
export type HeroKind = 'live' | 'next' | 'onNow' | 'tonight';

/** The hero card's event and why it was picked. */
export interface HeroPick {
  event: PublicEvent;
  kind: HeroKind;
}

/**
 * How the tonight part looks, by how many tonight events there are (spec
 * "States"):
 *   none      no tonight events (no hero; maybe the moon note, see below);
 *   hero      1 event: the hero only;
 *   pair      2 events: the hero plus one full-width art card;
 *   carousel  3 or more: the hero plus a sideways carousel.
 */
export type TonightShape = 'none' | 'hero' | 'pair' | 'carousel';

/** Everything the home list needs to draw itself. */
export interface HomeLayout {
  /** The hero card, or null with no tonight events. */
  hero: HeroPick | null;
  /** The other tonight events, in carousel order (see orderTonight). */
  others: PublicEvent[];
  /** Tomorrow onwards, one section per night (sticky headings). */
  later: EventSection[];
  /** Which tonight look to use. */
  shape: TonightShape;
}

/** The small label over the hero when the top live word is Hot or Fire (spec). */
export const ON_FIRE_LABEL = 'ON FIRE RIGHT NOW';
/**
 * The label when the top live word is only Quiet or Good. Saying "on fire"
 * over a 3.2 "Quiet" would be untrue, so the label stays honest.
 */
export const LIVE_NOW_LABEL = 'LIVE RIGHT NOW';
/** The label when nothing has a live score yet (spec: "Next up"). */
export const NEXT_UP_LABEL = 'NEXT UP';
/** The label for an event that is on but has no live score yet. */
export const ON_NOW_LABEL = 'ON NOW';
/** The label when only finished events are left tonight. */
export const TONIGHT_LABEL = 'TONIGHT';

/**
 * Whether an event counts as "live with a score" right now: it is on (started,
 * not ended) and its published snapshot is in the 'live' state with a number.
 *
 * @param event - the event (needs starts_at and ends_at).
 * @param vibe - its published vibe, or undefined when none was loaded.
 * @param now - the current moment.
 * @returns true only for a live score. A 'stale' score (no new rating for 90
 *   minutes), Early, No vibe yet, or an event not started or already over
 *   never counts.
 */
export function hasLiveScore(event: PublicEvent, vibe: Vibe | undefined, now: Date): boolean {
  return isOnNow(event, now) && vibe !== undefined && vibe.state === 'live' && vibe.score !== null;
}

/**
 * Sorting group for an event (smaller comes first).
 *
 * @returns 0 live with a score, 1 on now without a live score, 2 not
 *   started yet, 3 already over.
 */
function rank(event: PublicEvent, vibe: Vibe | undefined, now: Date): number {
  if (hasLiveScore(event, vibe, now)) return 0;
  if (isOnNow(event, now)) return 1;
  if (!hasStarted(event, now)) return 2;
  return 3;
}

/**
 * Puts tonight's events in their carousel order (spec "Page order"):
 * live with a score first (highest score first; a tie goes to the one with
 * more people here), then events on now without a live score, then events
 * still to start (soonest first), then any that already ended.
 *
 * @param events - tonight's events.
 * @param vibes - each started event's published vibe, by id.
 * @param now - the current moment.
 * @returns a new array; the input isn't changed. Remaining ties go by
 *   start time, then by id, so the order never jumps around between draws.
 */
export function orderTonight(
  events: PublicEvent[],
  vibes: Record<string, Vibe>,
  now: Date,
): PublicEvent[] {
  return [...events].sort((a, b) => {
    const va = vibes[a.id];
    const vb = vibes[b.id];
    const ra = rank(a, va, now);
    const rb = rank(b, vb, now);
    if (ra !== rb) return ra - rb;
    if (ra === 0) {
      // Both live with a score: higher score, then more people here.
      const scoreDiff = (vb?.score ?? 0) - (va?.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      const hereDiff = (vb?.here ?? 0) - (va?.here ?? 0);
      if (hereDiff !== 0) return hereDiff;
    }
    const startDiff = Date.parse(a.starts_at) - Date.parse(b.starts_at);
    if (startDiff !== 0) return startDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Picks the hero card (spec "Hero rule"): the live event with the highest
 * live score; with none, "Next up", the soonest event still to start.
 *
 * @param events - tonight's events.
 * @param vibes - each started event's published vibe, by id.
 * @param now - the current moment.
 * @returns the pick, or null when there are no events. When nothing has a
 *   live score and nothing is still to start, the first event on now is
 *   used ('onNow'), or failing that the first event ('tonight').
 */
export function pickHero(
  events: PublicEvent[],
  vibes: Record<string, Vibe>,
  now: Date,
): HeroPick | null {
  const ordered = orderTonight(events, vibes, now);
  const first = ordered[0];
  if (!first) return null;
  if (hasLiveScore(first, vibes[first.id], now)) return { event: first, kind: 'live' };
  // orderTonight puts upcoming events in start order, so the first found
  // is the soonest.
  const next = ordered.find((e) => !hasStarted(e, now));
  if (next) return { event: next, kind: 'next' };
  return { event: first, kind: isOnNow(first, now) ? 'onNow' : 'tonight' };
}

/**
 * Splits the home list into the tonight part and the later part.
 *
 * @param sections - the list's night sections (groupByDay), first one
 *   titled "Tonight" when there are tonight events.
 * @param vibes - each started event's published vibe, by id.
 * @param now - the current moment (moves on with the minute refresh).
 * @returns the hero, the other tonight events in order, the later sections
 *   and the tonight shape.
 */
export function homeLayout(
  sections: EventSection[],
  vibes: Record<string, Vibe>,
  now: Date,
): HomeLayout {
  const hasTonight = sections[0]?.title === 'Tonight';
  const tonight = hasTonight ? sections[0].data : [];
  const later = hasTonight ? sections.slice(1) : sections;
  const hero = pickHero(tonight, vibes, now);
  const others = hero
    ? orderTonight(tonight, vibes, now).filter((e) => e.id !== hero.event.id)
    : [];
  return { hero, others, later, shape: tonightShape(tonight.length) };
}

/**
 * The tonight look for a number of tonight events.
 *
 * @param count - how many tonight events.
 * @returns 'none' (0), 'hero' (1), 'pair' (2) or 'carousel' (3 or more).
 */
export function tonightShape(count: number): TonightShape {
  if (count <= 0) return 'none';
  if (count === 1) return 'hero';
  if (count === 2) return 'pair';
  return 'carousel';
}

/**
 * The small label over the hero card.
 *
 * @param pick - the hero pick.
 * @param vibe - the hero event's vibe (for the live word).
 * @returns "ON FIRE RIGHT NOW" for a live Hot or Fire score, "LIVE RIGHT
 *   NOW" for a live Quiet or Good one, else "NEXT UP", "ON NOW" or "TONIGHT".
 */
export function heroLabel(pick: HeroPick, vibe: Vibe | undefined): string {
  switch (pick.kind) {
    case 'live':
      return vibe?.label === 'Hot' || vibe?.label === 'Fire' ? ON_FIRE_LABEL : LIVE_NOW_LABEL;
    case 'next':
      return NEXT_UP_LABEL;
    case 'onNow':
      return ON_NOW_LABEL;
    default:
      return TONIGHT_LABEL;
  }
}

/**
 * The note shown when the filter covers tonight but tonight has no events,
 * above the later nights (spec: "None tonight: moon card + list").
 *
 * @param kind - the date filter's kind.
 * @returns a heading and a sentence, e.g. "Nothing on tonight yet" /
 *   "Here's what's coming up this week."
 */
export function nothingTonightText(kind: DateFilter['kind']): { title: string; body: string } {
  const when = kind === 'weekend' ? 'this weekend' : kind === 'week' ? 'this week' : 'next';
  return {
    title: 'Nothing on tonight yet',
    body: kind === 'custom' ? "Here's what's coming up next." : `Here's what's coming up ${when}.`,
  };
}

/**
 * How long until an event starts, the way people say it.
 *
 * @param event - needs starts_at.
 * @param now - the current moment.
 * @returns "in 20 min", "in 1 h 20 min", "in 2 h", or "" once it has
 *   started (the screen then shows nothing). Minutes are rounded up, so
 *   "in 1 min" shows until the very start, never "in 0 min".
 */
export function startsIn(event: Pick<PublicEvent, 'starts_at'>, now: Date): string {
  const ms = Date.parse(event.starts_at) - now.getTime();
  if (ms <= 0) return '';
  const totalMinutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `in ${minutes} min`;
  if (minutes === 0) return `in ${hours} h`;
  return `in ${hours} h ${minutes} min`;
}
