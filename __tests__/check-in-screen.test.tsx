/**
 * Tests for the check-in screen (app/check-in/[id].tsx) and its result
 * screens (src/lib/check-in-screens.ts), task VC-B06.
 *
 * The router, the event read, the location reader and the server call are
 * all fakes, so each test can choose what "happens". We check:
 *   - the "You at <event>?" sheet: name, neighbourhood, privacy note, and
 *     no address or map;
 *   - every result screen's headline and its buttons: passed, too far,
 *     weak signal, too early, too late, both limits;
 *   - the permission screens: denied ("Allow location" asks again, "Not
 *     now" goes back), blocked and approximate (open Settings), location
 *     switched off; phone-side problems never call the server;
 *   - "Enter the party code" opens the VC-B07 placeholder;
 *   - errors: a network failure offers "Try again"; an event that vanished
 *     shows "Event not found";
 *   - the reading is never shown on screen or written to the console.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import CheckInScreen, {
  CHECKED_IN_LABEL,
  IM_HERE,
  NOT_FOUND_TITLE,
  NOT_THIS_ONE,
  PRIVACY_NOTE,
} from '../app/check-in/[id]';
import { submitCheckIn } from '@/lib/check-in-api';
import type { CheckInOutcome } from '@/lib/check-in-api';
import { readLocationForCheckIn } from '@/lib/check-in-location';
import type { ReadingOutcome } from '@/lib/check-in-location';
import { getEvent } from '@/lib/events-read';
import type { PublicEvent } from '@/lib/tonight';

jest.mock('@/lib/events-read', () => ({ getEvent: jest.fn() }));
jest.mock('@/lib/check-in-location', () => ({ readLocationForCheckIn: jest.fn() }));
jest.mock('@/lib/check-in-api', () => ({ submitCheckIn: jest.fn() }));
// The "mock" prefix lets jest.mock (which runs first) use these fakes.
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: jest.fn(),
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({ id: 'e1' }),
}));

const get = getEvent as jest.Mock;
const read = readLocationForCheckIn as jest.Mock;
const submit = submitCheckIn as jest.Mock;

/** A party that's on now. Only public facts: no pin, no address. */
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

/** A reading with distinctive digits, so we can check they never show. */
const COORDS = { lat: 38.87654, lng: -77.00321, accuracyM: 12 };
const READING: ReadingOutcome = { kind: 'reading', reading: COORDS };

let consoleSpies: jest.SpyInstance[];
let openSettings: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  get.mockResolvedValue({ ok: true, event: EVENT });
  read.mockResolvedValue(READING);
  openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
    jest.spyOn(console, name).mockImplementation(() => {}),
  );
});

afterEach(() => {
  // Privacy: the coordinates never reach the console.
  for (const spy of consoleSpies) {
    for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toMatch(/38\.87|77\.003/);
    spy.mockRestore();
  }
  openSettings.mockRestore();
});

/**
 * Opens the screen, waits for the sheet and taps "Yep, I'm here".
 *
 * @param outcome - what the server answers (only used if a reading is taken).
 */
async function checkInWith(outcome?: CheckInOutcome) {
  if (outcome) submit.mockResolvedValue(outcome);
  await render(<CheckInScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: IM_HERE }));
}

/**
 * Says that no screen text contains the reading's numbers.
 */
function expectNoCoordinatesOnScreen() {
  expect(screen.queryByText(/38\.87|77\.003/)).toBeNull();
}

describe('the "You at <event>?" sheet', () => {
  it('asks about the event by name and area, with the privacy note, and no address or map', async () => {
    await render(<CheckInScreen />);
    expect(
      await screen.findByRole('header', { name: 'You at Rooftop Sundown?' }),
    ).toBeOnTheScreen();
    expect(get).toHaveBeenCalledWith('e1');
    expect(screen.getByText('Navy Yard, DC')).toBeOnTheScreen();
    expect(screen.getByText(PRIVACY_NOTE)).toBeOnTheScreen();
    expect(screen.queryByLabelText(/map/i)).toBeNull();
    // Nothing is read until the person taps the button.
    expect(read).not.toHaveBeenCalled();
  });

  it('"Not this one" goes back to the event', async () => {
    await render(<CheckInScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: NOT_THIS_ONE }));
    expect(mockBack).toHaveBeenCalled();
  });

  it('shows the button as busy while checking', async () => {
    read.mockReturnValue(new Promise(() => {}));
    await checkInWith();
    expect(screen.getByRole('button', { name: IM_HERE })).toBeBusy();
  });

  it('shows "Event not found" if the event is gone', async () => {
    get.mockResolvedValue({ ok: true, event: null });
    await render(<CheckInScreen />);
    expect(await screen.findByRole('header', { name: NOT_FOUND_TITLE })).toBeOnTheScreen();
  });
});

describe('result screens from the server', () => {
  it('passed: "You\'re in." and the reading went only to the server', async () => {
    await checkInWith({
      ok: true,
      result: { status: 'passed', firstAt: '2026-10-31T02:00:00Z', alreadyCheckedIn: false },
    });
    expect(await screen.findByRole('header', { name: "You're in." })).toBeOnTheScreen();
    expect(screen.getByText(CHECKED_IN_LABEL)).toBeOnTheScreen();
    expect(screen.getByText(/You're checked in to Rooftop Sundown/)).toBeOnTheScreen();
    expect(submit).toHaveBeenCalledWith('e1', COORDS);
    expectNoCoordinatesOnScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Back to the event' }));
    expect(mockBack).toHaveBeenCalled();
  });

  it('passed again: says they are still checked in', async () => {
    await checkInWith({
      ok: true,
      result: { status: 'passed', firstAt: '2026-10-31T02:00:00Z', alreadyCheckedIn: true },
    });
    expect(
      await screen.findByText("You're still checked in to Rooftop Sundown."),
    ).toBeOnTheScreen();
  });

  it('too far: a clear message, and "Try again" takes a new reading', async () => {
    await checkInWith({ ok: true, result: { status: 'too_far' } });
    expect(await screen.findByRole('header', { name: 'You seem far away.' })).toBeOnTheScreen();
    expect(screen.getByText(/outside the party area for Rooftop Sundown/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it('weak signal: offers the party code, which opens the VC-B07 placeholder', async () => {
    await checkInWith({ ok: true, result: { status: 'weak_signal' } });
    expect(await screen.findByRole('header', { name: 'Weak signal.' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Enter the party code' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/join/[id]', params: { id: 'e1' } });
  });

  it('too early: says when check-in opens, in New York time', async () => {
    await checkInWith({
      ok: true,
      result: {
        status: 'outside_window',
        reason: 'too_early',
        // 00:30 UTC on 31 Oct = 8:30 PM on 30 Oct in New York (summer time).
        opensAt: '2026-10-31T00:30:00Z',
        closesAt: '2026-10-31T07:00:00Z',
      },
    });
    expect(await screen.findByRole('header', { name: 'A little early.' })).toBeOnTheScreen();
    expect(screen.getByText(/opens at 8:30 PM/)).toBeOnTheScreen();
  });

  it('too late: says check-in has closed', async () => {
    await checkInWith({
      ok: true,
      result: {
        status: 'outside_window',
        reason: 'too_late',
        opensAt: '2026-10-31T00:30:00Z',
        closesAt: '2026-10-31T07:00:00Z',
      },
    });
    expect(await screen.findByRole('header', { name: 'Check-in has closed.' })).toBeOnTheScreen();
    expect(screen.getByText(/closed at 3 AM/)).toBeOnTheScreen();
  });

  it('20 tries an hour: says how many minutes to wait', async () => {
    await checkInWith({ ok: true, result: { status: 'too_many_attempts', retryAfterMinutes: 12 } });
    expect(await screen.findByRole('header', { name: 'Too many tries.' })).toBeOnTheScreen();
    expect(screen.getByText(/Try again in 12 minutes/)).toBeOnTheScreen();
  });

  it('8 events in 24 hours: explains the limit', async () => {
    await checkInWith({ ok: true, result: { status: 'too_many_events' } });
    expect(await screen.findByRole('header', { name: "That's a big night." })).toBeOnTheScreen();
    expect(screen.getByText(/8 events in the last 24 hours/)).toBeOnTheScreen();
  });

  it('a network failure shows the message and "Try again"', async () => {
    await checkInWith({
      ok: false,
      kind: 'network',
      message: "We couldn't reach the server. Check your connection and try again.",
    });
    expect(await screen.findByText(/couldn't reach the server/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it('an event that vanished during check-in shows "Event not found"', async () => {
    await checkInWith({ ok: false, kind: 'notFound', message: "That event doesn't exist." });
    expect(await screen.findByRole('header', { name: NOT_FOUND_TITLE })).toBeOnTheScreen();
  });
});

describe('permission and phone problems (nothing is sent to the server)', () => {
  it('denied: "Allow location" asks again; "Not now" goes back', async () => {
    read.mockResolvedValueOnce({ kind: 'denied' });
    await checkInWith();
    expect(await screen.findByRole('header', { name: 'Location needed.' })).toBeOnTheScreen();
    expect(submit).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Allow location' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it('denied: "Not now" goes back to the event', async () => {
    read.mockResolvedValue({ kind: 'denied' });
    await checkInWith();
    await fireEvent.press(await screen.findByRole('button', { name: 'Not now' }));
    expect(mockBack).toHaveBeenCalled();
  });

  it('blocked: offers Settings and the party code', async () => {
    read.mockResolvedValue({ kind: 'blocked' });
    await checkInWith();
    expect(await screen.findByRole('header', { name: 'Location is off.' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(openSettings).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Enter the party code' })).toBeOnTheScreen();
    expect(submit).not.toHaveBeenCalled();
  });

  it('approximate (Android): treated as weak, asks for precise location, never sent', async () => {
    read.mockResolvedValue({ kind: 'approximate' });
    await checkInWith();
    expect(
      await screen.findByRole('header', { name: 'Precise location is off.' }),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Enter the party code' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(openSettings).toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('location services off: says so and offers Settings', async () => {
    read.mockResolvedValue({ kind: 'servicesOff' });
    await checkInWith();
    expect(
      await screen.findByRole('header', { name: 'Location services are off.' }),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeOnTheScreen();
  });

  it('no fix (indoors, timed out): the weak-signal screen with the party code', async () => {
    read.mockResolvedValue({ kind: 'noFix' });
    await checkInWith();
    expect(await screen.findByRole('header', { name: 'Weak signal.' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Enter the party code' })).toBeOnTheScreen();
    expect(submit).not.toHaveBeenCalled();
  });
});
