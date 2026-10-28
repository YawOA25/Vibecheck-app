/**
 * The "sorry" screen for people refused by the 18+ gate (tasks VC-B03,
 * VC-30), in the v3 look (task VC-B03c, spec v3-ui-spec.md, 2.4).
 *
 * When it shows: the root layout shows only this screen while the sign-in
 * status is 'blocked' (see src/lib/auth-context.tsx). That happens:
 *   - right after the server refuses an under-18 answer, and
 *   - every time a locked login signs in again later, even on a new phone or
 *     after reinstalling, because the server remembers the refusal.
 *
 * What the person can do: only leave. No back button, no retry, and no hint
 * at the reason (spec 2.4). For a locked login (13-17) that means signing
 * out. For an under-13 answer the server has already deleted the login and
 * the phone is signed out, so the button just closes this screen.
 *
 * Contact (VC-32c): a "Contact us" email link sits under the button once
 * the founder sets SUPPORT_EMAIL (src/lib/contact.ts). While it is empty the
 * link is simply not there.
 *
 * Privacy: this screen never shows or logs the birthdate.
 */
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import type { HostInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { SupportEmailLink } from '@/components/SupportEmailLink';
import { useAuth } from '@/lib/auth-context';
import { colors, headlineMaxScale, iconSize, spacing, typography } from '@/theme';

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
          <Button label={label} variant="outline" onPress={signOut} />
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
  // The button spans the content width.
  action: { alignSelf: 'stretch', marginTop: spacing.sm },
});
