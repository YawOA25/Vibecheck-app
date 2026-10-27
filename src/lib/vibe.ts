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

/** One event's vibe, tidied up from the server's answer. */
export interface Vibe {
  state: VibeState;
  /** How many people's ratings count (hidden ones never do). */
  raters: number;
  /** How many people checked in (VC-42: a number only, never names). */
  here: number;
  /** live: the live score; stale: the last score; otherwise null. 0 to 10, 1 decimal. */
  score: number | null;
  /** The word for the score, or null when there is no score. */
  label: VibeLabel | null;
  /** stale only: the plain average of the night's ratings; otherwise null (privacy). */
  nightAverage: number | null;
  /** Whole minutes since the newest rating (worked out by the server's clock), or null. */
  minutesSinceLast: number | null;
  /** stale and live: the reaction tally, most first. Empty otherwise. */
  reactions: ReactionCount[];
}

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

  // Prefer the server's word (one source of truth), but fall back to the
  // app's own copy of the same rule if the word is missing or unknown.
  const label =
    shown === null
      ? null
      : typeof value.label === 'string' && LABELS.includes(value.label)
        ? (value.label as VibeLabel)
        : vibeLabel(shown);

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
    // The server only sends the night average when quiet (stale); sent while
    // live it would give away each new rating, so ignore it in any other state.
    nightAverage: state === 'stale' ? score(value.night_average) : null,
    minutesSinceLast: count(value.minutes_since_last),
    reactions,
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
 * @param here - how many people checked in.
 * @param ended - true once the event is over, so it says "were here".
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
      return vibe.nightAverage === null
        ? quiet
        : `${quiet} · night average ${formatScore(vibe.nightAverage)}`;
    }
  }
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
 * @param vibe - the event's vibe.
 * @returns e.g. "Vibe 8.0 out of 10, Hot", "Last vibe 8.0 out of 10, Hot",
 *   "Early reading, no score yet" or "No vibe yet".
 */
export function meterSpoken(vibe: Vibe): string {
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
