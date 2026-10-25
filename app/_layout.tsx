/**
 * Root layout: the frame that wraps every screen in the app.
 *
 * expo-router treats any file named `_layout.tsx` as a wrapper for the screens
 * in its folder. This one sets up a "stack" navigator (screens slide on top of
 * each other, with a back gesture) and paints its header and background with
 * our dark theme colors.
 */
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { colors } from '@/theme';

/**
 * Renders the stack navigator that holds all screens.
 *
 * Returns: the navigator plus a light status bar (light clock and battery icons,
 * so they're visible on our dark background).
 */
export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        {/* index.tsx is the Tonight screen. It draws its own big title, so the bar on top is hidden. */}
        <Stack.Screen name="index" options={{ title: 'Tonight', headerShown: false }} />
      </Stack>
    </>
  );
}
