/**
 * The Settings screen (task VC-B13), opened from the round gear button on
 * the Me screen (the v3 profile design, design/v3/Profile.dc.html).
 *
 * What it holds:
 *   - ACCOUNT: who is signed in (their email) and "Sign out";
 *   - ABOUT: the Terms of Service and Privacy Policy screens (VC-32b), and
 *     "Contact us" by email once SUPPORT_EMAIL is set (VC-32c; hidden while
 *     it is empty, see src/lib/contact.ts);
 *   - "Delete account", which asks TWICE before anything happens:
 *       1. "Delete your account?" says exactly what goes and that it can't
 *          be undone, with "Continue" or "Cancel";
 *       2. "Last step" asks once more, with the red "Yes, delete my
 *          account" or "Keep my account".
 *     Only then does the app call the server (the delete-account Edge
 *     Function). When it's done, the phone signs out and the app shows the
 *     sign-in screen by itself (src/lib/auth-context.tsx, deleteAccount).
 *     If it fails, nothing is deleted and the reason shows here.
 *   When each question opens, the screen reader's focus moves to its title,
 *   so a VoiceOver or TalkBack user hears the question straight away.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { HostInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { FormMessage } from '@/components/FormMessage';
import { SupportEmailLink } from '@/components/SupportEmailLink';
import { useAuth } from '@/lib/auth-context';
import { colors, minTapTarget, radius, spacing, typography } from '@/theme';

/**
 * Where the delete flow is: not started, the first question, the second
 * (last) question, or waiting for the server.
 */
type DeleteStep = 'idle' | 'confirm' | 'final' | 'deleting';

/**
 * Renders the Settings screen.
 *
 * @returns the screen.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { session, signOut, deleteAccount } = useAuth();
  const [step, setStep] = useState<DeleteStep>('idle');
  // Why the last delete attempt failed (shown under the delete area).
  const [error, setError] = useState<string | null>(null);
  const busy = step === 'deleting';
  // The title of whichever question is open, so focus can move to it.
  const panelTitleRef = useRef<HostInstance>(null);

  // When a question opens (or the first turns into the second), move the
  // screen reader's focus to its title so it is read out at once. Not on
  // 'deleting': the busy button announces itself.
  useEffect(() => {
    if ((step === 'confirm' || step === 'final') && panelTitleRef.current) {
      AccessibilityInfo.sendAccessibilityEvent(panelTitleRef.current, 'focus');
    }
  }, [step]);

  /** Back to the Me screen. */
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  /**
   * The second "yes": asks the server to delete the account. On success the
   * auth state signs out and this screen goes away by itself, so only a
   * failure needs handling here.
   */
  async function confirmDelete() {
    setStep('deleting');
    setError(null);
    const result = await deleteAccount();
    if (!result.ok) {
      setError(result.message);
      setStep('idle');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <BackButton onPress={goBack} disabled={busy} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          Settings
        </Text>

        <View>
          <Text style={styles.sectionLabel} accessibilityRole="header">
            ACCOUNT
          </Text>
          {session?.user.email ? (
            <Text style={styles.muted}>Signed in as {session.user.email}</Text>
          ) : null}
          <View style={styles.signOut}>
            <Button label="Sign out" variant="outline" onPress={signOut} disabled={busy} />
          </View>
        </View>

        <View>
          <Text style={styles.sectionLabel} accessibilityRole="header">
            ABOUT
          </Text>
          <LinkRow label="Terms of Service" onPress={() => router.push('/terms')} />
          <LinkRow label="Privacy Policy" onPress={() => router.push('/privacy')} />
          <View style={styles.contact}>
            <SupportEmailLink />
          </View>
        </View>

        <View style={styles.block}>
          {step === 'idle' ? (
            <Button
              label="Delete account"
              variant="text"
              size="small"
              onPress={() => {
                setError(null);
                setStep('confirm');
              }}
            />
          ) : null}

          {step === 'confirm' ? (
            <View style={styles.panel}>
              <Text ref={panelTitleRef} style={styles.panelTitle} accessibilityRole="header">
                Delete your account?
              </Text>
              <Text style={styles.body}>
                This permanently deletes your profile, check-ins, ratings and heads-up tags. Your
                ratings stop counting toward event scores. This can&apos;t be undone.
              </Text>
              <Button label="Continue" variant="danger" onPress={() => setStep('final')} />
              <Button label="Cancel" variant="outline" onPress={() => setStep('idle')} />
            </View>
          ) : null}

          {step === 'final' || step === 'deleting' ? (
            <View style={styles.panel}>
              <Text ref={panelTitleRef} style={styles.panelTitle} accessibilityRole="header">
                Last step
              </Text>
              <Text style={styles.body}>
                Are you sure? Your account will be gone for good and you&apos;ll be signed out.
              </Text>
              <Button
                label="Yes, delete my account"
                busyLabel="Deleting..."
                variant="danger"
                onPress={confirmDelete}
                busy={busy}
              />
              <Button
                label="Keep my account"
                variant="outline"
                onPress={() => setStep('idle')}
                disabled={busy}
              />
            </View>
          ) : null}

          {error ? <FormMessage message={error} /> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * One tappable row that opens another screen (v3 list row with a chevron).
 *
 * @param props.label - the row's words (also what screen readers say).
 * @param props.onPress - what a tap does.
 * @returns the row.
 */
function LinkRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

/** Styles built only from theme tokens (sizes from the v3 profile design). */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  content: { padding: spacing.gutter, gap: spacing.lg, paddingBottom: spacing.xl },
  title: { ...typography.title, color: colors.text },
  sectionLabel: { ...typography.label, color: colors.muted, marginBottom: spacing.xs },
  signOut: { marginTop: spacing.gap12 },
  contact: { alignItems: 'flex-start', marginTop: spacing.xs },
  block: { gap: spacing.gap12, alignItems: 'stretch' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: minTapTarget,
  },
  rowLabel: { ...typography.body, color: colors.text },
  chevron: { ...typography.cardTitle, color: colors.muted },
  panel: {
    gap: spacing.gap12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  panelTitle: { ...typography.cardTitle, color: colors.text },
  body: { ...typography.bodySm, color: colors.text },
  muted: { ...typography.bodySm, color: colors.muted },
  pressed: { opacity: 0.7 },
});
