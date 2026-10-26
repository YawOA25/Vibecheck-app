/**
 * Tests for the age gate screen (app/(auth)/age-gate.tsx), tasks VC-B03
 * and VC-30.
 *
 * Supabase and the sign-in state are replaced with fakes. We check that:
 *   - an adult's details go to `complete_profile` in the right format;
 *   - an under-18 date is SENT to the server (VC-30), and each kind of
 *     refusal leads to the right "sorry" handling;
 *   - the birthdate never reaches the console;
 *   - bad input is caught with a clear message;
 *   - the single "MM / DD / YYYY" date box (v3 look, VC-B03c) fills in its
 *     own separators and keeps Continue off until the form is complete.
 *
 * The exact-birthday edge cases (18 today, 17 years 364 days, leap days,
 * time zones) are tested on the age maths itself in age.test.ts and on the
 * server in the pgTAP tests. Here we use dates far from the line so these
 * tests keep passing every day of the year.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import AgeGateScreen from '../app/(auth)/age-gate';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: jest.fn() },
}));
jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));

const rpc = supabase.rpc as unknown as jest.Mock;
const refreshProfile = jest.fn();
const signOut = jest.fn();

const markAgeBlocked = jest.fn();

// Birth years 10 and 15 years ago: clearly under 13 and clearly 13-17
// whenever the tests run.
const childYear = String(new Date().getFullYear() - 10);
const teenYear = String(new Date().getFullYear() - 15);

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ refreshProfile, signOut, markAgeBlocked });
  markAgeBlocked.mockResolvedValue(undefined);
  rpc.mockResolvedValue({ data: null, error: null });
  refreshProfile.mockResolvedValue(undefined);
});

/**
 * Fills in the form and taps Continue. Month and day are padded to 2 digits,
 * because the date box takes exactly 8 digits (MMDDYYYY).
 */
async function submit(name: string, month: string, day: string, year: string) {
  await fireEvent.changeText(screen.getByLabelText('Your name'), name);
  const digits = month.padStart(2, '0') + day.padStart(2, '0') + year;
  await fireEvent.changeText(screen.getByLabelText('Date of birth'), digits);
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
}

describe('AgeGateScreen', () => {
  it('sends an adult to complete_profile, then reloads the profile', async () => {
    await render(<AgeGateScreen />);
    await submit('  Ava ', '5', '5', '1995');

    expect(rpc).toHaveBeenCalledWith('complete_profile', {
      p_display_name: 'Ava',
      p_birthdate: '1995-05-05',
    });
    expect(refreshProfile).toHaveBeenCalled();
  });

  // ---- VC-30: every answer goes to the server, which decides --------------

  it('sends an under-18 date to the server instead of stopping on the phone', async () => {
    rpc.mockResolvedValue({ data: 'refused_locked', error: null });
    await render(<AgeGateScreen />);
    await submit('Teen', '6', '1', teenYear);

    expect(rpc).toHaveBeenCalledWith('complete_profile', {
      p_display_name: 'Teen',
      p_birthdate: `${teenYear}-06-01`,
    });
    // 13-17: the login is locked; the root layout then shows the sorry screen.
    expect(markAgeBlocked).toHaveBeenCalledWith('locked');
    expect(refreshProfile).not.toHaveBeenCalled();
  });

  it('signs the phone out when the server deleted an under-13 login', async () => {
    rpc.mockResolvedValue({ data: 'refused_deleted', error: null });
    await render(<AgeGateScreen />);
    await submit('Kid', '6', '1', childYear);

    expect(markAgeBlocked).toHaveBeenCalledWith('deleted');
    expect(refreshProfile).not.toHaveBeenCalled();
  });

  it('shows the sorry screen when a locked login tries again with an adult year', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'VCLCK', message: 'locked' } });
    await render(<AgeGateScreen />);
    await submit('Teen', '5', '5', '1995');

    expect(markAgeBlocked).toHaveBeenCalledWith('locked');
    expect(refreshProfile).not.toHaveBeenCalled();
  });

  it('still understands the old under-18 error code', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'VCA18', message: 'under 18' } });
    await render(<AgeGateScreen />);
    await submit('Ava', '5', '5', '1995');

    expect(markAgeBlocked).toHaveBeenCalledWith('locked');
    expect(refreshProfile).not.toHaveBeenCalled();
  });

  it('never writes the birthdate to the console (legal condition 1)', async () => {
    // Watch every console channel while a refusal and an error happen.
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => {}),
    );
    rpc.mockResolvedValueOnce({ data: 'refused_locked', error: null });
    await render(<AgeGateScreen />);
    await submit('Teen', '6', '1', teenYear);
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'VCDOB', message: 'bad date' } });
    await submit('Teen', '6', '1', teenYear);

    const printed = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join('\n');
    expect(printed).not.toContain(teenYear);
    spies.forEach((spy) => spy.mockRestore());
  });

  it('refuses a date that does not exist', async () => {
    await render(<AgeGateScreen />);
    await submit('Ava', '2', '30', '1995');

    expect(rpc).not.toHaveBeenCalled();
    expect(await screen.findByText('Enter a real date, like 04 / 18 / 1998.')).toBeOnTheScreen();
  });

  it('refuses a future date', async () => {
    await render(<AgeGateScreen />);
    await submit('Ava', '1', '1', String(new Date().getFullYear() + 1));

    expect(rpc).not.toHaveBeenCalled();
    expect(await screen.findByText('Enter a real date, like 04 / 18 / 1998.')).toBeOnTheScreen();
  });

  it('asks for a name', async () => {
    await render(<AgeGateScreen />);
    await submit('   ', '5', '5', '1995');

    expect(rpc).not.toHaveBeenCalled();
    expect(await screen.findByText('Enter your name.')).toBeOnTheScreen();
  });

  it('shows the server message for other refusals', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'VCDOB', message: 'bad date' } });
    await render(<AgeGateScreen />);
    await submit('Ava', '5', '5', '1995');

    expect(await screen.findByText('Please enter a valid date of birth.')).toBeOnTheScreen();
    expect(refreshProfile).not.toHaveBeenCalled();
  });

  it('treats "already set up" as done and reloads the profile (for example after a double tap)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'VCDUP', message: 'exists' } });
    await render(<AgeGateScreen />);
    await submit('Ava', '5', '5', '1995');

    expect(refreshProfile).toHaveBeenCalled();
  });

  it('fills in the date separators and keeps Continue off until the form is complete', async () => {
    await render(<AgeGateScreen />);
    const continueButton = screen.getByRole('button', { name: 'Continue' });
    expect(continueButton).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Your name'), 'Ava');
    await fireEvent.changeText(screen.getByLabelText('Date of birth'), '041');
    expect(screen.getByLabelText('Date of birth')).toHaveDisplayValue('04 / 1');
    expect(continueButton).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Date of birth'), '04181998');
    expect(screen.getByLabelText('Date of birth')).toHaveDisplayValue('04 / 18 / 1998');
    expect(continueButton).toBeEnabled();
  });

  it('never mentions an age limit before the answer (neutral age screen)', async () => {
    await render(<AgeGateScreen />);
    expect(screen.getByRole('header', { name: 'A little about you' })).toBeOnTheScreen();
    expect(screen.queryByText(/18|older|age/i)).toBeNull();
  });

  it('lets the person sign out to use a different email', async () => {
    await render(<AgeGateScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Use a different email' }));
    expect(signOut).toHaveBeenCalled();
  });
});
