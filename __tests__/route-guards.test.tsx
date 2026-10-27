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
 */
import { Text } from 'react-native';
import { renderRouter, screen } from 'expo-router/testing-library';

import RootLayout from '../app/_layout';
import { useAuth } from '@/lib/auth-context';

jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));
// AuthProvider becomes a plain pass-through; useAuth returns what each test sets.
jest.mock('@/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: jest.fn(),
}));

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
  await renderRouter(
    {
      _layout: RootLayout,
      index: () => <Text>Tonight screen</Text>,
      '(auth)/sign-in': () => <Text>Sign-in screen</Text>,
      '(auth)/age-gate': () => <Text>Age gate screen</Text>,
      '(auth)/blocked': () => <Text>Sorry screen</Text>,
    },
    { initialUrl: url },
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
    await renderRouter(
      {
        _layout: RootLayout,
        index: () => <Text>Tonight screen</Text>,
        'admin/edit-event/[id]': () => <Text>Edit event screen</Text>,
      },
      { initialUrl: '/admin/edit-event/e1' },
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
