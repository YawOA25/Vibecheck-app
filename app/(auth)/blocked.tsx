/**
 * The "sorry" screen for people refused by the 18+ gate (tasks VC-B03,
 * VC-30), in the v3 look (task VC-B03c, spec v3-ui-spec.md, 2.4).
 *
 * When it shows: the root layout shows only this screen while the sign-in
 * status is 'blocked' (see src/lib/auth-context.tsx). That happens:
 *   - right after the first sign-up screen refuses an under-18 date of
 *     birth on the phone, before any email was asked for (VC-74; signed
 *     out, nothing sent to the server),
 *   - right after the server refuses an under-18 answer, and
 *   - every time a locked login signs in again later, even on a new phone or
 *     after reinstalling, because the server remembers the refusal.
 *
 * What the person can do: only leave. No back button, no retry, and no hint
 * at the reason (spec 2.4). For a locked login (13-17) that means signing
 * out, or (VC-75) "Delete my account": after one "are you sure?" step the
 * delete-account function removes the login and everything tied to it, and
 * the server keeps only a fingerprint (HMAC) of the email for 12 months so
 * the same email is still refused. For an under-13 answer, or a refusal
 * before sign-in, there is no login (any more), so the one button just
 * closes this screen.
 *
 * Contact (VC-32c): a "Contact us" email link sits under the button once
 * the founder sets SUPPORT_EMAIL (src/lib/contact.ts). While it is empty the
 * link is simply not there.
 *
 * Privacy: this screen never shows or logs the birthdate.
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import type { HostInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FormMessage } from '@/components/FormMessage';
import { Icon } from '@/components/Icon';
import { SupportEmailLink } from '@/components/SupportEmailLink';
import { useAuth } from '@/lib/auth-context';
import { colors, headlineMaxScale, iconSize, radius, spacing, typography } from '@/theme';

/**
 * Renders the "sorry" screen.
 *
 * @returns the screen view. It takes no inputs.
 */
export default function BlockedScreen() {
  const { session, signOut, deleteAccount } = useAuth();
  // Still signed in (13-17, login kept): "Sign out". Already signed out
  // (under 13, login deleted, or refused before sign-in): "OK" reads
  // better. Both run signOut, which also closes this screen.
  const label = session ? 'Sign out' : 'OK';
  // The delete flow (VC-75): not started, the "are you sure?" question, or
  // waiting for the server.
  const [deleteStep, setDeleteStep] = useState<'idle' | 'confirm' | 'deleting'>('idle');
  // Why the last delete attempt failed, shown under the buttons.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleting = deleteStep === 'deleting';

  /**
   * The "Yes, delete" answer: asks the server to delete the login. On
   * success the phone signs out and this screen closes by itself, so only a
   * failure needs handling here. rememberRefusal keeps the phone refusing a
   * new under-18 answer after the login is gone.
   */
  async function confirmDelete() {
    setDeleteStep('deleting');
    setDeleteError(null);
    const result = await deleteAccount({ rememberRefusal: true });
    if (!result.ok) {
      setDeleteError(result.message);
      setDeleteStep('idle');
    }
  }

  // Moves the screen reader's focus to the title when the screen opens, so
  // the title is read first (spec 2.4).
  const titleRef = useRef<HostInstance>(null);
  useEffect(() => {
    if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, 'focus');
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        {/* The "info" line icon in a 56 px circle (Q4; it replaced a typed
            "i"). Decoration only: the Icon is hidden from screen readers. */}
        <View style={styles.icon}>
          <Icon name="info" size={iconSize.lg} color={colors.text} />
        </View>
        <Text
          ref={titleRef}
          style={styles.title}
          accessibilityRole="header"
          maxFontSizeMultiplier={headlineMaxScale}
        >
          {"Sorry, we can't set up your account."}
        </Text>
        <Text style={styles.body}>{"VibeCheck isn't available for you right now."}</Text>
        <View style={styles.action}>
          {deleteStep === 'idle' ? (
            <Button label={label} variant="outline" onPress={signOut} />
          ) : null}
          {/* VC-75: only a signed-in (locked) login has anything to delete. */}
          {session && deleteStep === 'idle' ? (
            <Button
              label="Delete my account"
              variant="text"
              size="small"
              onPress={() => {
                setDeleteError(null);
                setDeleteStep('confirm');
              }}
            />
          ) : null}
          {session && deleteStep !== 'idle' ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle} accessibilityRole="header">
                Delete your account?
              </Text>
              <Text style={styles.body}>
                This permanently deletes your account and signs you out. This can&apos;t be undone.
              </Text>
              <Button
                label="Yes, delete my account"
                busyLabel="Deleting..."
                variant="danger"
                onPress={confirmDelete}
                busy={deleting}
              />
              <Button
                label="Cancel"
                variant="outline"
                onPress={() => setDeleteStep('idle')}
                disabled={deleting}
              />
            </View>
          ) : null}
          {deleteError ? <FormMessage message={deleteError} /> : null}
        </View>
        <SupportEmailLink />
      </View>
    </SafeAreaView>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  // Centred block in the upper third of the screen.
  content: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.authGutter,
    paddingTop: '20%',
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.h1, color: colors.text, textAlign: 'center' },
  body: { ...typography.body, color: colors.muted, textAlign: 'center' },
  // The buttons span the content width.
  action: { alignSelf: 'stretch', marginTop: spacing.sm, gap: spacing.sm },
  // The "are you sure?" box for deleting (VC-75).
  // Same look as the delete box in Settings.
  panel: {
    gap: spacing.gap12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  panelTitle: { ...typography.cardTitle, color: colors.text, textAlign: 'center' },
});
