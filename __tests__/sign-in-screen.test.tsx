/**
 * Tests for the sign-in screen (app/(auth)/sign-in.tsx), tasks VC-B03 and
 * VC-B03c (v3 look).
 *
 * Supabase is replaced with a fake ("mock") so no email is sent and no
 * network is used. We check the screen asks Supabase for the right things,
 * shows the right messages, and keeps its screen-reader labels and 44 px
 * tap sizes.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import SignInScreen from '../app/(auth)/sign-in';
import { supabase } from '@/lib/supabase';

// Replace the real Supabase client with fakes we control in each test.
jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { signInWithOtp: jest.fn(), verifyOtp: jest.fn(), signInWithPassword: jest.fn() },
  },
}));

// Typed handles on the fakes, so tests can set what they return.
const auth = supabase.auth as unknown as {
  signInWithOtp: jest.Mock;
  verifyOtp: jest.Mock;
  signInWithPassword: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
  auth.verifyOtp.mockResolvedValue({ data: {}, error: null });
  auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
});

/** Types an email and taps "Continue" on the email step. */
async function sendCodeTo(email: string) {
  await fireEvent.changeText(screen.getByLabelText('Email'), email);
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
}

/** The code step's heading, as a screen reader hears it. */
const CODE_HEADING = 'Check your email';

describe('SignInScreen', () => {
  it('shows the v3 headline as one heading for screen readers', async () => {
    await render(<SignInScreen />);
    expect(
      screen.getByRole('header', { name: 'Know the vibe before you pull up.' }),
    ).toBeOnTheScreen();
    expect(
      screen.getByText("We'll email you a 8-digit code. No password needed."),
    ).toBeOnTheScreen();
  });

  it('sends a code to the cleaned email and moves to the code step', async () => {
    await render(<SignInScreen />);
    await sendCodeTo('  Ava@Example.com ');

    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'ava@example.com',
      options: { shouldCreateUser: true },
    });
    expect(await screen.findByRole('header', { name: CODE_HEADING })).toBeOnTheScreen();
    expect(
      screen.getByText('We sent a 8-digit code to ava@example.com. Enter it below.'),
    ).toBeOnTheScreen();
  });

  it('refuses an address that is not an email, without calling Supabase', async () => {
    await render(<SignInScreen />);
    await sendCodeTo('not-an-email');

    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(await screen.findByText('Enter an email like you@example.com.')).toBeOnTheScreen();
  });

  it('keeps Continue tappable on an empty email and explains what is needed', async () => {
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(await screen.findByText('Enter an email like you@example.com.')).toBeOnTheScreen();
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

  // Our hosted project sends 8-digit codes (EMAIL_CODE_LENGTH). Six digits must
  // NOT be sent on their own, or every real sign-in would fail.
  it('keeps Continue off until all 8 digits are in (6 is not enough)', async () => {
    await render(<SignInScreen />);
    await sendCodeTo('ava@example.com');
    await screen.findByRole('header', { name: CODE_HEADING });

    await fireEvent.changeText(screen.getByLabelText('8-digit code'), '123456');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('checks the code by itself when the 8th digit goes in (paste with a space works)', async () => {
    await render(<SignInScreen />);
    await sendCodeTo('ava@example.com');
    await screen.findByRole('header', { name: CODE_HEADING });

    await fireEvent.changeText(screen.getByLabelText('8-digit code'), '1234 5678');

    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'ava@example.com',
      token: '12345678',
      type: 'email',
    });
  });

  it('shows a clear message for a wrong or expired code and clears the boxes', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: {},
      error: { code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' },
    });
    await render(<SignInScreen />);
    await sendCodeTo('ava@example.com');
    await fireEvent.changeText(await screen.findByLabelText('8-digit code'), '00000000');

    expect(await screen.findByText(/code didn't work/)).toBeOnTheScreen();
    // The message is announced to screen readers.
    expect(screen.getByRole('alert')).toBeOnTheScreen();
    expect(screen.getByLabelText('8-digit code')).toHaveDisplayValue('');
  });

  it('switches "Resend code" off for 30 seconds after a code is sent', async () => {
    await render(<SignInScreen />);
    await sendCodeTo('ava@example.com');

    const resend = await screen.findByRole('button', { name: /^Resend code in 0:/ });
    expect(resend).toBeDisabled();
  });

  it('can go back to fix the email address, by link or by the Back button', async () => {
    await render(<SignInScreen />);
    await sendCodeTo('ava@example.com');
    await fireEvent.press(await screen.findByRole('button', { name: 'Use a different email' }));
    expect(screen.getByLabelText('Email')).toBeOnTheScreen();

    await sendCodeTo('ava@example.com');
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Email')).toBeOnTheScreen();
  });

  it('keeps every button at least 44 px tall', async () => {
    await render(<SignInScreen />);
    await sendCodeTo('ava@example.com');
    await screen.findByRole('header', { name: CODE_HEADING });

    for (const button of screen.getAllByRole('button')) {
      // Pressable styles can be a function of the pressed state; read the resting look.
      const raw = button.props.style;
      const style = StyleSheet.flatten(typeof raw === 'function' ? raw({ pressed: false }) : raw);
      const height = style.minHeight ?? style.height;
      expect(height).toBeGreaterThanOrEqual(44);
    }
  });
});

// Reviewer sign-in (task B14, brought forward 2026-10-26): dev builds only.
describe('Reviewer sign-in', () => {
  // `__DEV__` is a global that React Native sets; Jest sets it to true.
  // Some tests switch it off to act like a store build, then put it back.
  const globals = globalThis as unknown as { __DEV__: boolean };
  const originalDev = globals.__DEV__;
  afterEach(() => {
    globals.__DEV__ = originalDev;
  });

  it('is hidden in store builds (__DEV__ false)', async () => {
    globals.__DEV__ = false;
    await render(<SignInScreen />);
    expect(screen.queryByRole('button', { name: 'Reviewer sign-in' })).toBeNull();
  });

  it('is shown in development builds (__DEV__ true)', async () => {
    globals.__DEV__ = true;
    await render(<SignInScreen />);
    expect(screen.getByRole('button', { name: 'Reviewer sign-in' })).toBeOnTheScreen();
  });

  /** Opens the reviewer form and signs in with the given details. */
  async function reviewerSignIn(email: string, password: string) {
    globals.__DEV__ = true;
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Reviewer sign-in' }));
    await fireEvent.changeText(screen.getByLabelText('Reviewer email'), email);
    await fireEvent.changeText(screen.getByLabelText('Password'), password);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  }

  it('calls signInWithPassword with the typed email (cleaned) and password', async () => {
    await reviewerSignIn('  Reviewer@Example.com ', 'test-pass-123');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'reviewer@example.com',
      password: 'test-pass-123',
    });
    // No email code is involved.
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('explains a wrong password without ever showing or logging it', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => {}),
    );
    auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' },
    });
    await reviewerSignIn('reviewer@example.com', 'secret-pw-987');

    expect(
      await screen.findByText("That email and password don't match. Check them and try again."),
    ).toBeOnTheScreen();
    // The password box is cleared and the password is nowhere on screen or in the console.
    expect(screen.getByLabelText('Password')).toHaveDisplayValue('');
    expect(screen.queryByText(/secret-pw-987/)).toBeNull();
    const printed = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join(' | ');
    expect(printed).not.toContain('secret-pw-987');
    spies.forEach((spy) => spy.mockRestore());
  });

  it('goes back to the email-code sign-in from the Back button', async () => {
    globals.__DEV__ = true;
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Reviewer sign-in' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Email')).toBeOnTheScreen();
  });
});
