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
 */
import { Tabs } from 'expo-router/js-tabs';
import type { ColorValue } from 'react-native';

import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/Icon';
import { TabBar } from '@/components/TabBar';
import { useAuth } from '@/lib/auth-context';
import { colors } from '@/theme';

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
  return (
    <Tabs
      // Our own bar (src/components/TabBar.tsx) with the gold indicator.
      tabBar={(props) => <TabBar {...props} />}
      // Android back from Me or Admin goes to Tonight first, then leaves.
      backBehavior="firstRoute"
      screenOptions={{
        // Each screen draws its own big title, so no top bar.
        headerShown: false,
        // No fade or slide when switching tabs (spec: instant).
        animation: 'none',
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
