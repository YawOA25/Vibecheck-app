/**
 * "Check-in coming soon" screen (task VC-B05 stub).
 *
 * Address: /check-in/<event id>. Opened by "I'm here" on the event page.
 *
 * Why a stub: GPS check-in is task VC-B06 (the phone's location is checked
 * on the server, then the result screens). Until it is built, "I'm here"
 * leads here, so the button is honest about what happens instead of doing
 * nothing. VC-B06 replaces this file with the real check-in. Nothing about
 * location is read or stored here.
 */
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { colors, spacing, typography } from '@/theme';

/** The words on this screen (exported so tests use the same text). */
export const COMING_SOON_TITLE = 'Check-in coming soon';
export const COMING_SOON_BODY =
  "Soon you'll tap \"I'm here\" at the party to check in and rate the vibe. It isn't switched on yet.";

/**
 * Renders the stub.
 *
 * Returns: the screen's view, with a way back to the event.
 */
export default function CheckInComingSoonScreen() {
  const router = useRouter();

  /** Back to the event page, or home if there's no history. */
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <SafeAreaView style={styles.container}>
      <BackButton onPress={goBack} />
      <View style={styles.body}>
        <Text style={styles.title} accessibilityRole="header">
          {COMING_SOON_TITLE}
        </Text>
        <Text style={styles.text}>{COMING_SOON_BODY}</Text>
      </View>
      <Button label="Back to the event" variant="outline" onPress={goBack} />
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
