/**
 * Tests for the party-code screen (app/join/[id].tsx) and its wording
 * (src/lib/join-screens.ts), task VC-B07. VC-32d: a passed code gives the
 * success haptic and a wrong code the warning haptic (both faked).
 *
 * The router, the signed-in profile, the event read and the server calls
 * are fakes, so each test chooses what "happens". We check every state:
 *   - loading, load error (with Try again), and event not found;
 *   - the form: label, code boxes, "Check me in"; an incomplete code is
 *     caught on the phone and never sent;
 *   - a wrong code: the tries-left sentence (4 tries / 1 try), boxes cleared;
 *   - locked, outside the window (too early / too late), code switched
 *     off, and success, each replacing the form with a result and "Back";
 *   - a network error shows a sentence and keeps the form;
 *   - the tester button: shown only to testers on test events, it calls
 *     the tester check-in; hidden for non-testers and on real events;
 *   - the typed code never reaches the console.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import JoinScreen, {
  CHECK_ME_IN,
  CODE_FIELD_LABEL,
  NOT_FOUND_TITLE,
  TESTER_CHECK_IN,
} from '../app/join/[id]';
import { useAuth } from '@/lib/auth-context';
import { submitCodeCheckIn, submitTesterCheckIn } from '@/lib/code-check-in-api';
import type { CodeCheckInOutcome } from '@/lib/code-check-in-api';
import { getEvent } from '@/lib/events-read';
import { INCOMPLETE_CODE_MESSAGE, wrongCodeMessage } from '@/lib/join-screens';
import { tapSuccess, tapWarning } from '@/lib/haptics';
import type { PublicEvent } from '@/lib/tonight';

jest.mock('@/lib/events-read', () => ({ getEvent: jest.fn() }));
jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));
// VC-32d: fake vibrations, so tests can check WHEN each one fires.
jest.mock('@/lib/haptics', () => ({
  tapLight: jest.fn(),
  tapSuccess: jest.fn(),
  tapWarning: jest.fn(),
}));
// The real API file is loaded below for its helpers; give it a fake client
// so no real Supabase (or phone storage) is touched.
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
// Keep the real cleanPartyCode and constants; fake only the two server calls.
jest.mock('@/lib/code-check-in-api', () => ({
  ...jest.requireActual('@/lib/code-check-in-api'),
  submitCodeCheckIn: jest.fn(),
  submitTesterCheckIn: jest.fn(),
}));
// The "mock" prefix lets jest.mock (which runs first) use these fakes.
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({ id: 'e1' }),
}));

const get = getEvent as jest.Mock;
const auth = useAuth as jest.Mock;
const submitCode = submitCodeCheckIn as jest.Mock;
const submitTester = submitTesterCheckIn as jest.Mock;

/** A real party that's on now (public facts only). */
const EVENT: PublicEvent = {
  id: 'e1',
  title: 'Rooftop Sundown',
  area_label: 'Navy Yard, DC',
  starts_at: '2026-10-31T01:00:00Z',
  ends_at: '2026-10-31T06:00:00Z',
  source: 'host',
  ticket_url: null,
  summary: null,
  is_21_plus: false,
  is_test: false,
};

let consoleSpies: jest.SpyInstance[];

beforeEach(() => {
  jest.clearAllMocks();
  get.mockResolvedValue({ ok: true, event: EVENT });
  auth.mockReturnValue({
    profile: { id: 'u1', display_name: 'Sam', role: 'user', is_tester: false },
  });
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
    jest.spyOn(console, name).mockImplementation(() => {}),
  );
});

afterEach(() => {
  // Privacy: the typed code never reaches the console.
  for (const spy of consoleSpies) {
    for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toMatch(/K7MX2Q|QQ9QQ9/);
    spy.mockRestore();
  }
});

/**
 * Opens the screen, types a code and taps "Check me in".
 *
 * @param code - what the guest types.
 * @param outcome - what the server answers.
 */
async function enterCode(code: string, outcome?: CodeCheckInOutcome) {
  if (outcome) submitCode.mockResolvedValue(outcome);
  await render(<JoinScreen />);
  await fireEvent.changeText(await screen.findByLabelText(CODE_FIELD_LABEL), code);
  await fireEvent.press(screen.getByRole('button', { name: CHECK_ME_IN }));
}

describe('loading the event', () => {
  it('shows a spinner while the event loads', async () => {
    get.mockReturnValue(new Promise(() => {}));
    await render(<JoinScreen />);
    expect(screen.getByLabelText('Loading the event')).toBeOnTheScreen();
  });

  it('then shows the form with the event name', async () => {
    await render(<JoinScreen />);
    expect(await screen.findByRole('header', { name: 'Enter the party code.' })).toBeOnTheScreen();
    expect(screen.getByText(/card at Rooftop Sundown/)).toBeOnTheScreen();
    expect(get).toHaveBeenCalledWith('e1');
  });

  it('a load error offers Try again, which loads once more', async () => {
    get.mockResolvedValueOnce({ ok: false, message: "We couldn't load this event." });
    await render(<JoinScreen />);
    expect(await screen.findByText("We couldn't load this event.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('header', { name: 'Enter the party code.' })).toBeOnTheScreen();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('an event that doesn\'t exist shows "Event not found"', async () => {
    get.mockResolvedValue({ ok: true, event: null });
    await render(<JoinScreen />);
    expect(await screen.findByRole('header', { name: NOT_FOUND_TITLE })).toBeOnTheScreen();
  });
});

describe('entering the code', () => {
  it('an incomplete code is caught on the phone and never sent', async () => {
    await enterCode('K7M');
    expect(screen.getByText(INCOMPLETE_CODE_MESSAGE)).toBeOnTheScreen();
    expect(submitCode).not.toHaveBeenCalled();
  });

  it('sends the cleaned code (capitals, no dash)', async () => {
    await enterCode('k7m-x2q', {
      ok: true,
      result: { status: 'passed', firstAt: '2026-10-31T02:00:00Z', alreadyCheckedIn: false },
    });
    expect(submitCode).toHaveBeenCalledWith('e1', 'K7MX2Q');
    // VC-32d: a passed check-in gets the success buzz, never the warning.
    await waitFor(() => expect(tapSuccess).toHaveBeenCalledTimes(1));
    expect(tapWarning).not.toHaveBeenCalled();
  });

  it('a wrong code says how many tries are left and clears the boxes', async () => {
    await enterCode('QQ9QQ9', { ok: true, result: { status: 'wrong_code', triesLeft: 4 } });
    expect(await screen.findByText(wrongCodeMessage(4))).toBeOnTheScreen();
    expect(wrongCodeMessage(4)).toMatch(/4 tries left\.$/);
    expect(screen.getByLabelText(CODE_FIELD_LABEL).props.value).toBe('');
    // The form is still there for another try.
    expect(screen.getByRole('button', { name: CHECK_ME_IN })).toBeOnTheScreen();
    // VC-32d: the warning buzz for a wrong code, and no success buzz.
    expect(tapWarning).toHaveBeenCalledTimes(1);
    expect(tapSuccess).not.toHaveBeenCalled();
  });

  it('says "1 try left" (singular) on the last try', () => {
    expect(wrongCodeMessage(1)).toMatch(/1 try left\.$/);
  });

  it('shows "Checking..." while the server decides', async () => {
    submitCode.mockReturnValue(new Promise(() => {}));
    await enterCode('K7MX2Q');
    expect(screen.getByRole('button', { name: CHECK_ME_IN })).toBeBusy();
  });
});

describe('result screens', () => {
  it('locked: says entry is paused, with the minutes to wait, and goes back', async () => {
    await enterCode('QQ9QQ9', { ok: true, result: { status: 'locked', retryAfterMinutes: 60 } });
    expect(await screen.findByRole('header', { name: 'Code entry is locked.' })).toBeOnTheScreen();
    expect(
      screen.getByText(/5 wrong codes in the last hour.*Try again in 60 minutes/),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: CHECK_ME_IN })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Back to the event' }));
    expect(mockBack).toHaveBeenCalled();
  });

  it('too early: says when check-in opens', async () => {
    await enterCode('K7MX2Q', {
      ok: true,
      result: {
        status: 'outside_window',
        reason: 'too_early',
        opensAt: '2026-10-31T00:30:00Z',
        closesAt: '2026-10-31T07:00:00Z',
      },
    });
    expect(await screen.findByRole('header', { name: 'A little early.' })).toBeOnTheScreen();
    expect(screen.getByText(/opens at/)).toBeOnTheScreen();
  });

  it('too late: says check-in has closed', async () => {
    await enterCode('K7MX2Q', {
      ok: true,
      result: {
        status: 'outside_window',
        reason: 'too_late',
        opensAt: '2026-10-31T00:30:00Z',
        closesAt: '2026-10-31T07:00:00Z',
      },
    });
    expect(await screen.findByRole('header', { name: 'Check-in has closed.' })).toBeOnTheScreen();
  });

  it("code off: says this event doesn't use a party code", async () => {
    await enterCode('K7MX2Q', { ok: true, result: { status: 'code_off' } });
    expect(await screen.findByRole('header', { name: 'No party code.' })).toBeOnTheScreen();
    expect(screen.getByText(/Rooftop Sundown doesn't use a party code/)).toBeOnTheScreen();
  });

  it('success: "You\'re in." with CHECKED IN', async () => {
    await enterCode('K7MX2Q', {
      ok: true,
      result: { status: 'passed', firstAt: '2026-10-31T02:00:00Z', alreadyCheckedIn: false },
    });
    expect(await screen.findByRole('header', { name: "You're in." })).toBeOnTheScreen();
    expect(screen.getByText('CHECKED IN')).toBeOnTheScreen();
    expect(screen.queryByText(/K7MX2Q/)).toBeNull();
  });

  it('a network error shows a sentence and keeps the form', async () => {
    await enterCode('K7MX2Q', {
      ok: false,
      kind: 'network',
      message: "We couldn't reach the server. Check your connection and try again.",
    });
    expect(await screen.findByText(/couldn't reach the server/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: CHECK_ME_IN })).toBeOnTheScreen();
  });
});

describe('the tester button', () => {
  it('is hidden for a non-tester, even on a test event', async () => {
    get.mockResolvedValue({ ok: true, event: { ...EVENT, is_test: true } });
    await render(<JoinScreen />);
    await screen.findByRole('button', { name: CHECK_ME_IN });
    expect(screen.queryByRole('button', { name: TESTER_CHECK_IN })).toBeNull();
  });

  it('is hidden for a tester on a real event', async () => {
    auth.mockReturnValue({
      profile: { id: 'u2', display_name: 'T', role: 'user', is_tester: true },
    });
    await render(<JoinScreen />);
    await screen.findByRole('button', { name: CHECK_ME_IN });
    expect(screen.queryByRole('button', { name: TESTER_CHECK_IN })).toBeNull();
  });

  it('shows for a tester on a test event and checks them in with no code', async () => {
    auth.mockReturnValue({
      profile: { id: 'u2', display_name: 'T', role: 'user', is_tester: true },
    });
    get.mockResolvedValue({ ok: true, event: { ...EVENT, is_test: true } });
    submitTester.mockResolvedValue({
      ok: true,
      result: { status: 'passed', firstAt: '2026-10-31T02:00:00Z', alreadyCheckedIn: false },
    });
    await render(<JoinScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: TESTER_CHECK_IN }));
    await waitFor(() => expect(submitTester).toHaveBeenCalledWith('e1'));
    expect(submitCode).not.toHaveBeenCalled();
    expect(await screen.findByRole('header', { name: "You're in." })).toBeOnTheScreen();
  });
});

describe('after a code check-in (VC-B08)', () => {
  it('"Rate the night" replaces this screen with the rating screen', async () => {
    await enterCode('K7MX2Q', {
      ok: true,
      result: { status: 'passed', firstAt: '2026-10-31T02:00:00Z', alreadyCheckedIn: false },
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Rate the night' }));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/rate/[id]', params: { id: 'e1' } });
  });
});
