/**
 * "Party code coming soon" screen (placeholder for task VC-B07).
 *
 * Address: /join/<event id>. Opened by "Enter the party code" on the
 * check-in result screens (weak signal, location off, and so on).
 *
 * Why a placeholder: checking in with the party code (the 6-character code
 * on a card at the party) is task VC-B07. Until then this screen is honest
 * that it isn't switched on, instead of the button doing nothing. VC-B07
 * replaces this file with the real code entry. Nothing is read or stored here.
 */
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { colors, spacing, typography } from '@/theme';

/** The words on this screen (exported so tests use the same text). */
export const CODE_SOON_TITLE = 'Party code coming soon';
export const CODE_SOON_BODY =
  "Soon you'll be able to check in with the code on the card at the party. It isn't switched on yet.";

/**
 * Renders the placeholder.
 *
 * Returns: the screen's view, with a way back to check-in.
 */
export default function PartyCodeComingSoonScreen() {
  const router = useRouter();

  /** Back to the check-in screen, or home if there's no history. */
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <SafeAreaView style={styles.container}>
      <BackButton onPress={goBack} />
      <View style={styles.body}>
        <Text style={styles.title} accessibilityRole="header">
          {CODE_SOON_TITLE}
        </Text>
        <Text style={styles.text}>{CODE_SOON_BODY}</Text>
      </View>
      <Button label="Back to check-in" variant="outline" onPress={goBack} />
    </SafeAreaView>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.authGutter,
    gap: spacing.lg,
  },
  body: { flex: 1, justifyContent: 'center', gap: spacing.md },
  title: { ...typography.h1, color: colors.text },
  text: { ...typography.body, color: colors.muted },
});
