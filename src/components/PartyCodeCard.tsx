/**
 * The gold-edged card that shows an event's 6-character party code, in the
 * v3 look. Used after creating an event (app/admin/new-event.tsx, VC-B04)
 * and on the admin view of the event page (app/event/[id].tsx, VC-35).
 *
 * Who sees it: admins only. The screens only draw it for admins, and the
 * server only ever hands the code to admins (create_event, update_event,
 * get_event_code).
 *
 * Privacy: the code is drawn on screen and nowhere else. This component
 * never logs it.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

/**
 * Renders the "Party code" card.
 *
 * @param props.code - the code, e.g. "K7MX2Q".
 * @returns the card view. Screen readers hear the letters one by one
 *   ("K 7 M X 2 Q"), so they're easy to copy down.
 */
export function PartyCodeCard({ code }: { code: string }) {
  return (
    <View style={styles.codeCard}>
      <Text style={styles.codeLabel}>Party code</Text>
      {/* Letters are spaced out so they're easy to copy onto a card. */}
      <Text style={styles.code} accessibilityLabel={`Party code ${code.split('').join(' ')}`}>
        {code}
      </Text>
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  codeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  codeLabel: { ...typography.label, color: colors.muted, textTransform: 'uppercase' },
  code: { ...typography.h1, color: colors.accent, letterSpacing: 6 },
});
