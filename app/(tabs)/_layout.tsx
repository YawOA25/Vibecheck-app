/**
 * The bottom tabs: Home and Me for everyone (VC-82, design/vc82-bottom-bar-
 * spec.md; founder approved 2026-10-29). Admins also get a gold plus in the
 * middle of the bar that opens New event.
 *
 * How it fits in: the folder name "(tabs)" is in brackets, so it doesn't
 * change any address. Home is still "/" (the same screen as the old
 * "Tonight" tab, only renamed) and Me is still "/me". The root layout
 * (app/_layout.tsx) opens this group only for people who are signed in and
 * past the 18+ gate, so signed-out and blocked people never see the bar.
 *
 * Every other screen (event page, check-in, rate, recap, settings, the
 * admin forms...) lives in the root Stack, so it slides in OVER the tabs and
 * the bar is hidden there, as the design wants.
 *
 * What happened to the Admin tab (VC-82): it is gone. Its one daily job,
 * New event, is now the plus; Reports (which leads to Moderate) moved to
 * Me, under "Admin tools", shown only to admins. The old "/admin" address
 * now lands on Me (app/admin/index.tsx). The plus is passed to the bar only
 * when the profile says "admin"; that only hides the button. The New event,
 * Reports and Moderate screens are guarded again in the root layout, and
 * the server refuses every admin action from non-admins.
 *
 * Switching tabs (VC-76, design/vc76-motion-spec.md section 1): the founder
 * hasn't chosen yet between a soft 150 ms cross-fade (the designer's
 * recommendation) and the instant iOS-style switch. Both are built: flip
 * TAB_CROSSFADE below (true = fade, false = instant). Under Reduce Motion
 * the fade stays (a fade moves nothing) but takes 100 ms.
 *
 * (The spec also asks for `freezeOnBlur`, so hidden tabs stop re-drawing.
 * Expo Router's own tabs ignore that option, so it isn't set; the home
 * list's minute refresh already stops while its tab is out of view.)
 */
import { useRouter } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useCallback } from 'react';
import type { ColorValue } from 'react-native';

import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/Icon';
import { TabBar } from '@/components/TabBar';
import { useAuth } from '@/lib/auth-context';
import { motionAllowed, useReduceMotion } from '@/lib/reduce-motion';
import { colors, motion } from '@/theme';

/**
 * The founder's one-line switch for the tab change (VC-76):
 *   true  = a 150 ms cross-fade between tabs (designer's recommendation);
 *   false = instant, no animation (the iOS convention, as before VC-76).
 */
export const TAB_CROSSFADE = true;

/**
 * The tab change settings for the bottom tabs.
 *
 * @param crossfade - TAB_CROSSFADE (a parameter so tests can try both).
 * @param reduceMotion - the phone's Reduce Motion answer (null = not known).
 * @returns `{ animation: 'none' }` for the instant switch, or a fade
 *   lasting 150 ms (100 ms under Reduce Motion or before the phone answers).
 */
export function tabTransition(crossfade: boolean, reduceMotion: boolean | null) {
  if (!crossfade) return { animation: 'none' as const };
  return {
    animation: 'fade' as const,
    transitionSpec: {
      animation: 'timing' as const,
      config: {
        duration: motionAllowed(reduceMotion) ? motion.tabFade : motion.reducedFade,
        easing: motion.base.easing,
      },
    },
  };
}

/**
 * Builds a tab's icon drawer: the tab bar calls it with the colour to use
 * (gold when open, grey when not) and the 22 px size.
 *
 * @param name - which line icon the tab shows.
 * @returns the `tabBarIcon` function for that tab.
 */
function tabIcon(name: IconName) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Icon name={name} color={color} size={size} />;
  };
}

/**
 * The tabs navigator.
 *
 * @returns Home and Me for everyone signed in, with the Add event plus in
 *   the bar for admins.
 */
export default function TabsLayout() {
  const router = useRouter();
  const { profile } = useAuth();
  // Only admins get the plus (the root layout and the server check too).
  const isAdmin = profile?.role === 'admin';
  // VC-76: shortens the tab fade under Reduce Motion.
  const reduceMotion = useReduceMotion();
  // The plus opens today's New event form over the tabs. After saving, the
  // form goes back and Home reloads with its "added" note (VC-63b).
  const openNewEvent = useCallback(() => router.push('/admin/new-event'), [router]);
  return (
    <Tabs
      // Our own bar (src/components/TabBar.tsx): the floating pill with the
      // sliding gold indicator, and the plus only when we pass onAddEvent.
      tabBar={(props) => <TabBar {...props} onAddEvent={isAdmin ? openNewEvent : undefined} />}
      // Android back from Me goes to Home first, then leaves the app.
      backBehavior="firstRoute"
      screenOptions={{
        // Each screen draws its own big title, so no top bar.
        headerShown: false,
        // VC-76: cross-fade or instant, per TAB_CROSSFADE above.
        ...tabTransition(TAB_CROSSFADE, reduceMotion),
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {/* index.tsx is Home ("/"), the old Tonight tab renamed (VC-82).
          Listed first: it's the home tab. */}
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('house') }} />
      <Tabs.Screen name="me" options={{ title: 'Me', tabBarIcon: tabIcon('person') }} />
    </Tabs>
  );
}
