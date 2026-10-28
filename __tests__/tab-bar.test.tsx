/**
 * Tests for the Q4 bottom tab bar (app/(tabs)/_layout.tsx,
 * src/components/TabBar.tsx) and the Admin hub (app/(tabs)/admin.tsx).
 *
 * What it proves:
 *   - a signed-in guest sees two tabs (Tonight, Me); an admin sees three
 *     (plus Admin); signed-out and blocked people see no bar at all;
 *   - each tab is read as a "tab" with its sentence-case name, and the open
 *     one is "selected" and carries the gold indicator;
 *   - tapping a tab switches screens;
 *   - a non-admin opening "/admin" lands on Tonight and never sees the hub;
 *   - the bar is hidden on screens that open over the tabs (event page,
 *     check-in, recap, settings, the admin forms), and those addresses,
 *     including the recap notification's "/recap", still open;
 *   - the Admin hub's two rows open New event and Reports.
 *
 * How: expo-router's `renderRouter` builds a pretend app in memory from the
 * real root and tabs layouts (and the real Admin hub), plus simple
 * stand-in screens for everything else. The sign-in state is faked.
 */
import { act } from '@testing-library/react-native';
import { router } from 'expo-router';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import AdminHubScreen, { ADMIN_TITLE } from '../app/(tabs)/admin';
import TabsLayout from '../app/(tabs)/_layout';
import RootLayout from '../app/_layout';
import { useAuth } from '@/lib/auth-context';

jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));
// AuthProvider becomes a plain pass-through; useAuth returns what each test sets.
jest.mock('@/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: jest.fn(),
}));

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
 * Builds the pretend app (real root layout, real tabs layout, real Admin
 * hub, stand-ins for the rest) and opens it at `url`.
 *
 * @param url - the address to open, e.g. '/' or '/event/e1'.
 */
async function openAt(url: string) {
  await renderRouter(
    {
      _layout: RootLayout,
      '(tabs)/_layout': TabsLayout,
      '(tabs)/index': () => <Text>Tonight screen</Text>,
      '(tabs)/me': () => <Text>Me screen</Text>,
      '(tabs)/admin': AdminHubScreen,
      'event/[id]': () => <Text>Event screen</Text>,
      'check-in/[id]': () => <Text>Check-in screen</Text>,
      recap: () => <Text>Recap screen</Text>,
      settings: () => <Text>Settings screen</Text>,
      'admin/new-event': () => <Text>New event screen</Text>,
      'admin/reports': () => <Text>Reports screen</Text>,
      '(auth)/sign-in': () => <Text>Sign-in screen</Text>,
      '(auth)/age-gate': () => <Text>Age gate screen</Text>,
      '(auth)/blocked': () => <Text>Sorry screen</Text>,
      terms: () => <Text>Terms screen</Text>,
      privacy: () => <Text>Privacy screen</Text>,
    },
    { initialUrl: url },
  );
}

// Note: the bar's row has role "tablist" but is not itself an "accessible"
// element (that would merge the tabs into one), and getByRole only finds
// accessible elements, so the bar is found by its test id instead.

/** The names of the tabs a screen reader would find, in order. */
function tabNames() {
  return screen.queryAllByRole('tab').map((tab) => tab.props.accessibilityLabel);
}

describe('tab bar: who sees which tabs', () => {
  it('shows a signed-in guest Tonight and Me, with Tonight selected', async () => {
    setAuth('ready', 'user');
    await openAt('/');
    expect(await screen.findByText('Tonight screen')).toBeOnTheScreen();
    expect(screen.getByTestId('tab-bar')).toBeOnTheScreen();
    expect(tabNames()).toEqual(['Tonight', 'Me']);
    expect(screen.getByRole('tab', { name: 'Tonight', selected: true })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Me', selected: false })).toBeOnTheScreen();
    expect(screen.queryByRole('tab', { name: 'Admin' })).toBeNull();
  });

  it('shows an admin a third Admin tab', async () => {
    setAuth('ready', 'admin');
    await openAt('/');
    expect(await screen.findByText('Tonight screen')).toBeOnTheScreen();
    expect(tabNames()).toEqual(['Tonight', 'Me', 'Admin']);
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

  it('shows the label in capitals but reads the sentence-case name', async () => {
    setAuth('ready', 'admin');
    await openAt('/');
    expect(await screen.findByText('TONIGHT')).toBeOnTheScreen();
    expect(screen.getByText('ME')).toBeOnTheScreen();
    expect(screen.getByText('ADMIN')).toBeOnTheScreen();
  });
});

describe('tab bar: switching', () => {
  it('opens Me from its tab and moves "selected" and the gold bar with it', async () => {
    setAuth('ready', 'user');
    await openAt('/');
    await screen.findByText('Tonight screen');
    // One gold indicator, under the open tab.
    expect(screen.getAllByTestId('tab-indicator')).toHaveLength(1);
    await fireEvent.press(screen.getByRole('tab', { name: 'Me' }));
    expect(await screen.findByText('Me screen')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Me', selected: true })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Tonight', selected: false })).toBeOnTheScreen();
    expect(screen).toHavePathname('/me');
  });

  it('keeps the old addresses: "/me" opens the Me tab directly', async () => {
    setAuth('ready', 'user');
    await openAt('/me');
    expect(await screen.findByText('Me screen')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Me', selected: true })).toBeOnTheScreen();
  });
});

describe('Admin tab and hub', () => {
  it('sends a normal user who opens "/admin" to Tonight, with no hub', async () => {
    setAuth('ready', 'user');
    await openAt('/admin');
    expect(await screen.findByText('Tonight screen')).toBeOnTheScreen();
    expect(screen.queryByText(ADMIN_TITLE)).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Admin' })).toBeNull();
  });

  it('opens the hub for an admin, from the tab and by address', async () => {
    setAuth('ready', 'admin');
    await openAt('/');
    await screen.findByText('Tonight screen');
    await fireEvent.press(screen.getByRole('tab', { name: 'Admin' }));
    expect(await screen.findByRole('header', { name: ADMIN_TITLE })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Admin', selected: true })).toBeOnTheScreen();
    await screen.unmount();

    setAuth('ready', 'admin');
    await openAt('/admin');
    expect(await screen.findByRole('header', { name: ADMIN_TITLE })).toBeOnTheScreen();
  });

  it('opens New event from its row, over the tabs (bar hidden)', async () => {
    setAuth('ready', 'admin');
    await openAt('/admin');
    await screen.findByRole('header', { name: ADMIN_TITLE });
    await fireEvent.press(
      screen.getByRole('button', { name: 'New event. Add an event to the list.' }),
    );
    expect(await screen.findByText('New event screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/admin/new-event');
    // The tab bar stays behind the pushed screen: nothing a person can see or reach.
    expect(screen.queryByTestId('tab-bar')).toBeNull();
  });

  it('opens Reports from its row', async () => {
    setAuth('ready', 'admin');
    await openAt('/admin');
    await screen.findByRole('header', { name: ADMIN_TITLE });
    await fireEvent.press(
      screen.getByRole('button', { name: 'Reports. Review reported heads-ups.' }),
    );
    expect(await screen.findByText('Reports screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/admin/reports');
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

  it('hides the bar once an event page is pushed from Tonight', async () => {
    setAuth('ready', 'user');
    await openAt('/');
    await screen.findByText('Tonight screen');
    expect(screen.getByTestId('tab-bar')).toBeOnTheScreen();
    // What tapping an event card does (router.push), done directly here.
    await act(() => router.push('/event/e1'));
    expect(await screen.findByText('Event screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('tab-bar')).toBeNull();
  });
});
