/**
 * The "sorry" screen for people refused by the 18+ gate (tasks VC-B03, VC-30).
 *
 * When it shows: the root layout shows only this screen while the sign-in
 * status is 'blocked' (see src/lib/auth-context.tsx). That happens:
 *   - right after the server refuses an under-18 answer, and
 *   - every time a locked login signs in again later, even on a new phone or
 *     after reinstalling, because the server remembers the refusal.
 *
 * What the person can do: only leave. For a locked login (13-17) that means
 * signing out. For an under-13 answer the server has already deleted the
 * login and the phone is signed out, so the button just closes this screen.
 *
 * Privacy: this screen never shows or logs the birthdate.
 */
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { useAuth } from '@/lib/auth-context';
import { colors, spacing, typography } from '@/theme';

/**
 * Renders the "sorry" screen.
 *
 * @returns the screen view. It takes no inputs.
 */
export default function BlockedScreen() {
  const { session, signOut } = useAuth();
  // Still signed in (13-17, login kept): "Sign out". Already signed out
  // (under 13, login deleted): "OK" reads better. Both run signOut, which
  // also closes this screen.
  const label = session ? 'Sign out' : 'OK';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          Sorry
        </Text>
        <Text style={styles.note}>VibeCheck is for people 18 and older.</Text>
        <Button label={label} onPress={signOut} />
      </View>
    </SafeAreaView>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.gutter, gap: spacing.md },
  title: { ...typography.display, color: colors.text },
  note: { ...typography.body, color: colors.muted },
});
