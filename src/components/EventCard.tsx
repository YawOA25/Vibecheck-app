/**
 * One event on the Tonight list (VC-B05), in the v3 compact card look: the
 * name and a "where · when" line on the left, the vibe on the right.
 *
 * What it shows: title, neighbourhood label (never an address), when it is
 * ("Today · 10 PM", or "On now · until 2 AM"), a "Staff pick" chip for
 * venue events the team picked (VC-29/VC-14), a "21+" chip when set, and
 * the vibe. The live score arrives in task VC-B09; until then every card
 * shows "Early" (no score yet), which is what the design shows for an event
 * without enough ratings.
 *
 * The whole card is one button: tapping anywhere opens the event page.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Tag } from '@/components/Tag';
import { isStaffPick, whenLine } from '@/lib/tonight';
import type { PublicEvent } from '@/lib/tonight';
import { colors, minTapTarget, radius, spacing, typography } from '@/theme';

/** What an EventCard needs. */
export interface EventCardProps {
  event: PublicEvent;
  /** The current moment, for the "Today · 10 PM" line. */
  now: Date;
  /** What happens on tap (open the event page). */
  onPress: () => void;
}

/** The vibe text shown until live scores exist (task VC-B09). */
export const EARLY_LABEL = 'Early';

/**
 * Renders the card.
 *
 * @returns a pressable card. Screen readers hear one summary, e.g.
 *   "Saturday rooftop, Shaw, DC, Today · 10 PM, Staff pick, vibe: Early".
 */
export function EventCard({ event, now, onPress }: EventCardProps) {
  const when = whenLine(event, now);
  const staffPick = isStaffPick(event);
  // One spoken summary, so screen-reader users don't have to swipe through
  // every small piece of the card.
  const spoken = [
    event.title,
    event.area_label,
    when,
    staffPick ? 'Staff pick' : null,
    event.is_21_plus ? '21 and over' : null,
    `vibe: ${EARLY_LABEL}, no score yet`,
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
        </Text>
        {staffPick || event.is_21_plus ? (
          <View style={styles.tags}>
            {staffPick ? <Tag label="Staff pick" tone="gold" /> : null}
            {event.is_21_plus ? <Tag label="21+" /> : null}
          </View>
        ) : null}
      </View>
      <Tag label={EARLY_LABEL} tone="muted" />
    </Pressable>
  );
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
});
