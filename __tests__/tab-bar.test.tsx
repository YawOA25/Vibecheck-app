/**
 * Tests for the VC-82 bottom bar (app/(tabs)/_layout.tsx,
 * src/components/TabBar.tsx), the Admin tools section on Me
 * (app/(tabs)/me.tsx) and the old "/admin" address (app/admin/index.tsx).
 *
 * What it proves:
 *   - a signed-in guest sees two tabs (Home, Me) and NO plus; an admin sees
 *     the same two tabs plus a gold "Add event" button that is not a tab;
 *     signed-out and blocked people see no bar at all;
 *   - each tab is read as a "tab" with its sentence-case name, and the open
 *     one is "selected"; one gold indicator slides (200 ms) to the open tab,
 *     or jumps there under Reduce Motion;
 *   - tapping a tab switches screens; tapping the open tab scrolls it to the
 *     top; coming back to Home after New event re-runs its focus code (which
 *     is what shows the "added" note, VC-63b);
 *   - the plus buzzes, turns (not under Reduce Motion) and opens New event
 *     over the tabs;
 *   - Me shows "Admin tools" (Reports) to admins only, and Reports opens;
 *   - "/admin" now lands on Me for everyone, and a non-admin can't reach
 *     New event, Reports or Moderate by address;
 *   - the bar is hidden on screens that open over the tabs.
 *
 * How: expo-router's `renderRouter` builds a pretend app in memory from the
 * real root and tabs layouts (and, where it matters, the real Me screen and
 * the real "/admin" redirect), plus simple stand-in screens for everything
 * else. The sign-in state is faked.
 */
import { useFocusEffect, useScrollToTop } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { useCallback, useRef } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text } from 'react-native';

import MeScreen from '../app/(tabs)/me';
import TabsLayout from '../app/(tabs)/_layout';
import RootLayout from '../app/_layout';
import OldAdminAddress from '../app/admin';
import { tabCentre } from '@/components/TabBar';
import { useAuth } from '@/lib/auth-context';
import { tapLight } from '@/lib/haptics';
import { resetReduceMotionForTests } from '@/lib/reduce-motion';

jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));
// AuthProvider becomes a plain pass-through; useAuth returns what each test sets.
jest.mock('@/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: jest.fn(),
}));
// The real Me screen loads these; an empty answer is enough here.
jest.mock('@/lib/recap-api', () => ({
  getMyRecap: jest.fn(() => Promise.resolve({ ok: true, items: [] })),
}));
jest.mock('@/lib/profile-stats-api', () => ({
  getMyStats: jest.fn(() => Promise.resolve({ ok: false, message: 'skip' })),
}));
// The vibration: we only check WHEN it is asked for.
jest.mock('@/lib/haptics', () => ({ tapLight: jest.fn() }));

/** Counts Home's focus runs and scroll-to-top calls (see HomeStandIn). */
const mockHomeFocus = jest.fn();
const mockScrollToTop = jest.fn();

/**
 * A stand-in Home screen that does the two things the real one relies on:
 * useFocusEffect (the real one takes the "created event" note there) and
 * useScrollToTop (a tap on the open Home tab scrolls the list up).
 *
 * @returns the stand-in's text.
 */
function HomeStandIn() {
  // A pretend list: useScrollToTop calls its scrollToTop().
  const listRef = useRef({ scrollToTop: mockScrollToTop });
  useScrollToTop(listRef as unknown as Parameters<typeof useScrollToTop>[0]);
  useFocusEffect(useCallback(() => mockHomeFocus(), []));
  return <Text>Home screen</Text>;
}

// renderRouter turns fake timers on and leaves them on (Q8a lesson).
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  resetReduceMotionForTests();
  mockHomeFocus.mockClear();
  mockScrollToTop.mockClear();
  (tapLight as jest.Mock).mockClear();
});

/**
 * Pretends a person in the given state (and, when signed up, role).
 *
 * @param status - the sign-in state ('ready', 'signedOut', 'blocked', ...).
 * @param role - 'user' or 'admin' (only used when signed up).
 */
function setAuth(status: string, role: 'user' | 'admin' = 'user') {
  (useAuth as jest.Mock).mockReturnValue({
    status,
    profile: status === 'ready' ? { id: 'p1', display_name: 'Ava', role, is_tester: false } : null,
    refreshProfile: jest.fn(),
    signOut: jest.fn(),
  });
}

/**
 * Pretends the phone's Reduce Motion answer, for both the hook (the gold
 * bar) and the shared copy (the plus and PressableScale).
 *
 * @param on - true = Reduce Motion on.
 */
function setReduceMotion(on: boolean) {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(on);
  resetReduceMotionForTests(on);
}

/**
 * Builds the pretend app and opens it at `url`, then runs pending timers
 * so the screen has settled before any check.
 *
 * @param url - the address to open, e.g. '/' or '/event/e1'.
 * @param realMe - true to use the real Me screen (Admin tools tests).
 */
async function openAt(url: string, realMe = false) {
  await renderRouter(
    {
      _layout: RootLayout,
      '(tabs)/_layout': TabsLayout,
      '(tabs)/index': HomeStandIn,
      '(tabs)/me': realMe ? MeScreen : () => <Text>Me screen</Text>,
      'admin/index': OldAdminAddress,
      'event/[id]': () => <Text>Event screen</Text>,
      'check-in/[id]': () => <Text>Check-in screen</Text>,
      recap: () => <Text>Recap screen</Text>,
      settings: () => <Text>Settings screen</Text>,
      'admin/new-event': () => <Text>New event screen</Text>,
      'admin/reports': () => <Text>Reports screen</Text>,
      'admin/moderate/[id]': () => <Text>Moderate screen</Text>,
      '(auth)/sign-in': () => <Text>Sign-in screen</Text>,
      '(auth)/age-gate': () => <Text>Age gate screen</Text>,
      '(auth)/blocked': () => <Text>Sorry screen</Text>,
      terms: () => <Text>Terms screen</Text>,
      privacy: () => <Text>Privacy screen</Text>,
    },
    { initialUrl: url },
  );
  await act(() => jest.runOnlyPendingTimersAsync());
}

/** A phone-sized bar width (a 375 px screen minus the 16 px side margins). */
const BAR_WIDTH = 343;

/**
 * Tells the bar how wide it is (Jest never lays anything out), so the gold
 * indicator can be placed.
 */
async function layOutBar() {
  await fireEvent(screen.getByTestId('tab-bar'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: BAR_WIDTH, height: 84 } },
  });
}

/** The gold indicator's current sideways position, in pixels. */
function indicatorX(): number {
  const style = StyleSheet.flatten(
    screen.getByTestId('tab-indicator', { includeHiddenElements: true }).props.style,
  );
  return (style.transform as { translateX: number }[])[0].translateX;
}

// Note: the bar's row has role "tablist" but is not itself an "accessible"
// element (that would merge the tabs into one), and getByRole only finds
// accessible elements, so the bar is found by its test id instead.

/** The names of the tabs a screen reader would find, in order. */
function tabNames() {
  return screen.queryAllByRole('tab').map((tab) => tab.props.accessibilityLabel);
}

describe('bar: who sees what', () => {
  it('shows a guest Home and Me, Home selected, and no plus', async () => {
    setAuth('ready', 'user');
    await openAt('/');
    expect(await screen.findByText('Home screen')).toBeOnTheScreen();
    expect(screen.getByTestId('tab-bar')).toBeOnTheScreen();
    expect(tabNames()).toEqual(['Home', 'Me']);
    expect(screen.getByRole('tab', { name: 'Home', selected: true })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Me', selected: false })).toBeOnTheScreen();
    // Hidden, not greyed: no Add event button anywhere.
    expect(screen.queryByRole('button', { name: 'Add event' })).toBeNull();
    expect(screen.queryByTestId('add-event-button')).toBeNull();
    // The old Tonight and Admin tabs are gone.
    expect(screen.queryByRole('tab', { name: 'Tonight' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Admin' })).toBeNull();
  });

  it('shows an admin the same two tabs plus the gold Add event button (not a tab)', async () => {
    setAuth('ready', 'admin');
    await openAt('/');
    expect(await screen.findByText('Home screen')).toBeOnTheScreen();
    // Still "1 of 2" and "2 of 2": the plus doesn't count as a tab.
    expect(tabNames()).toEqual(['Home', 'Me']);
    const plus = screen.getByRole('button', { name: 'Add event' });
    expect(plus.props.accessibilityHint).toBe('Opens the new event form');
    expect(screen.queryByRole('tab', { name: 'Admin' })).toBeNull();
  });

  it('shows no bar to a signed-out person or a refused login', async () => {
    setAuth('signedOut');
    await openAt('/');
    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('tab-bar')).toBeNull();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    await screen.unmount();

    setAuth('blocked');
    await openAt('/');
    expect(await screen.findByText('Sorry screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('tab-bar')).toBeNull();
  });

  it('shows the labels in capitals but reads the sentence-case names', async () => {
    setAuth('ready', 'admin');
    await openAt('/');
    expect(await screen.findByText('HOME')).toBeOnTheScreen();
    expect(screen.getByText('ME')).toBeOnTheScreen();
    expect(screen.queryByText('TONIGHT')).toBeNull();
    expect(screen.queryByText('ADMIN')).toBeNull();
  });
});

describe('bar: switching tabs', () => {
  it('opens Me from its tab and moves "selected" with it', async () => {
    setAuth('ready', 'user');
    await openAt('/');
    await screen.findByText('Home screen');
    await fireEvent.press(screen.getByRole('tab', { name: 'Me' }));
    expect(await screen.findByText('Me screen')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Me', selected: true })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Home', selected: false })).toBeOnTheScreen();
    expect(screen).toHavePathname('/me');
  });

  it('keeps the old addresses: "/me" opens the Me tab directly', async () => {
    setAuth('ready', 'user');
    await openAt('/me');
    expect(await screen.findByText('Me screen')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Me', selected: true })).toBeOnTheScreen();
  });

  it('scrolls Home to the top when its open tab is tapped again', async () => {
    setAuth('ready', 'user');
    await openAt('/');
    await screen.findByText('Home screen');
    expect(mockScrollToTop).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('tab', { name: 'Home' }));
    // useScrollToTop waits one animation frame before scrolling.
    await act(() => jest.runOnlyPendingTimersAsync());
    expect(mockScrollToTop).toHaveBeenCalled();
  });
});

describe('bar: the gold indicator', () => {
  it('works out each tab centre, leaving room for the plus slot', () => {
    // Guests: two equal halves.
    expect(tabCentre(0, 2, 300, false)).toBe(75);
    expect(tabCentre(1, 2, 300, false)).toBe(225);
    // Admins: a 76 px middle slot; (300 - 76) / 2 = 112 per tab.
    expect(tabCentre(0, 2, 300, true)).toBe(56);
    expect(tabCentre(1, 2, 300, true)).toBe(112 + 76 + 56);
  });

  it('draws one indicator only once the bar is measured, under the open tab', async () => {
    setReduceMotion(false);
    setAuth('ready', 'admin');
    await openAt('/');
    await screen.findByText('Home screen');
    // Not measured yet: no indicator (so it never flashes in the wrong spot).
    expect(screen.queryByTestId('tab-indicator', { includeHiddenElements: true })).toBeNull();
    await layOutBar();
    expect(screen.getAllByTestId('tab-indicator', { includeHiddenElements: true })).toHaveLength(1);
    // First placement is instant, centred (16 px wide) under Home.
    expect(indicatorX()).toBe(tabCentre(0, 2, BAR_WIDTH, true) - 8);
  });

  it('slides to the new tab in 200 ms on the native driver', async () => {
    setReduceMotion(false);
    setAuth('ready', 'user');
    await openAt('/');
    await screen.findByText('Home screen');
    await layOutBar();
    const timing = jest.spyOn(Animated, 'timing');
    await fireEvent.press(screen.getByRole('tab', { name: 'Me' }));
    await screen.findByText('Me screen');
    expect(timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        toValue: tabCentre(1, 2, BAR_WIDTH, false) - 8,
        duration: 200,
        useNativeDriver: true,
      }),
    );
  });

  it('jumps straight to the new tab under Reduce Motion (no slide)', async () => {
    setReduceMotion(true);
    setAuth('ready', 'user');
    await openAt('/');
    await screen.findByText('Home screen');
    await layOutBar();
    const timing = jest.spyOn(Animated, 'timing');
    await fireEvent.press(screen.getByRole('tab', { name: 'Me' }));
    await screen.findByText('Me screen');
    const target = tabCentre(1, 2, BAR_WIDTH, false) - 8;
    // No 200 ms slide was started...
    const slides = timing.mock.calls.filter(([, config]) => config.toValue === target);
    expect(slides).toHaveLength(0);
    // ...and the indicator is already there.
    expect(indicatorX()).toBe(target);
  });
});

describe('bar: the admins’ plus', () => {
  it('buzzes, turns and opens New event over the tabs (bar hidden)', async () => {
    setReduceMotion(false);
    setAuth('ready', 'admin');
    await openAt('/');
    await screen.findByText('Home screen');
    const timing = jest.spyOn(Animated, 'timing');
    await fireEvent.press(screen.getByRole('button', { name: 'Add event' }));
    expect(tapLight).toHaveBeenCalledTimes(1);
    // The quarter turn there and back: 90 ms each way.
    expect(timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: 1, duration: 90, useNativeDriver: true }),
    );
    expect(await screen.findByText('New event screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/admin/new-event');
    expect(screen.queryByTestId('tab-bar')).toBeNull();
  });

  it('still buzzes and opens New event under Reduce Motion, with no turn', async () => {
    setReduceMotion(true);
    setAuth('ready', 'admin');
    await openAt('/');
    await screen.findByText('Home screen');
    const timing = jest.spyOn(Animated, 'timing');
    await fireEvent.press(screen.getByRole('button', { name: 'Add event' }));
    expect(tapLight).toHaveBeenCalledTimes(1);
    expect(timing).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: 90 }),
    );
    expect(await screen.findByText('New event screen')).toBeOnTheScreen();
  });

  it('runs Home’s focus code again on the way back (the "added" note, VC-63b)', async () => {
    setAuth('ready', 'admin');
    await openAt('/');
    await screen.findByText('Home screen');
    const before = mockHomeFocus.mock.calls.length;
    await fireEvent.press(screen.getByRole('button', { name: 'Add event' }));
    await screen.findByText('New event screen');
    // What New event's close() does after saving.
    const { router } = jest.requireActual('expo-router');
    await act(() => router.back());
    await act(() => jest.runOnlyPendingTimersAsync());
    expect(await screen.findByText('Home screen')).toBeOnTheScreen();
    expect(mockHomeFocus.mock.calls.length).toBeGreaterThan(before);
    expect(screen.getByTestId('tab-bar')).toBeOnTheScreen();
  });
});

describe('Me: Admin tools (admins only)', () => {
  it('shows an admin "Admin tools" with Reports, which opens the queue', async () => {
    setAuth('ready', 'admin');
    await openAt('/me', true);
    expect(await screen.findByRole('header', { name: 'ADMIN TOOLS' })).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Reports. Review reported heads-ups and moderate events.',
      }),
    );
    expect(await screen.findByText('Reports screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/admin/reports');
  });

  it('never shows a normal guest the Admin tools section', async () => {
    setAuth('ready', 'user');
    await openAt('/me', true);
    expect(await screen.findByRole('header', { name: 'Ava' })).toBeOnTheScreen();
    expect(screen.queryByTestId('admin-tools')).toBeNull();
    expect(screen.queryByText('ADMIN TOOLS')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reports\./ })).toBeNull();
  });
});

describe('admin addresses after VC-82 (deep links)', () => {
  it.each(['admin', 'user'] as const)(
    'sends a %s who opens the old "/admin" to Me',
    async (role) => {
      setAuth('ready', role);
      await openAt('/admin');
      expect(await screen.findByText('Me screen')).toBeOnTheScreen();
      expect(screen).toHavePathname('/me');
      expect(screen.getByRole('tab', { name: 'Me', selected: true })).toBeOnTheScreen();
    },
  );

  it('sends a signed-out person who opens "/admin" to sign-in', async () => {
    setAuth('signedOut');
    await openAt('/admin');
    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen();
    expect(screen.queryByText('Me screen')).toBeNull();
  });

  it.each([
    ['/admin/new-event', 'New event screen'],
    ['/admin/reports', 'Reports screen'],
    ['/admin/moderate/e1', 'Moderate screen'],
  ])('keeps a normal guest out of %s (lands on Home)', async (url, text) => {
    setAuth('ready', 'user');
    await openAt(url);
    expect(await screen.findByText('Home screen')).toBeOnTheScreen();
    expect(screen.queryByText(text)).toBeNull();
  });

  it.each([
    ['/admin/new-event', 'New event screen'],
    ['/admin/reports', 'Reports screen'],
    ['/admin/moderate/e1', 'Moderate screen'],
  ])('lets an admin open %s by address', async (url, text) => {
    setAuth('ready', 'admin');
    await openAt(url);
    expect(await screen.findByText(text)).toBeOnTheScreen();
  });
});

describe('screens that open over the tabs (bar hidden, links still work)', () => {
  it.each([
    ['/event/e1', 'Event screen'],
    ['/check-in/e1', 'Check-in screen'],
    // The 11 AM recap notification opens "/recap" (VC-B12).
    ['/recap', 'Recap screen'],
    ['/settings', 'Settings screen'],
  ])('opens %s with no tab bar', async (url, text) => {
    setAuth('ready', 'user');
    await openAt(url);
    expect(await screen.findByText(text)).toBeOnTheScreen();
    expect(screen.queryByTestId('tab-bar')).toBeNull();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });
});
