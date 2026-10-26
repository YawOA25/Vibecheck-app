/**
 * Tonight screen (placeholder), in the v3 look (task VC-B03c, spec
 * v3-ui-spec.md, 2.5).
 *
 * This is the first screen people see once signed in. In task VC-B05 it
 * becomes the list of tonight's parties with their live vibe. For now it
 * proves the app runs, greets the signed-in person, and offers "Sign out"
 * (VC-B03) in the header. Sign-out moves to the settings screen in task VC-B13.
 *
 * expo-router makes `app/index.tsx` the app's home address ("/"). The root
 * layout only allows it for signed-in people who passed the 18+ gate.
 */
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { useAuth } from '@/lib/auth-context';
import { colors, radius, spacing, typography } from '@/theme';

/**
 * Makes the small line above the title, for example "SATURDAY NIGHT".
 *
 * @param date - the moment to describe; defaults to now.
 * @returns the weekday plus "NIGHT", in capitals. Uses the phone's own day.
 */
function tonightKicker(date: Date = new Date()): string {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  return `${weekday} night`.toUpperCase();
}

/**
 * Renders the placeholder Tonight screen: a header with the day, the title
 * and a "Sign out" pill, then a card with a greeting and a note.
 *
 * Returns: the screen's view. It takes no inputs.
 */
export default function TonightScreen() {
  const { profile, signOut } = useAuth();
  return (
    // SafeAreaView adds padding so content isn't hidden under the iPhone's notch or clock.
    <SafeAreaView style={styles.container}>
      <Text style={styles.kicker}>{tonightKicker()}</Text>
      {/* Title on the left, Sign out on the right of the same row. */}
      <View style={styles.headerRow}>
        {/* accessibilityRole="header" lets screen readers announce this as a heading. */}
        <Text style={styles.title} accessibilityRole="header">
          Tonight
        </Text>
        <Button label="Sign out" variant="outline" size="small" onPress={signOut} />
      </View>
      <View style={styles.card}>
        {profile ? <Text style={styles.greeting}>Hi, {profile.display_name}.</Text> : null}
        <Text style={styles.note}>Events are coming soon.</Text>
      </View>
    </SafeAreaView>
  );
}

/** Styles for this screen, built only from theme tokens. */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.gutter,
    gap: spacing.gap12,
  },
  kicker: { ...typography.label, color: colors.muted },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.gap12,
  },
  // flexShrink lets a very large title wrap instead of pushing the button off screen.
  title: { ...typography.title, color: colors.text, flexShrink: 1 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: spacing.xs,
  },
  greeting: { ...typography.body, color: colors.text },
  note: { ...typography.bodySm, color: colors.muted },
});
