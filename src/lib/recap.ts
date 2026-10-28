/**
 * The next-morning recap (task VC-B12): the rules, with no screens and no
 * phone features, so they are easy to test.
 *
 * What lives here:
 *   - the shape of one recap item from the server (get_my_recap), and a
 *     parser that checks it;
 *   - `recapMorning`: WHEN the "Your night is ready" notification fires
 *     (11:00 New York time, the morning after the night you rated in);
 *   - the notification's words (never the score: it shows on the lock
 *     screen, where anyone holding the phone can read it);
 *   - small text helpers for the "Your night" screen and the Nights out list.
 *
 * Privacy, in plain words: every number and word about the EVENT comes from
 * the server's published snapshot (the same `vibe` the event page shows, read
 * with `parseVibe`). Nothing here works out an average. The guest's own
 * rating is their own three taps, which they could already read.
 */
import { RATING_ROWS, REACTIONS } from '@/lib/rating';
import type { ReactionKey, RowValue, VibeLabel } from '@/lib/rating';
import { addDays, nightOf, shortDate, zonedMoment } from '@/lib/tonight';
import { formatScore, parseVibe } from '@/lib/vibe';
import type { ReactionCount, Vibe } from '@/lib/vibe';

/** The hour (New York time) the recap notification fires: 11 AM. */
export const RECAP_HOUR = 11;

/** The guest's own rating, as the recap shows it. */
export interface MyRating {
  crowd: RowValue;
  music: RowValue;
  energy: RowValue;
  /** Their reaction, or null if they didn't pick one. */
  reaction: ReactionKey | null;
  /** The word for their own score (Quiet, Good, Hot or Fire). */
  label: VibeLabel;
}

/** One rated event in the recap or the Nights out list. */
export interface RecapItem {
  eventId: string;
  title: string;
  areaLabel: string;
  startsAt: string;
  /** When the guest last saved this rating. */
  ratedAt: string;
  mine: MyRating;
  /** The event's PUBLISHED vibe, exactly what the event page shows. */
  vibe: Vibe;
}

const LABELS: readonly string[] = ['Quiet', 'Good', 'Hot', 'Fire'];
const REACTION_KEYS: readonly string[] = REACTIONS.map((r) => r.key);

/**
 * Checks one row value (1, 2 or 3).
 *
 * @param value - anything from the server.
 * @returns the value, or null if it isn't 1, 2 or 3.
 */
function rowValue(value: unknown): RowValue | null {
  return value === 1 || value === 2 || value === 3 ? value : null;
}

/**
 * Reads the guest's own rating from the server's `mine` object.
 *
 * @param value - the `mine` JSON.
 * @returns the rating, or null if anything is missing or unexpected.
 */
function parseMine(value: unknown): MyRating | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const crowd = rowValue(v.crowd);
  const music = rowValue(v.music);
  const energy = rowValue(v.energy);
  if (crowd === null || music === null || energy === null) return null;
  if (typeof v.label !== 'string' || !LABELS.includes(v.label)) return null;
  // An unknown reaction (say, one added later) is shown as none.
  const reaction =
    typeof v.reaction === 'string' && REACTION_KEYS.includes(v.reaction)
      ? (v.reaction as ReactionKey)
      : null;
  return { crowd, music, energy, reaction, label: v.label as VibeLabel };
}

/**
 * Reads get_my_recap's answer.
 *
 * @param data - the JSON list from the server.
 * @returns the items in the server's order (newest event first), skipping
 *   any item that doesn't look right; null if the answer isn't a list.
 */
export function parseRecap(data: unknown): RecapItem[] | null {
  if (!Array.isArray(data)) return null;
  const items: RecapItem[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const v = raw as Record<string, unknown>;
    const mine = parseMine(v.mine);
    // The same parser as the event page, so the recap follows the same
    // rules (for example: no number before 5 raters, night as a word).
    const vibe = parseVibe(v.vibe);
    if (
      typeof v.event_id !== 'string' ||
      typeof v.title !== 'string' ||
      typeof v.starts_at !== 'string' ||
      typeof v.rated_at !== 'string' ||
      !mine ||
      !vibe
    ) {
      continue;
    }
    items.push({
      eventId: v.event_id,
      title: v.title,
      areaLabel: typeof v.area_label === 'string' ? v.area_label : '',
      startsAt: v.starts_at,
      ratedAt: v.rated_at,
      mine,
      vibe,
    });
  }
  return items;
}

/**
 * When the recap notification fires for a rating saved at `ratedAt`.
 *
 * The rule: 11:00 New York time on the morning after the NIGHT the rating
 * belongs to. A night runs 5 AM to 5 AM (src/lib/tonight.ts, nightOf), so:
 *   - rated 11 PM Saturday -> 11 AM Sunday;
 *   - rated 1 AM Sunday (still Saturday night) -> 11 AM Sunday, the same
 *     calendar day (this is the "across midnight" case);
 *   - rated 6 PM Sunday -> 11 AM Monday.
 * The time is always New York's, never the phone's own zone (cto rule since
 * B05): the events are in the DMV, and a phone set to another zone would
 * otherwise get the note at the wrong hour.
 *
 * @param ratedAt - the moment the rating was saved.
 * @returns the moment to fire. It is always 6 to 30 hours later (31 on the
 *   night the clocks go back), so always in the future and always inside
 *   the server's 36-hour recap window.
 */
export function recapMorning(ratedAt: Date): Date {
  return zonedMoment(addDays(nightOf(ratedAt), 1), RECAP_HOUR);
}

/**
 * A key naming one recap morning, for example "2026-11-01". One notification
 * per morning: rating two events on the same night gives one note.
 *
 * @param morning - the moment from recapMorning.
 * @returns the New York date of that morning as YYYY-MM-DD.
 */
export function morningKey(morning: Date): string {
  const night = nightOf(morning);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${night.year}-${pad(night.month)}-${pad(night.day)}`;
}

/**
 * THE LOCK-SCREEN WORDS, in one place so they are easy to change. The
 * founder may switch to a generic body with no event name (for example
 * `() => 'Your night is ready.'`); change RECAP_NOTE_BODY only, and update
 * the two tests that quote it (recap.test.ts, recap-notifications.test.ts).
 * Never put a score or a vibe word here: anyone near the phone can read it.
 */
export const RECAP_NOTE_TITLE = 'Your night';
/** The body, given where (an event name, or "A + 1 more"). */
export const RECAP_NOTE_BODY = (where: string): string => `Your night at ${where} is ready.`;

/**
 * The notification's words. On purpose they never include a score or a
 * word like "Fire": the lock screen is visible to anyone near the phone.
 *
 * @param titles - the events rated that night, oldest first (at least one).
 * @returns the title and body to show.
 */
export function recapNotificationText(titles: string[]): { title: string; body: string } {
  const first = titles[0] ?? 'your event';
  const more = titles.length - 1;
  const where = more > 0 ? `${first} + ${more} more` : first;
  return { title: RECAP_NOTE_TITLE, body: RECAP_NOTE_BODY(where) };
}

/**
 * The word for a row value, as the rating screen shows it (for example
 * crowd 3 is "Packed").
 *
 * @param row - which row.
 * @param value - 1, 2 or 3.
 * @returns the chip's word.
 */
export function rowWord(row: 'crowd' | 'music' | 'energy', value: RowValue): string {
  const info = RATING_ROWS.find((r) => r.key === row);
  return info ? info.options[value - 1] : String(value);
}

/**
 * The top reaction of the PUBLISHED tally (the server sends it only with 5+
 * raters, most first).
 *
 * @param reactions - the published tally.
 * @returns the reaction's emoji, word and count, or null when there is none.
 */
export function topReaction(
  reactions: ReactionCount[],
): { emoji: string; word: string; count: number } | null {
  const top = reactions[0];
  if (!top) return null;
  const info = REACTIONS.find((r) => r.key === top.reaction);
  return { emoji: info?.emoji ?? '', word: info?.label ?? top.reaction, count: top.count };
}

/**
 * The final night's word for the recap: the "All night" word, never a
 * number (cto, VC-54).
 *
 * @param vibe - the published vibe.
 * @returns the word, or null when the snapshot withholds it.
 */
export function nightWord(vibe: Vibe): VibeLabel | null {
  return vibe.night?.label ?? null;
}

/**
 * The small line under an event's name: its night and area, for example
 * "Sat, Oct 18 · Navy Yard". The night rule applies, so a party starting at
 * 1 AM Sunday is listed as Saturday.
 *
 * @param item - the recap item.
 * @returns the line.
 */
export function recapDateLine(item: Pick<RecapItem, 'startsAt' | 'areaLabel'>): string {
  const night = shortDate(nightOf(new Date(item.startsAt)));
  return item.areaLabel ? `${night} · ${item.areaLabel}` : night;
}

/**
 * What the room thought, in words for the recap, taken ONLY from the
 * published vibe:
 *   - word: the final night's word (never a number), or null if withheld;
 *   - detail: one plain sentence about it;
 *   - lastScore: the published live score as the event page shows it
 *     ("8.7"), or null when the snapshot shows no number.
 *
 * @param vibe - the published vibe.
 * @returns the three parts.
 */
export function roomSummary(vibe: Vibe): {
  word: VibeLabel | null;
  detail: string;
  lastScore: string | null;
} {
  const word = nightWord(vibe);
  const lastScore = vibe.score === null ? null : formatScore(vibe.score);
  let detail: string;
  if (word && vibe.night) {
    detail = `${vibe.night.raters} ${vibe.night.raters === 1 ? 'rating' : 'ratings'} all night`;
  } else if (vibe.state === 'early') {
    // Under 5 raters there's never a number or a word (privacy rule).
    detail = `Only ${vibe.raters} ${vibe.raters === 1 ? 'person' : 'people'} rated, so there's no score.`;
  } else if (vibe.state === 'none') {
    detail = 'Not enough ratings for a score.';
  } else {
    // Live or stale, but the night's word is withheld (see VC-54).
    detail = "The night's word isn't ready for this one.";
  }
  return { word, detail, lastScore };
}
