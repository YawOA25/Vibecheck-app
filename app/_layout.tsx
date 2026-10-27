/**
 * Root layout: the frame that wraps every screen in the app.
 *
 * expo-router treats any file named `_layout.tsx` as a wrapper for the screens
 * in its folder. This one:
 *   1. shares the sign-in state with every screen (AuthProvider);
 *   2. decides which screens exist right now, based on that state:
 *        signed out            -> only the sign-in screen
 *        signed in, no profile -> only the age gate
 *        signed in + profile   -> the app itself (Tonight, event pages)
 *        ... and an admin      -> also the New event screen (VC-B04)
 *        refused by the 18+ gate -> only the "sorry" screen (VC-30)
 *      `Stack.Protected` hides screens whose `guard` is false. If someone is on
 *      a screen that becomes hidden (for example they sign out), expo-router
 *      moves them to the first screen that is allowed. So there is no way to
 *      reach Tonight without passing the age gate;
 *   3. keeps the splash screen up while the saved login is being checked
 *      AND the app's fonts are loading (v3 design, src/lib/fonts.ts), so
 *      people don't see the sign-in screen flash, or text jump from the
 *      phone's font to ours. If the fonts fail to load, the app carries on
 *      with the phone's own font;
 *   4. starts crash reports (Sentry, VC-26) if EXPO_PUBLIC_SENTRY_DSN is set.
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
import { isSupabaseConfigured } from '@/lib/supabase';
import { colors, spacing, typography } from '@/theme';

// Keep the splash screen showing until we know who is signed in and the
// fonts are ready.
// `.catch` because this can fail harmlessly if the splash is already gone.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Start crash reports as early as possible, so errors while the app starts
// are caught too. Does nothing when .env has no EXPO_PUBLIC_SENTRY_DSN.
initSentry();

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
        {/* index.tsx is the Tonight screen. */}
        <Stack.Screen name="index" options={{ title: 'Tonight' }} />
        {/* The event page and the check-in stub (VC-B05). */}
        <Stack.Screen name="event/[id]" options={{ title: 'Event' }} />
        <Stack.Screen name="check-in/[id]" options={{ title: 'Check in' }} />
      </Stack.Protected>

      {/* Admins only (VC-B04): the New event screen. This only keeps the
          screen out of reach for others; the server's create_event refuses
          non-admins by itself. */}
      <Stack.Protected guard={status === 'ready' && profile?.role === 'admin'}>
        <Stack.Screen name="admin/new-event" options={{ title: 'New event' }} />
      </Stack.Protected>

      {/* Not signed in: only the sign-in screen exists. */}
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="(auth)/sign-in" options={{ title: 'Sign in' }} />
      </Stack.Protected>

      {/* Signed in, but no profile yet: only the age gate exists. */}
      <Stack.Protected guard={status === 'needsProfile'}>
        <Stack.Screen name="(auth)/age-gate" options={{ title: 'Almost there' }} />
      </Stack.Protected>

      {/* Refused by the 18+ gate (VC-30): only the "sorry" screen exists. */}
      <Stack.Protected guard={status === 'blocked'}>
        <Stack.Screen name="(auth)/blocked" options={{ title: 'Sorry' }} />
      </Stack.Protected>
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
