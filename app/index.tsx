/**
 * Tonight screen (placeholder).
 *
 * This is the first screen people see once signed in. In task VC-B05 it
 * becomes the list of tonight's parties with their live vibe. For now it
 * proves the app runs, greets the signed-in person, and offers "Sign out"
 * (VC-B03). Sign-out moves to the settings screen in task VC-B13.
 *
 * expo-router makes `app/index.tsx` the app's home address ("/"). The root
 * layout only allows it for signed-in people who passed the 18+ gate.
 */
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { useAuth } from '@/lib/auth-context';
import { colors, spacing, typography } from '@/theme';

/**
 * Renders the placeholder Tonight screen: a title, a greeting, a short note
 * and a sign-out button.
 *
 * Returns: the screen's view. It takes no inputs.
 */
export default function TonightScreen() {
  const { profile, signOut } = useAuth();
  return (
    // SafeAreaView adds padding so content isn't hidden under the iPhone's notch or clock.
    <SafeAreaView style={styles.container}>
      {/* accessibilityRole="header" lets screen readers announce this as a heading. */}
      <Text style={styles.title} accessibilityRole="header">
        Tonight
      </Text>
      {profile ? <Text style={styles.note}>Hi, {profile.display_name}.</Text> : null}
      <Text style={styles.note}>Parties near you will show up here.</Text>
      {/* Pushes the sign-out button to the bottom of the screen. */}
      <View style={styles.spacer} />
      <Button label="Sign out" variant="text" onPress={signOut} />
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
  spacer: { flex: 1 },
});
