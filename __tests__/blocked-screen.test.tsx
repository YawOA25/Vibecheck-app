/**
 * Tests for the "sorry" screen (app/(auth)/blocked.tsx), tasks VC-30,
 * VC-B03c (v3 look) and VC-75 (locked logins can be deleted).
 *
 * The sign-in state is faked. We check that the screen shows the neutral
 * refusal (no reason given, spec 2.4), offers only ways out, labels the
 * exit to match whether the phone is still signed in (13-17, login kept) or
 * not (under 13, login deleted, or refused before sign-in, VC-74), and that
 * a locked login can delete itself after one "are you sure?" step.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import BlockedScreen from '../app/(auth)/blocked';
import { useAuth } from '@/lib/auth-context';

jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));

const signOut = jest.fn();
const deleteAccount = jest.fn();

/** Fakes a locked login that is still signed in. */
function signedInLocked() {
  (useAuth as jest.Mock).mockReturnValue({
    session: { user: { id: 'u1' } },
    signOut,
    deleteAccount,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  deleteAccount.mockResolvedValue({ ok: true });
});

describe('BlockedScreen', () => {
  it('shows the refusal and lets a locked (still signed-in) login sign out', async () => {
    signedInLocked();
    await render(<BlockedScreen />);

    expect(
      screen.getByRole('header', { name: "Sorry, we can't set up your account." }),
    ).toBeOnTheScreen();
    expect(screen.getByText("VibeCheck isn't available for you right now.")).toBeOnTheScreen();
    // No hint at the reason: the screen never mentions an age.
    expect(screen.queryByText(/18/)).toBeNull();
    // No form and no way back: only the two ways out.
    expect(screen.queryByLabelText('Date of birth')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('says OK, with nothing to delete, when the phone is already signed out', async () => {
    (useAuth as jest.Mock).mockReturnValue({ session: null, signOut, deleteAccount });
    await render(<BlockedScreen />);

    // Under 13 (login deleted) or refused before sign-in (VC-74): no login.
    expect(screen.queryByRole('button', { name: 'Delete my account' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'OK' }));
    // signOut also closes the screen and returns to sign-in.
    expect(signOut).toHaveBeenCalled();
  });

  // ---- VC-75: a locked login can ask to be deleted ------------------------

  it('deletes a locked login only after "are you sure?", and tells the phone to keep refusing', async () => {
    signedInLocked();
    await render(<BlockedScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    // The first tap only asks.
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(screen.getByRole('header', { name: 'Delete your account?' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Yes, delete my account' }));
    expect(deleteAccount).toHaveBeenCalledWith({ rememberRefusal: true });
  });

  it('Cancel goes back without deleting', async () => {
    signedInLocked();
    await render(<BlockedScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();
  });

  it('shows why when the deletion fails, and stays on the screen', async () => {
    deleteAccount.mockResolvedValue({ ok: false, message: 'We could not delete it.' });
    signedInLocked();
    await render(<BlockedScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, delete my account' }));
    expect(await screen.findByText('We could not delete it.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeOnTheScreen();
  });
});
