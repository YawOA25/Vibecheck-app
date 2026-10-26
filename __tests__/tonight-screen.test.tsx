/**
 * Render test for the Tonight screen.
 *
 * React Native Testing Library draws the screen in memory (no phone needed) and
 * lets us look for text the way a user would see it. This proves the screen
 * renders without crashing, shows its title, note and greeting, and that
 * "Sign out" signs out (VC-B03). The sign-in state is replaced with a fake.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import TonightScreen from '../app/index';
import { useAuth } from '@/lib/auth-context';

jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));

const signOut = jest.fn();

beforeEach(() => {
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'user-1', display_name: 'Ava', role: 'user', is_tester: false },
    signOut,
  });
});

describe('TonightScreen', () => {
  it('shows the Tonight heading, a greeting and the placeholder note', async () => {
    await render(<TonightScreen />);

    // getByRole finds the heading the same way a screen reader would.
    expect(screen.getByRole('header', { name: 'Tonight' })).toBeOnTheScreen();
    expect(screen.getByText('Hi, Ava.')).toBeOnTheScreen();
    expect(screen.getByText('Parties near you will show up here.')).toBeOnTheScreen();
  });

  it('signs out from the Sign out button', async () => {
    await render(<TonightScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalled();
  });
});
