/**
 * Root layout: the frame that wraps every screen in the app.
 *
 * expo-router treats any file named `_layout.tsx` as a wrapper for the screens
 * in its folder. This one:
 *   1. shares the sign-in state with every screen (AuthProvider);
 *   2. decides which screens exist right now, based on that state:
 *        signed out            -> only the sign-in screen
 *        signed in, no profile -> only the age gate
 *        signed in + profile   -> the app itself: the bottom tabs (Tonight,
 *                                 Me, and Admin for admins; app/(tabs)/,
 *                                 Q4) and the screens that slide in over
 *                                 them (event pages, check-in, rate...)
 *        ... and an admin      -> also the New and Edit event screens
 *                                 (VC-B04, VC-34), the report queue and
 *                                 the Moderate screen (VC-47, VC-58)
 *        refused by the 18+ gate -> only the "sorry" screen (VC-30)
 *        in every state           -> the Terms and Privacy screens (VC-32b)
 *      `Stack.Protected` hides screens whose `guard` is false. If someone is on
 *      a screen that becomes hidden (for example they sign out), expo-router
 *      moves them to the first screen that is allowed. So there is no way to
 *      reach Tonight without passing the age gate;
 *   3. keeps the splash screen up while the saved login is being checked
 *      AND the app's fonts are loading (v3 design, src/lib/fonts.ts), so
 *      people don't see the sign-in screen flash, or text jump from the
 *      phone's font to ours. If the fonts fail to load, the app carries on
 *      with the phone's own font;
 *   4. starts crash reports (Sentry, VC-26) if EXPO_PUBLIC_SENTRY_DSN is set;
 *   5. opens the "Your night" recap when the guest taps the 11 AM recap
 *      notification (VC-B12), once they're signed in and past the gate;
 *   6. sets how each kind of screen arrives and leaves (VC-76, design/
 *      vc76-motion-spec.md section 1; the settings are in ROUTE_OPTIONS
 *      below):
 *        pages (event, settings, terms, privacy, reports, moderate): the
 *          phone's own slide; on iPhone a swipe from anywhere goes back;
 *        the admin forms: the same slide, but only an edge swipe goes back,
 *          so a sideways drag in a text box can't throw away typing;
 *        rate, party code and recap: a sheet from the bottom ("modal"),
 *          closed by swiping down (rate and party code switch that swipe
 *          off while work is half done, see their screens);
 *        check-in: the see-through sheet from Q7, as before;
 *        sign-in, age gate, sorry and the tabs themselves: a 200 ms fade,
 *          no sideways slide and no swipe back, because the app swaps
 *          these by itself (sign in, sign out), not the guest.
 *      Under the phone's Reduce Motion, iPhone turns slides into fades by
 *      itself, so nothing here needs changing for it.
 */
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { useAppFonts } from '@/lib/fonts';
import { initSentry } from '@/lib/sentry';
import { showRecapWhileOpen, useRecapNotificationTaps } from '@/lib/recap-notifications';
import { isSupabaseConfigured } from '@/lib/supabase';
import { colors, motion, spacing, typography } from '@/theme';

/**
 * How each screen arrives and leaves (VC-76, spec section 1), by route
 * name. Exported so a test can check every route keeps its setting.
 *   'default' animation = the phone's own push (about 350 ms on iPhone).
 *   fullScreenGestureEnabled = on iPhone, swipe back from anywhere (true)
 *     or only from the left edge (false).
 *   presentation 'modal' = a sheet rising from the bottom (iPhone: a page
 *     sheet you can swipe down; Android: slides up).
 *   gestureEnabled false = no swipe back at all.
 */
export const ROUTE_OPTIONS = {
  /** Plain pages: the platform push, swipe back from anywhere on iPhone. */
  push: { animation: 'default', fullScreenGestureEnabled: true },
  /** Admin forms: the platform push, swipe back from the edge only. */
  form: { animation: 'default', fullScreenGestureEnabled: false },
  /** Rate, party code, recap: a sheet from the bottom. */
  modal: { presentation: 'modal' },
  /** Check-in (Q7): see-through; the screen draws its own sheet slide. */
  checkIn: {
    presentation: 'transparentModal',
    animation: 'fade',
    contentStyle: { backgroundColor: 'transparent' },
  },
  /** Sign-in, age gate, sorry and the tabs: a 200 ms fade, no swipe back. */
  swap: { animation: 'fade', animationDuration: motion.authFade, gestureEnabled: false },
} as const;

// Keep the splash screen showing until we know who is signed in and the
// fonts are ready.
// `.catch` because this can fail harmlessly if the splash is already gone.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Start crash reports as early as possible, so errors while the app starts
// are caught too. Does nothing when .env has no EXPO_PUBLIC_SENTRY_DSN.
initSentry();

// If the app is open when the 11 AM recap note fires, still show it (VC-B12).
showRecapWhileOpen();

/**
 * The app's outermost component.
 *
 * @returns the navigator, wrapped in the sign-in state, or a setup note if
 *   `.env` has no Supabase settings.
 */
export default function RootLayout() {
  // Start loading the fonts straight away, alongside the sign-in check.
  const fontsReady = useAppFonts();
  if (!isSupabaseConfigured) {
    return (
      <Message
        title="Setup needed"
        body="Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env (see .env.example), then restart Expo."
      />
    );
  }
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <RootNavigator fontsReady={fontsReady} />
    </AuthProvider>
  );
}

/**
 * The stack navigator (screens slide on top of each other), with each group
 * of screens allowed only in the matching sign-in state.
 *
 * @param props.fontsReady - true once the fonts have loaded (or failed to).
 * @returns the navigator, nothing while loading, or a retry note if the
 *   profile couldn't load.
 */
function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { status, profile, refreshProfile, signOut } = useAuth();
  const loading = status === 'loading' || !fontsReady;
  // A tap on the recap notification opens the recap, but only once the
  // recap screen exists (signed in, past the 18+ gate). VC-B12.
  useRecapNotificationTaps(!loading && status === 'ready');

  // Hide the splash screen once the sign-in check and the fonts are done.
  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(() => {});
  }, [loading]);

  if (loading) return null; // the splash screen is still showing
  if (status === 'error') {
    return (
      <Message
        title="Can't load your profile"
        body="Check your connection and try again."
        actions={
          <>
            <Button label="Try again" onPress={refreshProfile} />
            <Button label="Sign out" variant="outline" onPress={signOut} />
          </>
        }
      />
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
        // Every screen so far draws its own big title, so the top bar is hidden.
        headerShown: false,
      }}
    >
      {/* Signed in AND passed the 18+ gate: the app itself. */}
      <Stack.Protected guard={status === 'ready'}>
        {/* The bottom tabs (Q4): Tonight ("/"), Me ("/me") and, for admins,
            the Admin hub ("/admin"). See app/(tabs)/_layout.tsx. Every other
            screen below opens OVER the tabs, so the tab bar hides there. */}
        <Stack.Screen name="(tabs)" options={ROUTE_OPTIONS.swap} />
        {/* The event page (VC-B05), GPS check-in (VC-B06) and the
            party-code placeholder (VC-B07 will fill it in). */}
        <Stack.Screen name="event/[id]" options={{ title: 'Event', ...ROUTE_OPTIONS.push }} />
        {/* Check-in is a bottom sheet over the dimmed event page (Q7, fix
            #7): 'transparentModal' keeps the event page drawn underneath,
            and the see-through background lets it show. The screen itself
            only fades in (a fade is fine under Reduce Motion); the sheet's
            slide up is drawn by the check-in screen, which skips it when
            Reduce Motion is on. */}
        <Stack.Screen
          name="check-in/[id]"
          options={{ title: 'Check in', ...ROUTE_OPTIONS.checkIn }}
        />
        <Stack.Screen name="join/[id]" options={{ title: 'Party code', ...ROUTE_OPTIONS.modal }} />
        {/* The 3-tap rating (VC-B08). */}
        <Stack.Screen name="rate/[id]" options={{ title: 'Rate', ...ROUTE_OPTIONS.modal }} />
        {/* The "Your night" recap (VC-B12); Me itself is a tab now. */}
        <Stack.Screen name="recap" options={{ title: 'Your night', ...ROUTE_OPTIONS.modal }} />
        {/* Settings: sign out, delete account, legal links (VC-B13). */}
        <Stack.Screen name="settings" options={{ title: 'Settings', ...ROUTE_OPTIONS.push }} />
      </Stack.Protected>

      {/* Admins only (VC-B04, VC-34): the New and Edit event screens. This only keeps the
          screen out of reach for others; the server's create_event refuses
          non-admins by itself. */}
      <Stack.Protected guard={status === 'ready' && profile?.role === 'admin'}>
        <Stack.Screen
          name="admin/new-event"
          options={{ title: 'New event', ...ROUTE_OPTIONS.form }}
        />
        {/* Edit event (VC-34): same rule; update_event refuses non-admins. */}
        <Stack.Screen
          name="admin/edit-event/[id]"
          options={{ title: 'Edit event', ...ROUTE_OPTIONS.form }}
        />
        {/* Moderation (VC-47, VC-58): the report queue and one event's
            Moderate screen. Every admin_ server function refuses non-admins. */}
        <Stack.Screen name="admin/reports" options={{ title: 'Reports', ...ROUTE_OPTIONS.push }} />
        <Stack.Screen
          name="admin/moderate/[id]"
          options={{ title: 'Moderate', ...ROUTE_OPTIONS.push }}
        />
      </Stack.Protected>

      {/* Not signed in: only the sign-in screen exists. */}
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="(auth)/sign-in" options={{ title: 'Sign in', ...ROUTE_OPTIONS.swap }} />
      </Stack.Protected>

      {/* Signed in, but no profile yet: only the age gate exists. */}
      <Stack.Protected guard={status === 'needsProfile'}>
        <Stack.Screen
          name="(auth)/age-gate"
          options={{ title: 'Almost there', ...ROUTE_OPTIONS.swap }}
        />
      </Stack.Protected>

      {/* Refused by the 18+ gate (VC-30): only the "sorry" screen exists. */}
      <Stack.Protected guard={status === 'blocked'}>
        <Stack.Screen name="(auth)/blocked" options={{ title: 'Sorry', ...ROUTE_OPTIONS.swap }} />
      </Stack.Protected>

      {/* Open to everyone (VC-32b): the Terms and the Privacy Policy, linked
          from the sign-in screen (signed out) and from Settings (signed in).
          They hold no personal data. They must stay LAST: when a screen
          becomes hidden (for example on sign-out), expo-router moves the
          person to the first allowed screen in this list, which must be the
          one for their state (sign-in, age gate, ...), never these. */}
      <Stack.Screen name="terms" options={{ title: 'Terms of Service', ...ROUTE_OPTIONS.push }} />
      <Stack.Screen name="privacy" options={{ title: 'Privacy Policy', ...ROUTE_OPTIONS.push }} />
    </Stack>
  );
}

/**
 * A simple full-screen message, used outside the navigator (setup or error).
 *
 * @param props.title - the heading.
 * @param props.body - one or two sentences under it.
 * @param props.actions - optional buttons.
 * @returns the message view.
 */
function Message({ title, body, actions }: { title: string; body: string; actions?: ReactNode }) {
  return (
    <View style={styles.message}>
      <StatusBar style="light" />
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.body}>{body}</Text>
      {actions}
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  message: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.authGutter,
    backgroundColor: colors.bg,
  },
  title: { ...typography.h1, color: colors.text },
  body: { ...typography.body, color: colors.muted },
});
