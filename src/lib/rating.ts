/**
 * The rating's building blocks (task VC-B08) and the heads-up tags
 * (proposal VC-43, final list VC-45 + VC-57): the three rows of choices, the
 * six reactions, the nine heads-up tags and their words, and small sums the
 * screens need.
 *
 * Why one file: the rating screen, the event page and the tests all use the
 * same lists, so they can't drift apart. The server keeps its own copy of
 * the allowed values (heads-up tags: private.heads_up_tags_active() in
 * supabase/migrations/20261027190000_final_heads_up_tags.sql) and refuses
 * anything else; keep the two in sync.
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

/**
 * The nine heads-up tags' server keys (VC-45 + VC-57). The three retired
 * keys (music_fire, packed, good_crowd) are not here on purpose: the app
 * never offers or shows them (see RETIRED_HEADS_UP_LABELS for admins).
 */
export type HeadsUpTag =
  | 'lines_long'
  | 'overpriced'
  | 'dress_code'
  | 'friendly_crowd'
  | 'sound_bad'
  | 'felt_unsafe'
  | 'picking_up'
  | 'clearing_out'
  | 'parking_rough';

/** One heads-up tag: the server key, its emoji and its words. */
export interface HeadsUpTagInfo {
  key: HeadsUpTag;
  /** Shown before the words; screen readers skip it (they say the words). */
  emoji: string;
  label: string;
}

/**
 * The heads-up tags, in the order the rating screen and event page show
 * them (design/score-visuals-and-tags-spec.md, section 1: practical warnings
 * first, trends last; "Parking is rough" added by VC-57). No free text, so
 * nothing needs moderating.
 *
 * Why "Felt unsafe" has a speech bubble, not a warning sign: legal review
 * (VC-60) asked for a neutral icon so the tag reads as what guests said,
 * not as an official warning from the app.
 */
export const HEADS_UP_TAGS: readonly HeadsUpTagInfo[] = [
  { key: 'lines_long', emoji: '⏳', label: 'Long line' },
  { key: 'overpriced', emoji: '💸', label: 'Overpriced' },
  { key: 'dress_code', emoji: '👔', label: 'Strict dress code' },
  { key: 'friendly_crowd', emoji: '🤝', label: 'Friendly crowd' },
  { key: 'sound_bad', emoji: '🔈', label: 'Sound is bad' },
  { key: 'felt_unsafe', emoji: '💬', label: 'Felt unsafe' },
  { key: 'picking_up', emoji: '📈', label: 'Picking up' },
  { key: 'clearing_out', emoji: '📉', label: 'Clearing out' },
  { key: 'parking_rough', emoji: '🅿️', label: 'Parking is rough' },
];

/**
 * Words for the tags retired in VC-45. Guests never see these (the server
 * stops sending them), but old reports and +1s on the admin screens still
 * carry the keys, so admins get readable words instead of "music_fire".
 */
export const RETIRED_HEADS_UP_LABELS: Readonly<Record<string, string>> = {
  music_fire: 'Music is fire (retired)',
  packed: 'Packed (retired)',
  good_crowd: 'Good crowd (retired)',
};

/** The "Felt unsafe" key, which has its own wording rules (VC-59, VC-60). */
export const FELT_UNSAFE: HeadsUpTag = 'felt_unsafe';

/**
 * The info line under the heads-ups (VC-60, legal review section 5): tags
 * are guests' impressions, and the app doesn't check or back them.
 */
export const HEADS_UP_INFO =
  "Tags are what checked-in guests picked tonight. They're guests' impressions, not checked or endorsed by us.";

/**
 * Shown when a guest picks "Felt unsafe" (VC-60), so nobody mistakes the
 * tag for a way to get help.
 */
export const FELT_UNSAFE_HELP =
  "In danger now? Call 911 or tell venue staff. This tag doesn't alert anyone.";

/**
 * Says whether a server key is one of the nine current tags.
 *
 * @param key - any string, e.g. from the server.
 * @returns true for a current tag (retired and unknown keys give false).
 */
export function isHeadsUpTag(key: string): key is HeadsUpTag {
  return HEADS_UP_TAGS.some((tag) => tag.key === key);
}

/**
 * Looks up a heads-up tag's words.
 *
 * @param key - the server key, e.g. 'lines_long'.
 * @returns the words, e.g. "Long line"; for a retired key (admin screens
 *   only) the old words marked "(retired)"; null for a key this app doesn't
 *   know at all (a newer server), which the caller skips.
 */
export function headsUpLabel(key: string): string | null {
  return (
    HEADS_UP_TAGS.find((tag) => tag.key === key)?.label ?? RETIRED_HEADS_UP_LABELS[key] ?? null
  );
}

/**
 * The emoji for a current tag.
 *
 * @param key - the tag.
 * @returns the emoji, e.g. "⏳".
 */
export function headsUpEmoji(key: HeadsUpTag): string {
  return HEADS_UP_TAGS.find((tag) => tag.key === key)?.emoji ?? '';
}

/**
 * The words on an event-page heads-up chip.
 *
 * @param key - the tag.
 * @param count - how many guests picked it (already over the server's bar).
 * @returns e.g. "⏳ Long line · 3". "Felt unsafe" is said as guests' view
 *   for that night only (VC-60): "💬 Felt unsafe · 3 guests tonight".
 */
export function headsUpChipText(key: HeadsUpTag, count: number): string {
  const words = `${headsUpEmoji(key)} ${headsUpLabel(key) ?? key}`;
  return key === FELT_UNSAFE ? `${words} · ${guestsTonight(count)}` : `${words} · ${count}`;
}

/**
 * What screen readers say for an event-page heads-up chip (no emoji).
 *
 * @param key - the tag.
 * @param count - how many guests picked it.
 * @param mine - whether the listener +1'd it.
 * @returns e.g. "Long line, 3 people, you +1'd this", or
 *   "Felt unsafe, 3 guests tonight".
 */
export function headsUpChipA11y(key: HeadsUpTag, count: number, mine: boolean): string {
  const people =
    key === FELT_UNSAFE ? guestsTonight(count) : `${count} ${count === 1 ? 'person' : 'people'}`;
  return `${headsUpLabel(key) ?? key}, ${people}${mine ? ", you +1'd this" : ''}`;
}

/**
 * "N guests tonight" (VC-60 wording).
 *
 * @param count - the number of guests.
 * @returns e.g. "3 guests tonight" ("1 guest tonight" can't happen on the
 *   event page because of the server's bar, but reads right anyway).
 */
function guestsTonight(count: number): string {
  return `${count} ${count === 1 ? 'guest' : 'guests'} tonight`;
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
