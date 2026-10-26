/**
 * Tests for the "sorry" screen (app/(auth)/blocked.tsx), task VC-30.
 *
 * The sign-in state is faked. We check that the screen explains the refusal,
 * offers only a way out, and labels that way out to match whether the phone
 * is still signed in (13-17, login kept) or not (under 13, login deleted).
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

    expect(screen.getByText('VibeCheck is for people 18 and older.')).toBeOnTheScreen();
    // No form: there is nothing to type in.
    expect(screen.queryByLabelText('Year')).toBeNull();
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
