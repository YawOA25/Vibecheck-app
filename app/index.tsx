/**
 * Tonight screen (placeholder).
 *
 * This is the first screen people see. In task VC-B05 it becomes the list of
 * tonight's parties with their live vibe. For now it only proves the app runs
 * and that the dark theme is applied.
 *
 * expo-router makes `app/index.tsx` the app's home address ("/").
 */
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/theme';

/**
 * Renders the placeholder Tonight screen: a title and a short note.
 *
 * Returns: the screen's view. It takes no inputs.
 */
export default function TonightScreen() {
  return (
    // SafeAreaView adds padding so content isn't hidden under the iPhone's notch or clock.
    <SafeAreaView style={styles.container}>
      {/* accessibilityRole="header" lets screen readers announce this as a heading. */}
      <Text style={styles.title} accessibilityRole="header">
        Tonight
      </Text>
      <Text style={styles.note}>Parties near you will show up here.</Text>
    </SafeAreaView>
  );
}

/** Styles for this screen, built only from theme tokens. */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.gutter,
    gap: spacing.sm,
  },
  title: {
    ...typography.display,
    color: colors.text,
  },
  note: {
    ...typography.body,
    color: colors.muted,
  },
});
