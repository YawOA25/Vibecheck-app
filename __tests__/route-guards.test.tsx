/**
 * Tests for the screen guards in the root layout (app/_layout.tsx), VC-B03.
 *
 * What it proves: whatever address the app is opened at, a person sees only
 * the screen that matches their sign-in state. In particular, someone who is
 * signed in but hasn't passed the 18+ gate can't reach Tonight, even by
 * opening the "/" address directly.
 *
 * Admins only (VC-34): the Edit event address opens only for admins.
 *
 * How: expo-router's `renderRouter` builds a pretend app in memory from the
 * real root layout plus simple stand-in screens. The sign-in state is faked.
 *
 * Why this file used to fail now and then (Q8a, "flaky route-guards test"):
 * `renderRouter` quietly switches Jest to FAKE timers and never switches
 * back. So every test after the first ran on fake timers, where a
 * `findByText` "5 second" wait is not 5 real seconds: it is 100 quick
 * loops that each jump a fake clock 50 ms. When the whole suite runs, the
 * computer is busy, and real background work (like the fonts finishing
 * loading) could still be pending when those 100 loops ran out, so the
 * wait "timed out" after very little real time. The fix:
 *   1. after each test, go back to real timers (no leak into later tests);
 *   2. right after building the pretend app, run every waiting timer to
 *      the end (`settleRouter`), so the screen is finished BEFORE any
 *      check, instead of racing the fake 5 s budget.
 */
import { Text } from 'react-native';
import { act, renderRouter, screen } from 'expo-router/testing-library';

import TabsLayout, { TAB_CROSSFADE, tabTransition } from '../app/(tabs)/_layout';
import RootLayout, { ROUTE_OPTIONS } from '../app/_layout';
import { useAuth } from '@/lib/auth-context';

jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));
// AuthProvider becomes a plain pass-through; useAuth returns what each test sets.
jest.mock('@/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: jest.fn(),
}));

// renderRouter turns fake timers on and leaves them on; turn them off after
// every test so the next one starts clean (Q8a).
afterEach(() => {
  jest.useRealTimers();
});

/**
 * Builds the pretend app (renderRouter) and then lets it finish: every
 * pending timer is run, and the promises they start are awaited, inside
 * React's act() so the screen updates before any check (Q8a).
 *
 * @param routes - the route files for the pretend app (path -> component).
 * @param initialUrl - the address the app opens at.
 */
async function settleRouter(
  routes: Parameters<typeof renderRouter>[0],
  initialUrl: string,
): Promise<void> {
  await renderRouter(routes, { initialUrl });
  await act(async () => {
    await jest.runOnlyPendingTimersAsync();
  });
}

/**
 * Tonight as it really sits since Q4: the first tab of the "(tabs)" group
 * (the real tabs layout, with a stand-in Tonight screen). The address is
 * still "/".
 */
const TONIGHT_TAB = {
  '(tabs)/_layout': TabsLayout,
  '(tabs)/index': () => <Text>Tonight screen</Text>,
};

/** Pretends the person is in the given sign-in state. */
function setStatus(status: string) {
  (useAuth as jest.Mock).mockReturnValue({
    status,
    profile: null,
    refreshProfile: jest.fn(),
    signOut: jest.fn(),
  });
}

/** Builds the pretend app and opens it at `url`. */
async function openAt(url: string) {
  await settleRouter(
    {
      _layout: RootLayout,
      ...TONIGHT_TAB,
      '(auth)/sign-in': () => <Text>Sign-in screen</Text>,
      '(auth)/age-gate': () => <Text>Age gate screen</Text>,
      '(auth)/blocked': () => <Text>Sorry screen</Text>,
    },
    url,
  );
}

describe('root layout guards', () => {
  it('sends a signed-out person to sign-in, even when opening Tonight', async () => {
    setStatus('signedOut');
    await openAt('/');
    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen();
    expect(screen.queryByText('Tonight screen')).toBeNull();
  });

  it('sends a signed-in person without a profile to the age gate', async () => {
    setStatus('needsProfile');
    await openAt('/');
    expect(await screen.findByText('Age gate screen')).toBeOnTheScreen();
    expect(screen.queryByText('Tonight screen')).toBeNull();
  });

  it('does not let someone without a profile skip to sign-in or Tonight by address', async () => {
    setStatus('needsProfile');
    await openAt('/sign-in');
    expect(await screen.findByText('Age gate screen')).toBeOnTheScreen();
  });

  it('shows Tonight once the person has passed the gate', async () => {
    setStatus('ready');
    await openAt('/');
    expect(await screen.findByText('Tonight screen')).toBeOnTheScreen();
  });

  it('keeps a signed-in person out of the sign-in and age-gate screens', async () => {
    setStatus('ready');
    await openAt('/age-gate');
    expect(await screen.findByText('Tonight screen')).toBeOnTheScreen();
  });

  // VC-30: a login refused by the 18+ gate sees only the sorry screen.
  it('keeps a refused login on the sorry screen, even when opening Tonight or the age gate', async () => {
    setStatus('blocked');
    await openAt('/');
    expect(await screen.findByText('Sorry screen')).toBeOnTheScreen();
    expect(screen.queryByText('Tonight screen')).toBeNull();
  });

  it('does not let a refused login reach the age gate form again by address', async () => {
    setStatus('blocked');
    await openAt('/age-gate');
    expect(await screen.findByText('Sorry screen')).toBeOnTheScreen();
    expect(screen.queryByText('Age gate screen')).toBeNull();
  });

  it('Q8a: each test starts on real timers again (renderRouter left fake ones on before)', () => {
    // The tests above all used renderRouter, which turns fake timers on.
    // Fake timers carry a `clock` (modern) or are Jest mock functions (legacy).
    const fake =
      Object.prototype.hasOwnProperty.call(setTimeout, 'clock') || jest.isMockFunction(setTimeout);
    expect(fake).toBe(false);
  });

  it('offers retry and sign-out when the profile fails to load', async () => {
    setStatus('error');
    await openAt('/');
    expect(await screen.findByText("Can't load your profile")).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });
});

describe('admin-only screens (VC-34 Edit event)', () => {
  /**
   * Pretends a signed-up person with the given role, then opens the Edit
   * event address with a stand-in edit screen in the pretend app.
   *
   * @param role - 'user' or 'admin'.
   * @param isTester - whether they are a tester.
   */
  async function openEditAs(role: 'user' | 'admin', isTester = false) {
    (useAuth as jest.Mock).mockReturnValue({
      status: 'ready',
      profile: { id: 'p1', display_name: 'Ava', role, is_tester: isTester },
      refreshProfile: jest.fn(),
      signOut: jest.fn(),
    });
    await settleRouter(
      {
        _layout: RootLayout,
        ...TONIGHT_TAB,
        'admin/edit-event/[id]': () => <Text>Edit event screen</Text>,
      },
      '/admin/edit-event/e1',
    );
  }

  it('lets an admin open Edit event by address', async () => {
    await openEditAs('admin');
    expect(await screen.findByText('Edit event screen')).toBeOnTheScreen();
  });

  it('sends a normal user who opens the Edit event address to Tonight instead', async () => {
    await openEditAs('user');
    expect(await screen.findByText('Tonight screen')).toBeOnTheScreen();
    expect(screen.queryByText('Edit event screen')).toBeNull();
  });

  it('keeps a tester who is not an admin out too', async () => {
    await openEditAs('user', true);
    expect(await screen.findByText('Tonight screen')).toBeOnTheScreen();
    expect(screen.queryByText('Edit event screen')).toBeNull();
  });
});

describe('admin-only screens (VC-47, VC-58 moderation)', () => {
  /**
   * Pretends a signed-up person with the given role, then opens an address
   * with stand-ins for the report queue and the Moderate screen.
   *
   * @param role - 'user' or 'admin'.
   * @param url - the address to open.
   */
  async function openAs(role: 'user' | 'admin', url: string) {
    (useAuth as jest.Mock).mockReturnValue({
      status: 'ready',
      profile: { id: 'p1', display_name: 'Ava', role, is_tester: false },
      refreshProfile: jest.fn(),
      signOut: jest.fn(),
    });
    await settleRouter(
      {
        _layout: RootLayout,
        ...TONIGHT_TAB,
        'admin/reports': () => <Text>Reports screen</Text>,
        'admin/moderate/[id]': () => <Text>Moderate screen</Text>,
      },
      url,
    );
  }

  it('lets an admin open the report queue and the Moderate screen', async () => {
    await openAs('admin', '/admin/reports');
    expect(await screen.findByText('Reports screen')).toBeOnTheScreen();
    await screen.unmount();
    await openAs('admin', '/admin/moderate/e1');
    expect(await screen.findByText('Moderate screen')).toBeOnTheScreen();
  });

  it('sends a normal user who opens either address to Tonight instead', async () => {
    await openAs('user', '/admin/reports');
    expect(await screen.findByText('Tonight screen')).toBeOnTheScreen();
    expect(screen.queryByText('Reports screen')).toBeNull();
    await screen.unmount();
    await openAs('user', '/admin/moderate/e1');
    expect(await screen.findByText('Tonight screen')).toBeOnTheScreen();
    expect(screen.queryByText('Moderate screen')).toBeNull();
  });
});

describe('Settings and the legal screens (VC-B13, VC-32b)', () => {
  /**
   * Builds the pretend app with stand-ins for every state's first screen
   * plus Settings, Terms and Privacy, and opens it at `url`.
   *
   * @param status - the sign-in state to pretend.
   * @param url - the address to open.
   */
  async function openWithLegal(status: string, url: string) {
    setStatus(status);
    await settleRouter(
      {
        _layout: RootLayout,
        ...TONIGHT_TAB,
        '(auth)/sign-in': () => <Text>Sign-in screen</Text>,
        '(auth)/age-gate': () => <Text>Age gate screen</Text>,
        '(auth)/blocked': () => <Text>Sorry screen</Text>,
        settings: () => <Text>Settings screen</Text>,
        terms: () => <Text>Terms screen</Text>,
        privacy: () => <Text>Privacy screen</Text>,
      },
      url,
    );
  }

  it('lets a signed-out person read the Terms and the Privacy Policy', async () => {
    await openWithLegal('signedOut', '/terms');
    expect(await screen.findByText('Terms screen')).toBeOnTheScreen();
    await screen.unmount();
    await openWithLegal('signedOut', '/privacy');
    expect(await screen.findByText('Privacy screen')).toBeOnTheScreen();
  });

  it('still starts each state on its own screen, never on a legal page', async () => {
    await openWithLegal('signedOut', '/');
    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen();
    await screen.unmount();
    await openWithLegal('needsProfile', '/');
    expect(await screen.findByText('Age gate screen')).toBeOnTheScreen();
    await screen.unmount();
    await openWithLegal('blocked', '/');
    expect(await screen.findByText('Sorry screen')).toBeOnTheScreen();
  });

  it('opens Settings only for a signed-up person', async () => {
    await openWithLegal('ready', '/settings');
    expect(await screen.findByText('Settings screen')).toBeOnTheScreen();
    await screen.unmount();
    await openWithLegal('signedOut', '/settings');
    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen();
    expect(screen.queryByText('Settings screen')).toBeNull();
  });
});

/**
 * VC-76: how each kind of screen arrives and leaves (design/vc76-motion-
 * spec.md section 1). A snapshot of the settings, so a change is deliberate.
 */
describe('screen transitions (VC-76)', () => {
  it('gives every kind of route its presentation and gesture settings', () => {
    expect(ROUTE_OPTIONS).toEqual({
      // Event, settings, terms, privacy, reports, moderate.
      push: { animation: 'default', fullScreenGestureEnabled: true },
      // New and Edit event: only an edge swipe goes back.
      form: { animation: 'default', fullScreenGestureEnabled: false },
      // Rate, party code, recap: sheets from the bottom.
      modal: { presentation: 'modal' },
      // Check-in keeps the Q7 see-through sheet.
      checkIn: {
        presentation: 'transparentModal',
        animation: 'fade',
        contentStyle: { backgroundColor: 'transparent' },
      },
      // Sign-in, age gate, sorry and the tabs: a 200 ms fade, no swipe back.
      swap: { animation: 'fade', animationDuration: 200, gestureEnabled: false },
    });
  });

  it('tabs: a 150 ms cross-fade behind one switch, 100 ms under Reduce Motion, or instant', () => {
    // The founder's switch is on (the designer's recommendation) for now.
    expect(TAB_CROSSFADE).toBe(true);
    expect(tabTransition(true, false)).toMatchObject({
      animation: 'fade',
      transitionSpec: { animation: 'timing', config: { duration: 150 } },
    });
    expect(tabTransition(true, true)).toMatchObject({
      transitionSpec: { config: { duration: 100 } },
    });
    // Not answered yet counts as Reduce Motion on.
    expect(tabTransition(true, null)).toMatchObject({
      transitionSpec: { config: { duration: 100 } },
    });
    expect(tabTransition(false, false)).toEqual({ animation: 'none' });
  });
});
