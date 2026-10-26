/**
 * Tests for the "sorry" screen (app/(auth)/blocked.tsx), tasks VC-30 and
 * VC-B03c (v3 look).
 *
 * The sign-in state is faked. We check that the screen shows the neutral
 * refusal (no reason given, spec 2.4), offers only a way out, and labels
 * that way out to match whether the phone is still signed in (13-17, login
 * kept) or not (under 13, login deleted).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import BlockedScreen from '../app/(auth)/blocked';
import { useAuth } from '@/lib/auth-context';

jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));

const signOut = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('BlockedScreen', () => {
  it('shows the refusal and lets a locked (still signed-in) login sign out', async () => {
    (useAuth as jest.Mock).mockReturnValue({ session: { user: { id: 'u1' } }, signOut });
    await render(<BlockedScreen />);

    expect(
      screen.getByRole('header', { name: "Sorry, we can't set up your account." }),
    ).toBeOnTheScreen();
    expect(screen.getByText("VibeCheck isn't available for you right now.")).toBeOnTheScreen();
    // No hint at the reason: the screen never mentions an age.
    expect(screen.queryByText(/18/)).toBeNull();
    // No form and no way back: only the exit button.
    expect(screen.queryByLabelText('Date of birth')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalled();
  });

  it('says OK when the phone is already signed out (under-13 login deleted)', async () => {
    (useAuth as jest.Mock).mockReturnValue({ session: null, signOut });
    await render(<BlockedScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'OK' }));
    // signOut also closes the screen and returns to sign-in.
    expect(signOut).toHaveBeenCalled();
  });
});
