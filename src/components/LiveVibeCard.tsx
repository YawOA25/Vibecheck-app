/**
 * The "Live vibe" block on the event page (VC-B05), v3 look
 * (design/v3/Detail.dc.html): a card with a gold "LIVE VIBE" label and the
 * current reading.
 *
 * For now it always shows the "Early reading" state. The score itself
 * (`get_event_vibe`, the meter, the early/stale/none states and 20-second
 * refresh) is task VC-B09, and there are no ratings until VC-B08. Showing an
 * honest "Early reading" now, instead of a made-up number, keeps the screen
 * truthful (the v3 spec also drops the fake "9.1" sticker, section 3 fix 7).
 * VC-B09 replaces the body of this card with the real meter.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

/** The words of the early state (exported so tests use the same text). */
export const EARLY_READING_TITLE = 'Early reading';
export const EARLY_READING_BODY =
  'Not enough ratings yet. The live score shows once people here check in and rate.';

/**
 * Renders the card in its "Early reading" state.
 *
 * @returns the card. Screen readers hear "Live vibe: Early reading. Not
 *   enough ratings yet..." as one item.
 */
export function LiveVibeCard() {
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`Live vibe: ${EARLY_READING_TITLE}. ${EARLY_READING_BODY}`}
    >
      <View style={styles.labelRow}>
        {/* The small gold dot is decoration; the words carry the meaning. */}
        <View style={styles.dot} />
        <Text style={styles.label}>LIVE VIBE</Text>
      </View>
      <Text style={styles.title}>{EARLY_READING_TITLE}</Text>
      <Text style={styles.body}>{EARLY_READING_BODY}</Text>
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: 14,
    paddingBottom: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  labelRow: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  label: { ...typography.label, color: colors.accent },
  title: {
    ...typography.cardTitle,
    color: colors.text,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  body: { ...typography.caption, color: colors.muted, textAlign: 'center' },
});
