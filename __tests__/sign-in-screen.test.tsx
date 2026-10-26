/**
 * Tests for the sign-in screen (app/(auth)/sign-in.tsx), task VC-B03.
 *
 * Supabase is replaced with a fake ("mock") so no email is sent and no
 * network is used. We check the screen asks Supabase for the right things and
 * shows the right messages.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import SignInScreen from '../app/(auth)/sign-in';
import { supabase } from '@/lib/supabase';

// Replace the real Supabase client with fakes we control in each test.
jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { auth: { signInWithOtp: jest.fn(), verifyOtp: jest.fn() } },
}));

// Typed handles on the fakes, so tests can set what they return.
const auth = supabase.auth as unknown as {
  signInWithOtp: jest.Mock;
  verifyOtp: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
  auth.verifyOtp.mockResolvedValue({ data: {}, error: null });
});

/** Types an email and taps "Send code". */
async function sendCodeTo(email: string) {
  await fireEvent.changeText(screen.getByLabelText('Email'), email);
  await fireEvent.press(screen.getByRole('button', { name: 'Send code' }));
}

describe('SignInScreen', () => {
  it('sends a code to the cleaned email and moves to the code step', async () => {
    await render(<SignInScreen />);
    await sendCodeTo('  Ava@Example.com ');

    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'ava@example.com',
      options: { shouldCreateUser: true },
    });
    expect(await screen.findByRole('header', { name: 'Check your email' })).toBeOnTheScreen();
    expect(screen.getByText('Enter the code we sent to ava@example.com.')).toBeOnTheScreen();
  });

  it('refuses an address that is not an email, without calling Supabase', async () => {
    await render(<SignInScreen />);
    await sendCodeTo('not-an-email');

    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(await screen.findByText("That email address doesn't look right.")).toBeOnTheScreen();
  });

  it('stays on the email step and explains a rate limit', async () => {
    auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { code: 'over_email_send_rate_limit', status: 429, message: 'rate limit' },
    });
    await render(<SignInScreen />);
    await sendCodeTo('ava@example.com');

    expect(await screen.findByText(/Too many codes/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Email')).toBeOnTheScreen();
  });

  it('checks the code with Supabase, digits only', async () => {
    await render(<SignInScreen />);
    await sendCodeTo('ava@example.com');

    const signIn = await screen.findByRole('button', { name: 'Sign in' });
    // Fewer than 6 digits: the button stays disabled.
    await fireEvent.changeText(screen.getByLabelText('Code'), '123');
    expect(signIn).toBeDisabled();

    // A pasted code with a space still works.
    await fireEvent.changeText(screen.getByLabelText('Code'), '123 456');
    expect(signIn).toBeEnabled();
    await fireEvent.press(signIn);

    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'ava@example.com',
      token: '123456',
      type: 'email',
    });
  });

  it('shows a clear message for a wrong or expired code', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: {},
      error: { code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' },
    });
    await render(<SignInScreen />);
    await sendCodeTo('ava@example.com');
    await fireEvent.changeText(await screen.findByLabelText('Code'), '000000');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(/code didn't work/)).toBeOnTheScreen();
  });

  it('can go back to fix the email address', async () => {
    await render(<SignInScreen />);
    await sendCodeTo('ava@example.com');
    await fireEvent.press(await screen.findByRole('button', { name: 'Use a different email' }));

    expect(screen.getByRole('header', { name: 'Sign in to VibeCheck' })).toBeOnTheScreen();
  });
});
