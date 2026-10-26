/**
 * Root layout: the frame that wraps every screen in the app.
 *
 * expo-router treats any file named `_layout.tsx` as a wrapper for the screens
 * in its folder. This one:
 *   1. shares the sign-in state with every screen (AuthProvider);
 *   2. decides which screens exist right now, based on that state:
 *        signed out            -> only the sign-in screen
 *        signed in, no profile -> only the age gate
 *        signed in + profile   -> the app itself (Tonight)
 *      `Stack.Protected` hides screens whose `guard` is false. If someone is on
 *      a screen that becomes hidden (for example they sign out), expo-router
 *      moves them to the first screen that is allowed. So there is no way to
 *      reach Tonight without passing the age gate;
 *   3. keeps the splash screen up while the saved login is being checked, so
 *      people don't see the sign-in screen flash for a moment.
 */
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { isSupabaseConfigured } from '@/lib/supabase';
import { colors, spacing, typography } from '@/theme';

// Keep the splash screen showing until we know who is signed in.
// `.catch` because this can fail harmlessly if the splash is already gone.
SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * The app's outermost component.
 *
 * @returns the navigator, wrapped in the sign-in state, or a setup note if
 *   `.env` has no Supabase settings.
 */
export default function RootLayout() {
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
      <RootNavigator />
    </AuthProvider>
  );
}

/**
 * The stack navigator (screens slide on top of each other), with each group
 * of screens allowed only in the matching sign-in state.
 *
 * @returns the navigator, nothing while loading, or a retry note if the
 *   profile couldn't load.
 */
function RootNavigator() {
  const { status, refreshProfile, signOut } = useAuth();

  // Hide the splash screen once the sign-in check has finished.
  useEffect(() => {
    if (status !== 'loading') SplashScreen.hideAsync().catch(() => {});
  }, [status]);

  if (status === 'loading') return null; // the splash screen is still showing
  if (status === 'error') {
    return (
      <Message
        title="Can't load your profile"
        body="Check your connection and try again."
        actions={
          <>
            <Button label="Try again" onPress={refreshProfile} />
            <Button label="Sign out" variant="text" onPress={signOut} />
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
      </Stack.Protected>

      {/* Not signed in: only the sign-in screen exists. */}
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="(auth)/sign-in" options={{ title: 'Sign in' }} />
      </Stack.Protected>

      {/* Signed in, but no profile yet: only the age gate exists. */}
      <Stack.Protected guard={status === 'needsProfile'}>
        <Stack.Screen name="(auth)/age-gate" options={{ title: 'Almost there' }} />
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
    padding: spacing.gutter,
    backgroundColor: colors.bg,
  },
  title: { ...typography.title, color: colors.text },
  body: { ...typography.body, color: colors.muted },
});
