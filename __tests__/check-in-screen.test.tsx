/**
 * Tests for the check-in screen (app/check-in/[id].tsx) and its result
 * screens (src/lib/check-in-screens.ts), task VC-B06. VC-32d: a passed
 * check-in gives the success haptic (faked); "too far" gives none.
 *
 * The router, the event read, the location reader and the server call are
 * all fakes, so each test can choose what "happens". We check:
 *   - the "You at <event>?" sheet: name, neighbourhood, privacy note, and
 *     no address or map;
 *   - every result screen's headline and its buttons: passed, too far,
 *     weak signal, too early, too late, both limits, and "GPS check-in is
 *     off" after 5 "too far" answers (VC-36);
 *   - the permission screens: denied ("Allow location" asks again, "Not
 *     now" goes back), blocked and approximate (open Settings), location
 *     switched off; phone-side problems never call the server;
 *   - "Enter the party code" opens the party-code screen (VC-B07);
 *   - errors: a network failure offers "Try again"; an event that vanished
 *     shows "Event not found";
 *   - the reading is never shown on screen or written to the console;
 *   - Q7 (fix #7) the bottom sheet: the pin panel shows the AREA only (no
 *     address, coordinates or map, even if such data were passed in); the
 *     handle colour; the slide up, and no slide under Reduce Motion;
 *     screen readers: the sheet is a modal dialog named "Check in", focus
 *     moves to its title, and Close (and the dimmed area) go back, but not
 *     while a check-in is being sent.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, Linking, StyleSheet } from 'react-native';

import CheckInScreen, {
  CHECKED_IN_LABEL,
  CLOSE_LABEL,
  IM_HERE,
  NOT_FOUND_TITLE,
  NOT_THIS_ONE,
  PRIVACY_NOTE,
  SHEET_LABEL,
  SHEET_SLIDE_MS,
} from '../app/check-in/[id]';
import { submitCheckIn } from '@/lib/check-in-api';
import type { CheckInOutcome } from '@/lib/check-in-api';
import { readLocationForCheckIn } from '@/lib/check-in-location';
import type { ReadingOutcome } from '@/lib/check-in-location';
import { GPS_LOCKED_BODY, RATE_THE_NIGHT } from '@/lib/check-in-screens';
import { getEvent } from '@/lib/events-read';
import { tapSuccess } from '@/lib/haptics';
import type { PublicEvent } from '@/lib/tonight';
import { colors } from '@/theme';

jest.mock('@/lib/events-read', () => ({ getEvent: jest.fn() }));
jest.mock('@/lib/check-in-location', () => ({ readLocationForCheckIn: jest.fn() }));
jest.mock('@/lib/check-in-api', () => ({ submitCheckIn: jest.fn() }));
// VC-32d: fake vibrations, so tests can check WHEN each one fires.
jest.mock('@/lib/haptics', () => ({
  tapLight: jest.fn(),
  tapSuccess: jest.fn(),
  tapWarning: jest.fn(),
}));
// The "mock" prefix lets jest.mock (which runs first) use these fakes.
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
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
    // VC-32d: the phone's success buzz, once.
    expect(tapSuccess).toHaveBeenCalledTimes(1);
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
    // Not checked in, so no success buzz (VC-32d).
    expect(tapSuccess).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it('weak signal: offers the party code, which opens the party-code screen (VC-B07)', async () => {
    await checkInWith({ ok: true, result: { status: 'weak_signal' } });
    expect(await screen.findByRole('header', { name: 'Weak signal.' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Enter the party code' }));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/join/[id]', params: { id: 'e1' } });
    // Never a push: from the see-through sheet, iPhone would slide it in under the sheet (Q7).
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('"GPS not working?" on the first sheet opens the party-code screen without reading GPS', async () => {
    await render(<CheckInScreen />);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'GPS not working? Enter the party code' }),
    );
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/join/[id]', params: { id: 'e1' } });
    expect(read).not.toHaveBeenCalled();
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

  it('GPS locked (VC-36): says GPS is off for this event, offers only the party code and back', async () => {
    await checkInWith({ ok: true, result: { status: 'gps_locked' } });
    expect(await screen.findByRole('header', { name: 'GPS check-in is off.' })).toBeOnTheScreen();
    expect(screen.getByText(GPS_LOCKED_BODY)).toBeOnTheScreen();
    // No "Try again": GPS would give the same answer all night.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Enter the party code' }));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/join/[id]', params: { id: 'e1' } });
    expect(screen.getByRole('button', { name: 'Back to the event' })).toBeOnTheScreen();
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

describe('after check-in (VC-B08)', () => {
  it('"Rate the night" replaces check-in with the rating screen', async () => {
    get.mockResolvedValue({ ok: true, event: EVENT });
    read.mockResolvedValue(READING);
    submit.mockResolvedValue({
      ok: true,
      result: { status: 'passed', firstAt: '2026-10-31T02:00:00Z', alreadyCheckedIn: false },
    });
    await render(<CheckInScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: IM_HERE }));
    await fireEvent.press(await screen.findByRole('button', { name: RATE_THE_NIGHT }));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/rate/[id]', params: { id: 'e1' } });
  });
});

describe('the bottom sheet (Q7, fix #7)', () => {
  // The scrim and the pin panel are hidden from screen readers, so queries
  // must be told to look at hidden parts too.
  const HIDDEN = { includeHiddenElements: true };
  let timingSpy: jest.SpyInstance;
  let focusSpy: jest.SpyInstance;
  let motionSpy: jest.SpyInstance;

  beforeEach(() => {
    // Watch the slide without really animating, and the screen-reader focus.
    timingSpy = jest
      .spyOn(Animated, 'timing')
      .mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() });
    focusSpy = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
    motionSpy = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled');
  });

  afterEach(() => {
    timingSpy.mockRestore();
    focusSpy.mockRestore();
    motionSpy.mockRestore();
  });

  /**
   * Opens the sheet with Reduce Motion on or off and waits for the question.
   *
   * @param reduceMotion - what the phone says about Reduce Motion.
   * @param event - the event the server returns (default EVENT).
   */
  async function openSheet(reduceMotion: boolean, event: PublicEvent = EVENT) {
    motionSpy.mockResolvedValue(reduceMotion);
    get.mockResolvedValue({ ok: true, event });
    await render(<CheckInScreen />);
    await screen.findByRole('header', { name: `You at ${event.title}?` });
  }

  /** The slide-up calls made so far (the settings passed to Animated.timing). */
  function slideCalls() {
    return timingSpy.mock.calls
      .map((call) => call[1] as { toValue: number; duration: number })
      .filter((config) => config.duration === SHEET_SLIDE_MS);
  }

  /**
   * The spoken label of a view handed to sendAccessibilityEvent.
   *
   * @param node - the view (a host instance in Jest).
   * @returns its accessibilityLabel, wherever this renderer keeps it.
   */
  function labelOf(node: { props?: { accessibilityLabel?: string } } | null) {
    return node?.props?.accessibilityLabel;
  }

  it('the pin panel shows a pin only, and the sheet shows the area label only', async () => {
    // Even if the event data ever carried an address or coordinates, the
    // sheet must not show them: it only ever reads area_label.
    const leaky = {
      ...EVENT,
      address: '1300 First St SE',
      lat: 38.87654,
      lng: -77.00321,
    } as PublicEvent;
    await openSheet(true, leaky);
    const panel = screen.getByTestId('check-in-pin-panel', HIDDEN);
    // No words of any kind in the panel. It's hidden from screen readers,
    // so look at hidden parts too, or this check would pass falsely.
    expect(within(panel).queryAllByText(/./, { includeHiddenElements: true })).toHaveLength(0);
    expect(StyleSheet.flatten(panel.props.style)).toMatchObject({
      height: 150,
      backgroundColor: colors.surfaceSunken,
    });
    expect(screen.getByTestId('check-in-area')).toHaveTextContent('Navy Yard, DC', {
      exact: true,
    });
    expect(screen.queryByText(/1300|First St/, { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByText(/38\.87|77\.003/, { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByLabelText(/map/i, { includeHiddenElements: true })).toBeNull();
  });

  it('draws the handle in the handle colour', async () => {
    await openSheet(true);
    expect(StyleSheet.flatten(screen.getByTestId('check-in-handle').props.style)).toMatchObject({
      backgroundColor: colors.handle,
    });
  });

  it('slides up when motion is allowed', async () => {
    await openSheet(false);
    await waitFor(() => expect(slideCalls()).toHaveLength(1));
    expect(slideCalls()[0].toValue).toBe(0);
  });

  it('Reduce Motion: no slide, the sheet is simply in place', async () => {
    await openSheet(true);
    // Give the motion setting's answer time to arrive, then check.
    await waitFor(() =>
      expect(
        StyleSheet.flatten(screen.getByTestId('check-in-sheet').props.style).transform,
      ).toEqual([{ translateY: 0 }]),
    );
    expect(slideCalls()).toHaveLength(0);
  });

  it('is announced as a modal dialog named "Check in"', async () => {
    await openSheet(true);
    const sheet = screen.getByTestId('check-in-sheet');
    expect(sheet.props.role).toBe('dialog');
    expect(sheet.props['aria-modal']).toBe(true);
    expect(sheet.props.accessibilityViewIsModal).toBe(true);
    expect(sheet.props.accessibilityLabel).toBe(SHEET_LABEL);
    // The dimmed area behind is hidden from screen readers.
    expect(screen.getByTestId('check-in-scrim', HIDDEN).props.importantForAccessibility).toBe(
      'no-hide-descendants',
    );
  });

  it("moves the screen reader's focus to the sheet's title, then to a result's headline", async () => {
    submit.mockResolvedValue({
      ok: true,
      result: { status: 'passed', firstAt: '2026-10-31T02:00:00Z', alreadyCheckedIn: false },
    });
    await openSheet(true);
    await waitFor(() => expect(focusSpy).toHaveBeenCalled());
    const [first, kind] = focusSpy.mock.calls[0];
    expect(kind).toBe('focus');
    expect(labelOf(first)).toBe('You at Rooftop Sundown?');
    await fireEvent.press(screen.getByRole('button', { name: IM_HERE }));
    await screen.findByRole('header', { name: "You're in." });
    await waitFor(() =>
      expect(focusSpy.mock.calls.map(([node]) => labelOf(node))).toContain("You're in."),
    );
  });

  it('Close goes back to the event, and so does a tap on the dimmed page', async () => {
    await openSheet(true);
    await fireEvent.press(screen.getByRole('button', { name: CLOSE_LABEL }));
    expect(mockBack).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('check-in-scrim', HIDDEN));
    expect(mockBack).toHaveBeenCalledTimes(2);
  });

  it('Close and the dimmed page do nothing while a check-in is being sent', async () => {
    read.mockReturnValue(new Promise(() => {}));
    await openSheet(true);
    await fireEvent.press(screen.getByRole('button', { name: IM_HERE }));
    expect(screen.getByRole('button', { name: CLOSE_LABEL })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: CLOSE_LABEL }));
    await fireEvent.press(screen.getByTestId('check-in-scrim', HIDDEN));
    expect(mockBack).not.toHaveBeenCalled();
  });
});
