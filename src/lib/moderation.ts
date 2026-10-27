/**
 * Moderation rules and words for the admin screens (proposals VC-47 and
 * VC-58).
 *
 * What it holds:
 *   - the reasons an admin can pick, and which ones fit removing versus
 *     restoring. They are the written removal rule from the legal review
 *     (team/projects/vibecheck/legal/phase0-consents-2026-10-27.md, section
 *     5): remove only when the people weren't really there, the picks look
 *     coordinated, or someone broke the tester rules. There is deliberately
 *     no "the venue asked" reason, so the rule is the same whoever complains;
 *   - the 48-hour review promise, and how the queue words a report's wait.
 *
 * The server (supabase/migrations/20261027160000_admin_moderation.sql) has
 * the same lists and is the one that counts; these copies only drive the
 * buttons. Keep the two in sync.
 */

/** A reason for hiding or removing something. */
export type RemovalReason = 'not_checked_in' | 'coordinated' | 'broke_tester_rules';

/** A reason for restoring something, or keeping a reported tag. */
export type RestoreReason = 'no_rule_broken' | 'mistake';

/** Any moderation reason. */
export type ModerationReason = RemovalReason | RestoreReason;

/** The removal reasons, in the order the screen lists them, with their words. */
export const REMOVAL_REASONS: readonly { key: RemovalReason; label: string }[] = [
  { key: 'not_checked_in', label: "Weren't really there" },
  { key: 'coordinated', label: 'Coordinated or brigading' },
  { key: 'broke_tester_rules', label: 'Broke the tester rules' },
];

/** The restore (and keep) reasons, with their words. */
export const RESTORE_REASONS: readonly { key: RestoreReason; label: string }[] = [
  { key: 'no_rule_broken', label: 'No rule broken' },
  { key: 'mistake', label: 'Undo a mistake' },
];

/**
 * The reasons that fit an action.
 *
 * @param removing - true when hiding or removing, false when restoring or
 *   keeping.
 * @returns the list of reasons with their words.
 */
export function reasonsFor(removing: boolean): readonly { key: ModerationReason; label: string }[] {
  return removing ? REMOVAL_REASONS : RESTORE_REASONS;
}

/**
 * Looks up a reason's words (for the decision log).
 *
 * @param key - the server key, e.g. 'coordinated'.
 * @returns the words, or the key itself if this app doesn't know it.
 */
export function reasonLabel(key: string): string {
  return [...REMOVAL_REASONS, ...RESTORE_REASONS].find((r) => r.key === key)?.label ?? key;
}

/** The longest admin note the server accepts. */
export const MAX_NOTE_LENGTH = 500;

/** Reports should be reviewed within this many hours (legal review, section 5). */
export const REVIEW_HOURS = 48;

/**
 * Words for how long a report has waited, for the queue.
 *
 * @param hours - whole hours since the oldest open report.
 * @returns e.g. "Waiting under an hour", "Waiting 5 h, 43 h left" or
 *   "Overdue: waiting 50 h" (at 48 hours or more).
 */
export function waitingText(hours: number): string {
  if (hours >= REVIEW_HOURS) return `Overdue: waiting ${hours} h`;
  if (hours < 1) return 'Waiting under an hour';
  return `Waiting ${hours} h, ${REVIEW_HOURS - hours} h left`;
}

/** The decision-log words for each action. */
const ACTION_LABELS: Record<string, string> = {
  hide_rating: 'Hid rating',
  unhide_rating: 'Unhid rating',
  remove_heads_ups: 'Removed +1s',
  restore_heads_ups: 'Restored +1s',
  hide_tag: 'Hid tag',
  unhide_tag: 'Unhid tag',
  keep_tag: 'Kept tag',
};

/**
 * Looks up an action's words for the decision log.
 *
 * @param action - the server key, e.g. 'hide_rating'.
 * @returns the words, or the key itself if this app doesn't know it.
 */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/**
 * Short "how long ago" words for the admin screens (account age, log times).
 * Works from the difference between two moments, so the phone's time zone
 * doesn't matter.
 *
 * @param iso - the past moment, as the server sends it.
 * @param now - the moment to count from.
 * @returns e.g. "just now", "12 min ago", "5 h ago" or "3 d ago"; an empty
 *   string when the time can't be read.
 */
export function agoText(iso: string, now: Date): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
