/**
 * The bottom tabs (Q4 "launch look", spec section 2.3): Tonight, Me and,
 * for admins only, Admin.
 *
 * How it fits in: the folder name "(tabs)" is in brackets, so it doesn't
 * change any address. Tonight is still "/", Me is still "/me", and the
 * Admin hub is "/admin". The root layout (app/_layout.tsx) opens this group
 * only for people who are signed in and past the 18+ gate, so signed-out
 * and blocked people never see the bar.
 *
 * Every other screen (event page, check-in, rate, recap, settings, the
 * admin forms...) lives in the root Stack, so it slides in OVER the tabs and
 * the bar is hidden there, as the design wants.
 *
 * Admin tab: `Tabs.Protected` with `guard={isAdmin}` removes the Admin tab
 * (and its "/admin" address) for everyone else. That only hides the button;
 * the server already refuses every admin action from non-admins, and the
 * admin forms themselves are guarded again in the root layout.
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
import { Tabs } from 'expo-router/js-tabs';
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
 * @returns Tonight and Me for everyone signed in, plus Admin for admins.
 */
export default function TabsLayout() {
  const { profile } = useAuth();
  // Only admins get the Admin tab (the server checks every admin action too).
  const isAdmin = profile?.role === 'admin';
  // VC-76: shortens the tab fade under Reduce Motion.
  const reduceMotion = useReduceMotion();
  return (
    <Tabs
      // Our own bar (src/components/TabBar.tsx) with the gold indicator.
      tabBar={(props) => <TabBar {...props} />}
      // Android back from Me or Admin goes to Tonight first, then leaves.
      backBehavior="firstRoute"
      screenOptions={{
        // Each screen draws its own big title, so no top bar.
        headerShown: false,
        // VC-76: cross-fade or instant, per TAB_CROSSFADE above.
        ...tabTransition(TAB_CROSSFADE, reduceMotion),
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {/* index.tsx is Tonight ("/"). Listed first: it's the home tab. */}
      <Tabs.Screen name="index" options={{ title: 'Tonight', tabBarIcon: tabIcon('moon') }} />
      <Tabs.Screen name="me" options={{ title: 'Me', tabBarIcon: tabIcon('person') }} />
      <Tabs.Protected guard={isAdmin}>
        <Tabs.Screen name="admin" options={{ title: 'Admin', tabBarIcon: tabIcon('clipboard') }} />
      </Tabs.Protected>
    </Tabs>
  );
}
