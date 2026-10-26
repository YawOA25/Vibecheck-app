/**
 * Tests for the age gate screen (app/(auth)/age-gate.tsx), task VC-B03.
 *
 * Supabase and the sign-in state are replaced with fakes. We check that:
 *   - an adult's details go to `complete_profile` in the right format;
 *   - an under-18 date is blocked on the phone and never sent;
 *   - if the server says "under 18", the screen blocks too (server wins);
 *   - bad input is caught with a clear message.
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

// A birth year that is 10 years ago: clearly under 18 whenever the tests run.
const childYear = String(new Date().getFullYear() - 10);

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ refreshProfile, signOut });
  rpc.mockResolvedValue({ data: null, error: null });
  refreshProfile.mockResolvedValue(undefined);
});

/** Fills in the form and taps Continue. */
async function submit(name: string, month: string, day: string, year: string) {
  await fireEvent.changeText(screen.getByLabelText('Display name'), name);
  await fireEvent.changeText(screen.getByLabelText('Month'), month);
  await fireEvent.changeText(screen.getByLabelText('Day'), day);
  await fireEvent.changeText(screen.getByLabelText('Year'), year);
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

  it('blocks an under-18 date on the phone and sends nothing', async () => {
    await render(<AgeGateScreen />);
    await submit('Kid', '6', '1', childYear);

    expect(rpc).not.toHaveBeenCalled();
    expect(await screen.findByText('VibeCheck is for people 18 and older.')).toBeOnTheScreen();
    // The form is gone; the only way on is to sign out.
    expect(screen.queryByLabelText('Year')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalled();
  });

  it('blocks when the server says under 18, even if the phone thought otherwise', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'VCA18', message: 'under 18' } });
    await render(<AgeGateScreen />);
    await submit('Ava', '5', '5', '1995');

    expect(await screen.findByText('VibeCheck is for people 18 and older.')).toBeOnTheScreen();
    expect(refreshProfile).not.toHaveBeenCalled();
  });

  it('refuses a date that does not exist', async () => {
    await render(<AgeGateScreen />);
    await submit('Ava', '2', '30', '1995');

    expect(rpc).not.toHaveBeenCalled();
    expect(await screen.findByText(/Please enter a real date/)).toBeOnTheScreen();
  });

  it('refuses a future date', async () => {
    await render(<AgeGateScreen />);
    await submit('Ava', '1', '1', String(new Date().getFullYear() + 1));

    expect(rpc).not.toHaveBeenCalled();
    expect(await screen.findByText('Please enter a valid date of birth.')).toBeOnTheScreen();
  });

  it('asks for a name', async () => {
    await render(<AgeGateScreen />);
    await submit('   ', '5', '5', '1995');

    expect(rpc).not.toHaveBeenCalled();
    expect(await screen.findByText('Please enter a name of 1 to 40 characters.')).toBeOnTheScreen();
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

  it('lets the person sign out to use a different email', async () => {
    await render(<AgeGateScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Use a different email' }));
    expect(signOut).toHaveBeenCalled();
  });
});
