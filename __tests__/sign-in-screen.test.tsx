/**
 * Tests for the sign-in screen (app/(auth)/sign-in.tsx), tasks VC-B03 and
 * VC-B03c (v3 look).
 *
 * Supabase is replaced with a fake ("mock") so no email is sent and no
 * network is used. We check the screen asks Supabase for the right things,
 * shows the right messages, and keeps its screen-reader labels and 44 px
 * tap sizes.
 *
 * VC-74: the first screen now asks for the date of birth BEFORE the email.
 * The "Age first" block below checks the order and the refusals: under 13
 * and 13-17 are refused without any email box or server call, a refusal on
 * this phone also refuses a retry with an adult year, 18+ moves on with the
 * date kept in memory, and "Already have an account? Sign in" skips the age
 * step but can't create a login.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import SignInScreen from '../app/(auth)/sign-in';
import { useAuth } from '@/lib/auth-context';
import { hasRecentDeviceRefusal } from '@/lib/device-age-refusal';
import { supabase } from '@/lib/supabase';

// Replace the real Supabase client with fakes we control in each test.
jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { signInWithOtp: jest.fn(), verifyOtp: jest.fn(), signInWithPassword: jest.fn() },
  },
}));

// The sign-in state is faked: the screen only calls startSignUp (18+) and
// refuseBeforeSignIn (under 18) from it.
jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));
// The phone's "refused here before" note (src/lib/device-age-refusal.ts).
jest.mock('@/lib/device-age-refusal', () => ({ hasRecentDeviceRefusal: jest.fn() }));

const startSignUp = jest.fn();
const refuseBeforeSignIn = jest.fn(async () => {});
const deviceRefused = hasRecentDeviceRefusal as jest.Mock;

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
  (useAuth as jest.Mock).mockReturnValue({ startSignUp, refuseBeforeSignIn });
  deviceRefused.mockResolvedValue(false);
});

/** Types a date of birth on the first screen and taps "Continue". */
async function enterBirthdate(digits: string) {
  await fireEvent.changeText(screen.getByLabelText('Date of birth'), digits);
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
}

/** Renders the screen and passes the age step as an adult (born 1995). */
async function renderAtEmail() {
  await render(<SignInScreen />);
  await enterBirthdate('05051995');
  await screen.findByLabelText('Email');
}

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
    await enterBirthdate('05051995');
    expect(
      await screen.findByText("We'll email you a 8-digit code. No password needed."),
    ).toBeOnTheScreen();
  });

  it('fills the hero with generated art, hidden from screen readers (VC-32a)', async () => {
    await render(<SignInScreen />);
    const art = screen.getByTestId('sign-in-hero-art', { includeHiddenElements: true });
    expect(art.props.importantForAccessibility).toBe('no-hide-descendants');
    // It fills the hero block behind the words.
    expect(StyleSheet.flatten(art.props.style)).toMatchObject({ position: 'absolute' });
  });

  it('sends a code to the cleaned email and moves to the code step', async () => {
    await renderAtEmail();
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
    await renderAtEmail();
    await sendCodeTo('not-an-email');

    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(await screen.findByText('Enter an email like you@example.com.')).toBeOnTheScreen();
  });

  it('keeps Continue tappable on an empty email and explains what is needed', async () => {
    await renderAtEmail();
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(await screen.findByText('Enter an email like you@example.com.')).toBeOnTheScreen();
  });

  it('stays on the email step and explains a rate limit', async () => {
    auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { code: 'over_email_send_rate_limit', status: 429, message: 'rate limit' },
    });
    await renderAtEmail();
    await sendCodeTo('ava@example.com');

    expect(await screen.findByText(/Too many codes/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Email')).toBeOnTheScreen();
  });

  // Our hosted project sends 8-digit codes (EMAIL_CODE_LENGTH). Six digits must
  // NOT be sent on their own, or every real sign-in would fail.
  it('keeps Continue off until all 8 digits are in (6 is not enough)', async () => {
    await renderAtEmail();
    await sendCodeTo('ava@example.com');
    await screen.findByRole('header', { name: CODE_HEADING });

    await fireEvent.changeText(screen.getByLabelText('8-digit code'), '123456');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('checks the code by itself when the 8th digit goes in (paste with a space works)', async () => {
    await renderAtEmail();
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
    await renderAtEmail();
    await sendCodeTo('ava@example.com');
    await fireEvent.changeText(await screen.findByLabelText('8-digit code'), '00000000');

    expect(await screen.findByText(/code didn't work/)).toBeOnTheScreen();
    // The message is announced to screen readers.
    expect(screen.getByRole('alert')).toBeOnTheScreen();
    expect(screen.getByLabelText('8-digit code')).toHaveDisplayValue('');
  });

  it('switches "Resend code" off for 30 seconds after a code is sent', async () => {
    await renderAtEmail();
    await sendCodeTo('ava@example.com');

    const resend = await screen.findByRole('button', { name: /^Resend code in 0:/ });
    expect(resend).toBeDisabled();
  });

  it('can go back to fix the email address, by link or by the Back button', async () => {
    await renderAtEmail();
    await sendCodeTo('ava@example.com');
    await fireEvent.press(await screen.findByRole('button', { name: 'Use a different email' }));
    expect(screen.getByLabelText('Email')).toBeOnTheScreen();

    await sendCodeTo('ava@example.com');
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Email')).toBeOnTheScreen();
    // And the email step's own Back returns to the first screen (VC-74).
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Date of birth')).toBeOnTheScreen();
  });

  it('keeps every button at least 44 px tall', async () => {
    await renderAtEmail();
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

  it('goes back to the first screen from the Back button', async () => {
    globals.__DEV__ = true;
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Reviewer sign-in' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Date of birth')).toBeOnTheScreen();
  });

  it('is never asked for a date of birth (reviewers have an account)', async () => {
    await reviewerSignIn('reviewer@example.com', 'test-pass-123');
    expect(startSignUp).not.toHaveBeenCalled();
    expect(refuseBeforeSignIn).not.toHaveBeenCalled();
    expect(auth.signInWithPassword).toHaveBeenCalled();
  });
});

// VC-74: the date of birth comes first, and is checked on the phone only.
describe('Age first (VC-74)', () => {
  /**
   * A date of birth N years (and some days) before today, as the 8 digits
   * typed in the box. 'minus1Day' gives the day before the Nth birthday is
   * reached, i.e. one day short of N.
   */
  function digitsForAge(years: number, minus1Day = false): string {
    const now = new Date();
    const d = new Date(
      now.getFullYear() - years,
      now.getMonth(),
      now.getDate() + (minus1Day ? 1 : 0),
    );
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}${pad(d.getDate())}${d.getFullYear()}`;
  }

  it('asks for the date of birth first, with no email box yet', async () => {
    await render(<SignInScreen />);
    expect(screen.getByLabelText('Date of birth')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Email')).toBeNull();
    // Asked neutrally: no age limit is mentioned.
    expect(screen.queryByText(/18/)).toBeNull();
  });

  it('refuses under 13 at once: no email box, nothing sent to the server', async () => {
    await render(<SignInScreen />);
    await enterBirthdate(digitsForAge(10));
    expect(refuseBeforeSignIn).toHaveBeenCalledTimes(1);
    expect(startSignUp).not.toHaveBeenCalled();
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('refuses 13-17 at once the same way (one day short of 18 included)', async () => {
    await render(<SignInScreen />);
    await enterBirthdate(digitsForAge(18, true));
    expect(refuseBeforeSignIn).toHaveBeenCalledTimes(1);
    expect(startSignUp).not.toHaveBeenCalled();
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('refuses a retry with an adult year on a phone that refused before', async () => {
    deviceRefused.mockResolvedValue(true);
    await render(<SignInScreen />);
    await enterBirthdate('05051995');
    expect(refuseBeforeSignIn).toHaveBeenCalledTimes(1);
    expect(startSignUp).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('catches a typing mistake without refusing (not an age answer)', async () => {
    await render(<SignInScreen />);
    await enterBirthdate('13401995');
    expect(await screen.findByText('Enter a real date, like 04 / 18 / 1998.')).toBeOnTheScreen();
    expect(refuseBeforeSignIn).not.toHaveBeenCalled();
    expect(startSignUp).not.toHaveBeenCalled();
  });

  it('18+: keeps the date in memory, then the email may create a login', async () => {
    await renderAtEmail();
    expect(startSignUp).toHaveBeenCalledWith('1995-05-05');
    // The date was not sent anywhere: no Supabase call yet.
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    await sendCodeTo('ava@example.com');
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'ava@example.com',
      options: { shouldCreateUser: true },
    });
    // The date never goes with the email request.
    expect(JSON.stringify(auth.signInWithOtp.mock.calls)).not.toContain('1995');
  });

  it('"Already have an account? Sign in" skips the age step and never creates a login', async () => {
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Already have an account? Sign in' }));
    expect(screen.queryByLabelText('Date of birth')).toBeNull();
    expect(screen.getByText("Welcome back. We'll email you a 8-digit code.")).toBeOnTheScreen();
    await sendCodeTo('ava@example.com');
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'ava@example.com',
      options: { shouldCreateUser: false },
    });
    expect(startSignUp).not.toHaveBeenCalled();
    expect(await screen.findByRole('header', { name: CODE_HEADING })).toBeOnTheScreen();
  });

  it('on the sign-in path, an email with no account is told to go back and create one', async () => {
    auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' },
    });
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Already have an account? Sign in' }));
    await sendCodeTo('new@example.com');
    expect(
      await screen.findByText("We couldn't find an account for that email. Go back to create one."),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Email')).toBeOnTheScreen();
  });
});
