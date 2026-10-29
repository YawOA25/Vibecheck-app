/**
 * Screen tests for Settings (app/settings.tsx), task VC-B13, plus the
 * Settings gear on the Me screen.
 *
 * The sign-in state (useAuth) is faked. These tests check that:
 *   - Settings shows the signed-in email, Sign out, the Terms and Privacy
 *     rows, and NO contact link while SUPPORT_EMAIL is empty;
 *   - deleting needs TWO confirmations, and either "Cancel" or "Keep my
 *     account" backs out without calling the server;
 *   - the second "yes" calls deleteAccount exactly once, shows "Deleting...",
 *     and a failure shows the reason and goes back to the start;
 *   - the Me screen's gear button opens Settings.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import MeScreen from '../app/(tabs)/me';
import SettingsScreen from '../app/settings';
import { useAuth } from '@/lib/auth-context';
import { SUPPORT_EMAIL } from '@/lib/contact';
import { getMyRecap } from '@/lib/recap-api';

jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/recap-api', () => ({ getMyRecap: jest.fn() }));
// VC-81: the Me screen's stats row; not what these tests are about.
jest.mock('@/lib/profile-stats-api', () => ({
  getMyStats: jest.fn(() => Promise.resolve({ ok: false })),
}));
// The "mock" prefix lets jest.mock (which runs first) use this fake.
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  // Me is a tab (Q4): its list scrolls to the top on a tab tap; a no-op here.
  useScrollToTop: () => undefined,
  // Outside a real navigator the screen is "in view" once: run the effect
  // like a normal useEffect.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(effect, [effect]);
  },
}));

const signOut = jest.fn();
const deleteAccount = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({
    session: { user: { id: 'u1', email: 'ava@example.com' } },
    profile: { id: 'u1', display_name: 'Ava', role: 'user', is_tester: false },
    signOut,
    deleteAccount,
  });
});

describe('Settings', () => {
  it('shows the account, sign-out, and the legal rows; no contact link while no address is set', async () => {
    await render(<SettingsScreen />);
    expect(screen.getByText('Signed in as ava@example.com')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole('button', { name: 'Terms of Service' }));
    expect(mockPush).toHaveBeenLastCalledWith('/terms');
    await fireEvent.press(screen.getByRole('button', { name: 'Privacy Policy' }));
    expect(mockPush).toHaveBeenLastCalledWith('/privacy');

    // While SUPPORT_EMAIL (src/lib/contact.ts) is empty the link is simply
    // not there; once the founder sets it, it shows.
    if (SUPPORT_EMAIL) expect(screen.getByText(/Contact us/)).toBeOnTheScreen();
    else expect(screen.queryByText(/Contact us/)).toBeNull();
  });

  it('asks twice before deleting, and both "no" buttons back out without calling the server', async () => {
    await render(<SettingsScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));
    expect(screen.getByText('Delete your account?')).toBeOnTheScreen();
    expect(screen.getByText(/can't be undone/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete your account?')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Last step')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep my account' }));
    expect(screen.queryByText('Last step')).toBeNull();

    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('the second "yes" deletes once and shows that it is working', async () => {
    // The server answers only when the test says so, so the busy state can
    // be checked first. (The press waits for the answer, so it isn't awaited
    // until the end.)
    let answer: (value: { ok: boolean }) => void = () => {};
    deleteAccount.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    const pressing = fireEvent.press(
      screen.getByRole('button', { name: 'Yes, delete my account' }),
    );

    expect(await screen.findByText('Deleting...')).toBeOnTheScreen();
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Yes, delete my account' })).toBeBusy();
    // Nothing else can be tapped meanwhile.
    expect(screen.getByRole('button', { name: 'Keep my account' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeDisabled();
    answer({ ok: true });
    await pressing;
  });

  it('a failed deletion shows why and goes back to the start', async () => {
    deleteAccount.mockResolvedValue({ ok: false, message: "We couldn't delete your account." });
    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, delete my account' }));

    expect(await screen.findByText("We couldn't delete your account.")).toBeOnTheScreen();
    expect(screen.queryByText('Last step')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeOnTheScreen();
  });
});

describe('Settings, screen readers', () => {
  it("moves focus to each question's title when it opens", async () => {
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
    await render(<SettingsScreen />);
    expect(focus).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenLastCalledWith(expect.anything(), 'focus');
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(focus).toHaveBeenCalledTimes(2);
    focus.mockRestore();
  });
});

describe('Me screen gear', () => {
  it('opens Settings', async () => {
    (getMyRecap as jest.Mock).mockResolvedValue({ ok: true, items: [] });
    await render(<MeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });
});
