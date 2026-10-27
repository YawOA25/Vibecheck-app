/**
 * The rating's building blocks (task VC-B08) and the heads-up tags
 * (proposal VC-43): the three rows of choices, the six reactions, the six
 * heads-up tags, and small sums the screens need.
 *
 * Why one file: the rating screen, the event page and the tests all use the
 * same lists, so they can't drift apart. The server keeps its own copy of
 * the allowed values (supabase/migrations/20261027120000_ratings_and_heads_ups.sql)
 * and refuses anything else; keep the two in sync.
 *
 * Nothing here talks to the server; it's plain data and arithmetic.
 */

/** A value in one row: 1 (low), 2 (good) or 3 (top). */
export type RowValue = 1 | 2 | 3;

/** The three rows, in screen order. */
export type RowKey = 'crowd' | 'music' | 'energy';

/** One row of the rating: its key, the caps label and its three choices. */
export interface RatingRow {
  key: RowKey;
  label: string;
  /** The words on the three chips, for values 1, 2 and 3. */
  options: [string, string, string];
}

/** The three rows from the wireframe (S5) and the v3 Rate screen. */
export const RATING_ROWS: readonly RatingRow[] = [
  { key: 'crowd', label: 'CROWD', options: ['Quiet', 'Good', 'Packed'] },
  { key: 'music', label: 'MUSIC', options: ['Meh', 'Good', 'Fire'] },
  { key: 'energy', label: 'ENERGY', options: ['Low', 'Good', 'Fire'] },
];

/** The six reactions' server keys (same list as the ratings table). */
export type ReactionKey = 'fire' | 'dancing' | 'packed' | 'chill' | 'too_loud' | 'dead';

/** One reaction: the server key, the emoji and the word screen readers say. */
export interface Reaction {
  key: ReactionKey;
  emoji: string;
  label: string;
}

/** The six emoji reactions (VC-06). Optional: pick one or none. */
export const REACTIONS: readonly Reaction[] = [
  { key: 'fire', emoji: '🔥', label: 'Fire' },
  { key: 'dancing', emoji: '💃', label: 'Dancing' },
  { key: 'packed', emoji: '👥', label: 'Packed' },
  { key: 'chill', emoji: '😌', label: 'Chill' },
  { key: 'too_loud', emoji: '🔊', label: 'Too loud' },
  { key: 'dead', emoji: '💤', label: 'Dead' },
];

/** The six heads-up tags' server keys (VC-43). */
export type HeadsUpTag =
  'lines_long' | 'music_fire' | 'packed' | 'overpriced' | 'good_crowd' | 'sound_bad';

/**
 * The heads-up tags with their words. These are the six the founder named
 * in VC-43; the product-designer may refine the list later. No free text,
 * so nothing needs moderating.
 */
export const HEADS_UP_TAGS: readonly { key: HeadsUpTag; label: string }[] = [
  { key: 'lines_long', label: 'Lines are long' },
  { key: 'music_fire', label: 'Music is fire' },
  { key: 'packed', label: 'Packed' },
  { key: 'overpriced', label: 'Overpriced' },
  { key: 'good_crowd', label: 'Good crowd' },
  { key: 'sound_bad', label: 'Sound is bad' },
];

/**
 * Looks up a heads-up tag's words.
 *
 * @param key - the server key, e.g. 'lines_long'.
 * @returns the words, e.g. "Lines are long", or null for a key this app
 *   doesn't know (a newer server); the caller skips those.
 */
export function headsUpLabel(key: string): string | null {
  return HEADS_UP_TAGS.find((tag) => tag.key === key)?.label ?? null;
}

/** The rating being built on screen: each row is unpicked (null) until tapped. */
export interface RatingDraft {
  crowd: RowValue | null;
  music: RowValue | null;
  energy: RowValue | null;
  reaction: ReactionKey | null;
  tags: HeadsUpTag[];
}

/** An empty draft: nothing picked yet. */
export const EMPTY_DRAFT: RatingDraft = {
  crowd: null,
  music: null,
  energy: null,
  reaction: null,
  tags: [],
};

/** A draft with all three rows picked (ready to send). */
export type CompleteDraft = RatingDraft & { crowd: RowValue; music: RowValue; energy: RowValue };

/**
 * Says whether all three rows are picked, so the button can switch on
 * ("Done after 3 taps"; the reaction and tags are optional).
 *
 * @param draft - the rating so far.
 * @returns true when crowd, music and energy all have a value.
 */
export function isComplete(draft: RatingDraft): draft is CompleteDraft {
  return draft.crowd !== null && draft.music !== null && draft.energy !== null;
}

/**
 * Adds or removes one heads-up tag (tap to pick, tap again to unpick).
 *
 * @param tags - the tags picked so far.
 * @param tag - the tag that was tapped.
 * @returns a new list; the old one is not changed.
 */
export function toggleTag(tags: HeadsUpTag[], tag: HeadsUpTag): HeadsUpTag[] {
  return tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
}

/** The vibe words, lowest to highest. */
export type VibeLabel = 'Quiet' | 'Good' | 'Hot' | 'Fire';

/**
 * Turns a 0 to 10 score into its word (mvp-plan.md, "Labels"): under 4
 * Quiet, 4 to 6.9 Good, 7 to 8.4 Hot, 8.5 and up Fire.
 *
 * @param score - a score from 0 to 10, already rounded to 1 decimal.
 * @returns the word. The app always shows it next to the number.
 */
export function vibeLabel(score: number): VibeLabel {
  if (score < 4) return 'Quiet';
  if (score < 7) return 'Good';
  if (score < 8.5) return 'Hot';
  return 'Fire';
}

/** How long after a save the guest must wait before updating (server rule). */
export const UPDATE_WAIT_MINUTES = 60;

/**
 * Minutes until a rating may be updated, the way the server counts them
 * (rounded up, at least 1), or 0 when it may be updated now.
 *
 * @param lastSavedAt - when the rating was last saved (ISO text).
 * @param now - the current moment.
 * @returns whole minutes left, or 0.
 * Why the app counts too: so a guest who rated 20 minutes ago sees "update
 * in 40 minutes" straight away, instead of filling in the rows first. The
 * server still decides (it answers 'too_soon' with its own count).
 */
export function minutesUntilUpdate(lastSavedAt: string, now: Date): number {
  const nextMs = new Date(lastSavedAt).getTime() + UPDATE_WAIT_MINUTES * 60_000;
  const leftMs = nextMs - now.getTime();
  if (!Number.isFinite(leftMs) || leftMs <= 0) return 0;
  return Math.max(1, Math.ceil(leftMs / 60_000));
}
