/**
 * The live vibe score (task VC-B09) and the "74 here" headcount (proposal
 * VC-42, count only): reading them from the server and turning them into
 * words for the screens.
 *
 * What it does (nothing here talks to the server; the calls are in
 * src/lib/vibe-api.ts, so screen tests can fake them and keep these words):
 *   - {@link parseVibe} checks the server's JSON and tidies it up;
 *   - the small "words" functions below build the lines the screens show,
 *     such as "Early reading: 3 people so far" or "updated 4 min ago". They
 *     are plain functions so the tests can check every wording.
 *
 * Why the server does the maths: the score is built from everyone's ratings,
 * and nobody's single rating row is ever readable from the app. The server
 * hands out totals only (supabase/migrations/20261027130000_vibe_score.sql
 * and its privacy follow-up 20261027130100_vibe_score_privacy.sql).
 *
 * Since 2026-10-27 (proposals VC-50, VC-51, VC-55, migrations
 * 20261027140000 to 20261027140200; 3 raters since VC-64, 20261027180000)
 * the server sends a PUBLISHED snapshot:
 * the score, rater count and reactions only change once 3 or more new
 * people have rated, so watching the meter can't reveal one person's
 * rating. The JSON shape is unchanged, so nothing here had to change; only
 * the meaning of two fields did (see `here` and `minutesSinceLast` below).
 *
 * Since VC-53 / VC-54 (migration 20261027200000_score_visuals.sql) the
 * snapshot also carries, only when a score shows:
 *   - `breakdown`: the Crowd / Music / Energy tile WORDS (never numbers);
 *   - `night`: the "All night" view, WORDS ONLY (the night's vibe word,
 *     count and tiles; the night ends at 5 AM New York). No night number is
 *     ever sent (cto, migration 20261027210000: an average next to its exact
 *     count could be subtracted across snapshots). The server leaves the night
 *     word out when showing it could single out a few people's ratings.
 */
import { REACTIONS, vibeLabel } from '@/lib/rating';
import type { ReactionKey, VibeLabel } from '@/lib/rating';

/**
 * The vibe's state (see the migration):
 *   none   no ratings yet;
 *   early  fewer than 5 ratings: a count, but no number yet;
 *   stale  no new rating for 90 minutes: the last score, faded look;
 *   live   the live score.
 */
export type VibeState = 'none' | 'early' | 'stale' | 'live';

/** One reaction's count in the tally. */
export interface ReactionCount {
  reaction: ReactionKey;
  count: number;
}

/** The words a Crowd tile can show (VC-53). */
export type CrowdWord = 'quiet' | 'good' | 'packed';
/** The words a Music tile can show. */
export type MusicWord = 'meh' | 'good' | 'fire';
/** The words an Energy tile can show. */
export type EnergyWord = 'low' | 'good' | 'fire';

/**
 * The three breakdown tiles (VC-53): one word each, worked out by the server
 * from the same ratings as the score. Never a number, so a tile can't reveal
 * one person's tap.
 */
export interface Breakdown {
  crowd: CrowdWord;
  music: MusicWord;
  energy: EnergyWord;
}

/**
 * The "All night" view (VC-54): every rating of this event's night (it ends
 * at 5 AM New York), as a plain average.
 */
export interface NightVibe {
  /**
   * The night's vibe word, or null when the server withheld it. There is no
   * night number: the app only ever gets the word (cto privacy fix).
   */
  label: VibeLabel | null;
  /** How many ratings the night holds ("112 ratings tonight"). */
  raters: number;
  /** The night's tile words, or null (withheld together with the word). */
  breakdown: Breakdown | null;
  /** true once the night's 5 AM New York has passed ("LAST NIGHT'S VIBE"). */
  over: boolean;
}

/** One event's vibe, tidied up from the server's answer. */
export interface Vibe {
  state: VibeState;
  /**
   * How many people's ratings count (hidden ones never do), as of the last
   * published score (VC-51), so it can lag up to two ratings behind (VC-64).
   */
  raters: number;
  /**
   * How many people are here (VC-42: a number only, never names). While the
   * event is on: check-ins confirmed in the last 3 hours (VC-55). After the
   * end time: everyone who checked in that night ("N were here").
   */
  here: number;
  /** live: the live score; stale: the last score; otherwise null. 0 to 10, 1 decimal. */
  score: number | null;
  /** The word for the score, or null when there is no score. */
  label: VibeLabel | null;
  /**
   * Read by builds from before VC-54. The server sends null since migration
   * 20261027210000 (no night number leaves the database), so this is null.
   */
  nightAverage: number | null;
  /**
   * Whole minutes since the newest rating in the published score (worked out
   * by the server's clock), or null. "Updated 4 min ago" means the score.
   */
  minutesSinceLast: number | null;
  /** stale and live: the reaction tally, most first. Empty otherwise. */
  reactions: ReactionCount[];
  /** stale and live: the live tile words (VC-53); otherwise null. */
  breakdown: Breakdown | null;
  /** stale and live: the "All night" view (VC-54); otherwise null. */
  night: NightVibe | null;
}

/** Which view of the score the event page shows (VC-54 switch). */
export type VibeView = 'live' | 'night';

/** What {@link getEventVibe} returns. */
export type VibeOutcome = { ok: true; vibe: Vibe } | { ok: false; message: string };

/** What {@link getEventsVibe} returns: each event's vibe by its id. */
export type VibesOutcome =
  { ok: true; vibes: Record<string, Vibe> } | { ok: false; message: string };

/** How often the event page asks for a fresh score while it's open (plan: 20 s). */
export const VIBE_REFRESH_MS = 20_000;

/** How often the Tonight list refreshes its scores while it's on screen. */
export const LIST_VIBE_REFRESH_MS = 60_000;

/** The most events the list call takes at once (the server's limit too). */
export const MAX_EVENTS_PER_CALL = 100;

/** The words for the vibe states (exported so tests use the same text). */
export const NO_VIBE_TITLE = 'No vibe yet';
export const NO_VIBE_BODY = 'No vibe yet. Be the first.';
export const EARLY_TITLE = 'Early reading';
export const VIBE_LOAD_ERROR = "We couldn't load the vibe.";
/** All night view with no word (withheld for privacy, or hidden ratings). */
export const NIGHT_WITHHELD_BODY = 'The night vibe will show a little later.';

/** The tiles, in the order they're shown: caps label and each word's display form. */
export const BREAKDOWN_TILES = [
  {
    key: 'crowd',
    label: 'CROWD',
    spoken: 'Crowd',
    words: { quiet: 'Quiet', good: 'Good', packed: 'Packed' },
  },
  {
    key: 'music',
    label: 'MUSIC',
    spoken: 'Music',
    words: { meh: 'Meh', good: 'Good', fire: 'Fire' },
  },
  {
    key: 'energy',
    label: 'ENERGY',
    spoken: 'Energy',
    words: { low: 'Low', good: 'Good', fire: 'Fire' },
  },
] as const;

const STATES: readonly string[] = ['none', 'early', 'stale', 'live'];
const LABELS: readonly string[] = ['Quiet', 'Good', 'Hot', 'Fire'];
const REACTION_KEYS: readonly string[] = REACTIONS.map((r) => r.key);

/**
 * Reads a whole number that may not be negative.
 *
 * @param value - anything from the JSON.
 * @returns the number, or null if it isn't one.
 */
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

/**
 * Reads a score: a number from 0 to 10.
 *
 * @param value - anything from the JSON.
 * @returns the score, or null if missing or out of range.
 */
function score(value: unknown): number | null {
  return typeof value === 'number' && value >= 0 && value <= 10 ? value : null;
}

/**
 * Reads the tile words.
 *
 * @param value - the server's "breakdown" (or a night's).
 * @returns the three words, or null if missing or any word is unknown (then
 *   no tiles show at all, rather than a half row).
 */
function parseBreakdown(value: unknown): Breakdown | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const ok = BREAKDOWN_TILES.every((tile) => {
    const word = v[tile.key];
    return typeof word === 'string' && Object.keys(tile.words).includes(word);
  });
  return ok ? ({ crowd: v.crowd, music: v.music, energy: v.energy } as Breakdown) : null;
}

/**
 * Reads a score's word, preferring the server's (one source of truth), but
 * falling back to the app's own copy of the same rule if it is missing.
 *
 * @param shown - the score (or null).
 * @param label - the server's word.
 * @returns the word, or null with no score.
 */
function labelFor(shown: number | null, label: unknown): VibeLabel | null {
  if (shown === null) return null;
  return typeof label === 'string' && LABELS.includes(label)
    ? (label as VibeLabel)
    : vibeLabel(shown);
}

/**
 * Reads the "All night" view.
 *
 * @param value - the server's "night".
 * @returns the night view, or null if missing or not understood.
 */
function parseNight(value: unknown): NightVibe | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const raters = count(v.raters);
  if (raters === null) return null;
  // Only the server's word counts; a number is never read, even if one is sent.
  const label =
    typeof v.label === 'string' && LABELS.includes(v.label) ? (v.label as VibeLabel) : null;
  return {
    label,
    raters,
    // Tiles only ever come with the night's word (the server withholds both together).
    breakdown: label === null ? null : parseBreakdown(v.breakdown),
    over: v.over === true,
  };
}

/**
 * Checks the server's vibe JSON and tidies it up.
 *
 * @param data - whatever the server returned for one event.
 * @returns the vibe, or null if the answer isn't one we understand (for
 *   example "live" without a score). Unknown reactions are skipped.
 */
export function parseVibe(data: unknown): Vibe | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  if (typeof value.state !== 'string' || !STATES.includes(value.state)) return null;
  const state = value.state as VibeState;
  const raters = count(value.raters);
  const here = count(value.here) ?? 0;
  if (raters === null) return null;

  // A number only ever comes with 'live' and 'stale'. If the server ever sent
  // one with 'early', we ignore it: no number before 5 ratings.
  const shown = state === 'live' || state === 'stale' ? score(value.score) : null;
  if ((state === 'live' || state === 'stale') && shown === null) return null;

  const label = labelFor(shown, value.label);

  const reactions: ReactionCount[] = [];
  if (Array.isArray(value.reactions)) {
    for (const item of value.reactions) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const n = count(entry.count);
      if (typeof entry.reaction !== 'string' || !REACTION_KEYS.includes(entry.reaction)) continue;
      if (!n) continue;
      reactions.push({ reaction: entry.reaction as ReactionKey, count: n });
    }
  }

  return {
    state,
    raters,
    here,
    score: shown,
    label,
    // Never shown any more: the server sends null (20261027210000), and the
    // app ignores anything else, so no night number reaches the screen.
    nightAverage: null,
    minutesSinceLast: count(value.minutes_since_last),
    reactions,
    // Tiles and the night view only exist alongside a score (VC-53 rule 1);
    // if the server ever sent them in 'none' or 'early', ignore them.
    breakdown: shown === null ? null : parseBreakdown(value.breakdown),
    night: shown === null ? null : parseNight(value.night),
  };
}

// ---------------------------------------------------------------------------
// Words for the screens
// ---------------------------------------------------------------------------

/**
 * Writes a score the way the app shows it: always 1 decimal.
 *
 * @param value - a score from 0 to 10.
 * @returns e.g. "8.0" or "9.1".
 */
export function formatScore(value: number): string {
  return value.toFixed(1);
}

/**
 * "1 person" or "3 people".
 *
 * @param n - how many.
 * @returns the count with the right word.
 */
export function people(n: number): string {
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}

/**
 * How long ago the newest rating was, in short words.
 *
 * @param minutes - whole minutes since it (from the server).
 * @returns "just now" (under a minute), "4 min ago", or "2 hr ago".
 */
export function agoText(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} hr ago`;
}

/**
 * How long the event has been quiet (the stale state starts at 90 minutes).
 *
 * @param minutes - whole minutes since the newest rating.
 * @returns "90 min" under 2 hours, then whole hours: "2 hrs", "3 hrs".
 */
export function quietForText(minutes: number): string {
  if (minutes < 120) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hrs`;
}

/**
 * The headcount line (VC-42: a number only).
 *
 * @param here - the server's count: checked in within the last 3 hours
 *   while the event is on, everyone that night once it has ended (VC-55).
 * @param ended - true once the event is over, so it says "were here". The
 *   server switches its count at the same moment (the event's end time).
 * @returns e.g. "74 here" or "74 were here"; null when nobody has checked
 *   in (nothing is shown then).
 */
export function hereText(here: number, ended: boolean): string | null {
  if (here <= 0) return null;
  return ended ? `${here} were here` : `${here} here`;
}

/**
 * The line under the meter on the event page.
 *
 * @param vibe - the event's vibe.
 * @returns e.g. "No vibe yet. Be the first.", "Early reading: 3 people so
 *   far", "5 people · updated 4 min ago" or "Quiet for 2 hrs · night
 *   average 7.4".
 */
export function vibeDetail(vibe: Vibe): string {
  switch (vibe.state) {
    case 'none':
      return NO_VIBE_BODY;
    case 'early':
      return `${EARLY_TITLE}: ${people(vibe.raters)} so far`;
    case 'live':
      return vibe.minutesSinceLast === null
        ? people(vibe.raters)
        : `${people(vibe.raters)} · updated ${agoText(vibe.minutesSinceLast)}`;
    case 'stale': {
      const quiet =
        vibe.minutesSinceLast === null
          ? 'Quiet for a while'
          : `Quiet for ${quietForText(vibe.minutesSinceLast)}`;
      // The night average used to follow here; since VC-54 it is the All
      // night view's own score instead (design spec, section 2).
      return quiet;
    }
  }
}

/**
 * The line under the gauge in the All night view.
 *
 * @param night - the night view.
 * @returns e.g. "112 ratings tonight", or, when the server withheld the
 *   word, "The night vibe will show a little later."
 */
export function nightDetail(night: NightVibe): string {
  if (night.label === null) return NIGHT_WITHHELD_BODY;
  return `${night.raters} ${night.raters === 1 ? 'rating' : 'ratings'} tonight`;
}

/**
 * The vibe as the All night view shows it, in the same shape as the live
 * one, so the gauge and tiles can draw either.
 *
 * @param vibe - the event's vibe.
 * @param night - its night view.
 * @returns a Vibe whose word, count and tiles are the night's, and whose
 *   score is always null (the night has no number). Its state is 'live'
 *   with a word (the gauge draws the word-only treatment), 'none' without.
 */
export function nightAsVibe(vibe: Vibe, night: NightVibe): Vibe {
  return {
    ...vibe,
    state: night.label === null ? 'none' : 'live',
    raters: night.raters,
    score: null,
    label: night.label,
    nightAverage: null,
    breakdown: night.breakdown,
    night,
  };
}

/**
 * The tiles as the screen shows them.
 *
 * @param breakdown - the tile words.
 * @returns three { label, word } pairs, e.g. { label: 'CROWD', word: 'Packed' }.
 */
export function breakdownTiles(breakdown: Breakdown): { label: string; word: string }[] {
  return BREAKDOWN_TILES.map((tile) => ({
    label: tile.label,
    word: (tile.words as Record<string, string>)[breakdown[tile.key]],
  }));
}

/**
 * What a screen reader says for the tile row (one element).
 *
 * @param breakdown - the tile words.
 * @param stale - true when the score is old (prefix "Last reading:").
 * @returns e.g. "Crowd Packed, Music Fire, Energy Good".
 */
export function breakdownSpoken(breakdown: Breakdown, stale: boolean): string {
  const parts = breakdownTiles(breakdown)
    .map((tile, i) => `${BREAKDOWN_TILES[i].spoken} ${tile.word}`)
    .join(', ');
  return stale ? `Last reading: ${parts}` : parts;
}

/**
 * The reaction tally as one short line, e.g. "🔥 3 · 💃 1".
 *
 * @param reactions - the tally, most first.
 * @returns the visible line and the words for screen readers ("Fire 3,
 *   Dancing 1"); null when there are no reactions.
 */
export function reactionLine(reactions: ReactionCount[]): { text: string; spoken: string } | null {
  if (reactions.length === 0) return null;
  const parts = reactions.map((r) => {
    const info = REACTIONS.find((item) => item.key === r.reaction);
    return { emoji: info?.emoji ?? '', word: info?.label ?? r.reaction, count: r.count };
  });
  return {
    text: parts.map((p) => `${p.emoji} ${p.count}`).join(' · '),
    spoken: `Reactions: ${parts.map((p) => `${p.word} ${p.count}`).join(', ')}`,
  };
}

/**
 * What a screen reader says for the meter.
 *
 * @param vibe - the event's vibe (for the night view, from nightAsVibe).
 * @param view - which view it is (default live).
 * @returns e.g. "Vibe 8.0 out of 10, Hot", "Last vibe 8.0 out of 10, Hot",
 *   "All night vibe: Hot" (words only, no number),
 *   "Early reading, no score yet" or "No vibe yet".
 */
export function meterSpoken(vibe: Vibe, view: VibeView = 'live'): string {
  // The All night view has a word and never a number.
  if (view === 'night') return vibe.label ? `All night vibe: ${vibe.label}` : NO_VIBE_TITLE;
  if (vibe.score !== null && vibe.label) {
    const lead = vibe.state === 'stale' ? 'Last vibe' : 'Vibe';
    return `${lead} ${formatScore(vibe.score)} out of 10, ${vibe.label}`;
  }
  return vibe.state === 'early' ? `${EARLY_TITLE}, no score yet` : NO_VIBE_TITLE;
}

/**
 * The short vibe words for a Tonight card (spoken as part of the card).
 *
 * @param vibe - the event's vibe.
 * @returns e.g. "vibe 8.0 out of 10, Hot", "vibe quiet for 2 hrs, last 8.0,
 *   Hot", "Early reading, 3 so far" or "no vibe yet".
 */
export function cardVibeSpoken(vibe: Vibe): string {
  if (vibe.state === 'live' && vibe.score !== null) {
    return `vibe ${formatScore(vibe.score)} out of 10, ${vibe.label}`;
  }
  if (vibe.state === 'stale' && vibe.score !== null) {
    const quiet =
      vibe.minutesSinceLast === null ? '' : ` for ${quietForText(vibe.minutesSinceLast)}`;
    return `vibe quiet${quiet}, last ${formatScore(vibe.score)}, ${vibe.label}`;
  }
  if (vibe.state === 'early') return `${EARLY_TITLE}, ${vibe.raters} so far`;
  return 'no vibe yet';
}
