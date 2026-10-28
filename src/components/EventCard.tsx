/**
 * One event on the home list (VC-B05, week view VC-61), in the v3 compact card look: the
 * name and a "where · when" line on the left, the vibe on the right.
 *
 * What it shows: title, neighbourhood label (never an address), when it is
 * ("Today · 10 PM", or "On now · until 2 AM"), a "Staff pick" chip for
 * venue events the team picked (VC-29/VC-14), a "21+" chip when set, a
 * "TEST" chip on test events (VC-63b: only testers and admins ever see
 * those, and the chip makes sure nobody mistakes one for a real party), and
 * the vibe (task VC-B09) on the right:
 *   live   the score and its word, e.g. "8.0 Hot" (gold);
 *   stale  the last score and word in grey, with "quiet" under it;
 *   early  an "Early" chip with "3 so far" under it (no number before 5
 *          ratings);
 *   none   a "No vibe yet" chip.
 * If the vibes haven't loaded (or failed to), the right side stays empty
 * rather than guessing. The "where · when" line also gets the headcount,
 * "74 here", when anyone has checked in (VC-42: a number only).
 *
 * Before the event starts (VC-61) the card shows the details only: no vibe
 * badge and no headcount, even if a vibe was passed in. Reviews only mean
 * something once the night is on, so nothing about ratings can show early.
 *
 * The whole card is one button: tapping anywhere opens the event page.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Tag } from '@/components/Tag';
import { hasStarted, isStaffPick, whenLine } from '@/lib/tonight';
import type { PublicEvent } from '@/lib/tonight';
import { cardVibeSpoken, formatScore, hereText } from '@/lib/vibe';
import type { Vibe } from '@/lib/vibe';
import { colors, fonts, minTapTarget, radius, spacing, typography } from '@/theme';

/** What an EventCard needs. */
export interface EventCardProps {
  event: PublicEvent;
  /** The current moment, for the "Today · 10 PM" line and the has-it-started check. */
  now: Date;
  /** What happens on tap (open the event page). */
  onPress: () => void;
  /** The event's vibe, or undefined while it hasn't loaded. Ignored before the start. */
  vibe?: Vibe;
}

/** The chip words for the vibe states without a number (exported for tests). */
export const EARLY_LABEL = 'Early';
export const NO_VIBE_LABEL = 'No vibe yet';
/** The chip on test events (VC-63b), exported for tests. */
export const TEST_LABEL = 'TEST';

/**
 * Renders the card.
 *
 * @returns a pressable card. Screen readers hear one summary, e.g.
 *   "Saturday rooftop, Shaw, DC, Today · 10 PM, Staff pick, 74 here, vibe
 *   8.0 out of 10, Hot".
 */
export function EventCard({ event, now, onPress, vibe: given }: EventCardProps) {
  const when = whenLine(event, now);
  // VC-61: before the start, act as if there were no vibe at all, so no
  // score, chip or "here" count can leak onto a not-started card.
  const vibe = hasStarted(event, now) ? given : undefined;
  const staffPick = isStaffPick(event);
  // "74 here" (VC-42). The list only shows events that haven't ended.
  const here = vibe ? hereText(vibe.here, false) : null;
  // One spoken summary, so screen-reader users don't have to swipe through
  // every small piece of the card.
  const spoken = [
    event.title,
    event.is_test ? 'Test event' : null,
    event.area_label,
    when,
    staffPick ? 'Staff pick' : null,
    event.is_21_plus ? '21 and over' : null,
    here,
    vibe ? cardVibeSpoken(vibe) : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the event"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.left}>
        <Text style={styles.title}>{event.title}</Text>
        <Text style={styles.meta}>
          {event.area_label} · {when}
          {here ? ` · ${here}` : ''}
        </Text>
        {staffPick || event.is_21_plus || event.is_test ? (
          <View style={styles.tags}>
            {event.is_test ? <Tag label={TEST_LABEL} tone="gold" /> : null}
            {staffPick ? <Tag label="Staff pick" tone="gold" /> : null}
            {event.is_21_plus ? <Tag label="21+" /> : null}
          </View>
        ) : null}
      </View>
      {vibe ? <VibeBadge vibe={vibe} /> : null}
    </Pressable>
  );
}

/**
 * The vibe on the right of a card (v3: "8.8", or "Early" over "3 so far").
 *
 * @param props.vibe - the event's vibe.
 * @returns the badge view. It isn't read out by itself: the card's spoken
 *   summary already includes the vibe.
 */
function VibeBadge({ vibe }: { vibe: Vibe }) {
  if ((vibe.state === 'live' || vibe.state === 'stale') && vibe.score !== null) {
    const stale = vibe.state === 'stale';
    return (
      <View style={styles.badge}>
        <View style={styles.scoreRow}>
          <Text style={[styles.score, stale && styles.staleText]}>{formatScore(vibe.score)}</Text>
          <Text style={[styles.word, stale && styles.staleText]}>{vibe.label}</Text>
        </View>
        {stale ? <Text style={styles.note}>quiet</Text> : null}
      </View>
    );
  }
  if (vibe.state === 'early') {
    return (
      <View style={styles.badge}>
        <Tag label={EARLY_LABEL} tone="muted" />
        <Text style={styles.note}>{vibe.raters} so far</Text>
      </View>
    );
  }
  return <Tag label={NO_VIBE_LABEL} tone="muted" />;
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  // v3 compact card: surface, 1 px border, radius 20, padding 14 18.
  card: {
    minHeight: minTapTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.gap12,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  // flexShrink lets long names wrap instead of pushing the chip off screen.
  left: { flex: 1, flexShrink: 1, gap: 5 },
  title: { ...typography.cardTitle, color: colors.text },
  meta: { ...typography.caption, color: colors.muted },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  // The vibe badge, right-aligned (v3: the number over a small note).
  badge: { alignItems: 'flex-end', gap: 2 },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  score: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 20, color: colors.text },
  word: { fontFamily: fonts.displaySemi, fontSize: 15, lineHeight: 20, color: colors.accent },
  staleText: { color: colors.muted },
  note: { ...typography.caption, fontSize: 12, lineHeight: 16, color: colors.muted },
});
