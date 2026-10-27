/**
 * Tests for the rating screen (app/rate/[id].tsx), task VC-B08, with the
 * heads-up tags (VC-43).
 *
 * The router, the reads, the quiet location reader and the server calls are
 * all fakes, so each test chooses what "happens". We check:
 *   - "Drop my rating" stays off until one tap in each of the 3 rows, and a
 *     reaction and tags are optional (a reaction can be un-picked);
 *   - the taps, reaction and tags are sent; the payoff shows;
 *   - the nine tags show emoji then words; picking "Felt unsafe" shows the
 *     911 line, and un-picking it hides the line again (VC-45, VC-60);
 *   - the quiet re-check runs for GPS and party-code check-ins (VC-48),
 *     never asks for permission, and "too far" stops the rating; with no
 *     reading (location not allowed) it goes on; a tester check-in skips it;
 *   - the three rows are radio groups for screen readers (VC-49);
 *   - opening the screen: not checked in, rated less than an hour ago, and
 *     admins each get their message instead of the form;
 *   - the server's refusals (too soon, stale check-in) and a network error
 *     (taps kept, message shown);
 *   - "Check in again" replaces this screen with check-in;
 *   - the location reading is never logged.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import RateScreenRoute, { PROMPT, SAVING_LABEL, SUBMIT_LABEL } from '../app/rate/[id]';
import { FELT_UNSAFE_HELP } from '@/lib/rating';
import { useAuth } from '@/lib/auth-context';
import { submitCheckIn } from '@/lib/check-in-api';
import { readLocationQuietly } from '@/lib/check-in-location';
import { getEvent } from '@/lib/events-read';
import { getMyRatingStatus, submitRating } from '@/lib/ratings-api';
import type { PublicEvent } from '@/lib/tonight';

jest.mock('@/lib/events-read', () => ({ getEvent: jest.fn() }));
jest.mock('@/lib/ratings-api', () => ({ getMyRatingStatus: jest.fn(), submitRating: jest.fn() }));
jest.mock('@/lib/check-in-location', () => ({ readLocationQuietly: jest.fn() }));
jest.mock('@/lib/check-in-api', () => ({ submitCheckIn: jest.fn() }));
jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));
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
const myStatus = getMyRatingStatus as jest.Mock;
const rate = submitRating as jest.Mock;
const quietRead = readLocationQuietly as jest.Mock;
const checkIn = submitCheckIn as jest.Mock;

const EVENT: PublicEvent = {
  id: 'e1',
  title: 'Rooftop',
  area_label: 'Shaw, DC',
  starts_at: '2026-10-31T01:00:00Z',
  ends_at: '2026-10-31T06:00:00Z',
  source: 'host',
  ticket_url: null,
  summary: null,
  is_21_plus: false,
  is_test: false,
};
/** A reading with distinctive digits, so we can check they never leak. */
const READING = { lat: 38.91234, lng: -77.04321, accuracyM: 18 };
const SAVED = {
  ok: true,
  result: {
    status: 'saved',
    updated: false,
    nextUpdateAt: '2026-10-31T03:05:00Z',
    score: 8.3,
    raters: 5,
  },
};

/**
 * Sets what the guest's own check-in looks like.
 *
 * @param method - 'gps', 'code' or 'tester', or null for "not checked in".
 * @param ratedAt - when they last rated (ISO text), or null.
 */
function checkedInWith(method: 'gps' | 'code' | 'tester' | null, ratedAt: string | null = null) {
  myStatus.mockResolvedValue({
    ok: true,
    status: {
      checkIn: method ? { method, lastVerifiedAt: new Date().toISOString() } : null,
      ratedAt,
    },
  });
}

/** Taps one option in each of the three rows (the "3 taps"). */
async function tapThreeRows() {
  await fireEvent.press(screen.getByRole('radio', { name: 'crowd: Packed' }));
  await fireEvent.press(screen.getByRole('radio', { name: 'music: Good' }));
  await fireEvent.press(screen.getByRole('radio', { name: 'energy: Fire' }));
}

let consoleSpies: jest.SpyInstance[];

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ profile: { id: 'p1', role: 'user' } });
  get.mockResolvedValue({ ok: true, event: EVENT });
  checkedInWith('gps');
  quietRead.mockResolvedValue(READING);
  checkIn.mockResolvedValue({
    ok: true,
    result: { status: 'passed', firstAt: '2026-10-31T02:00:00Z', alreadyCheckedIn: true },
  });
  rate.mockResolvedValue(SAVED);
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
    jest.spyOn(console, name).mockImplementation(() => {}),
  );
});

afterEach(() => {
  // Privacy: nothing on this screen prints anything (it could be a position).
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

describe('RateScreen form', () => {
  it('shows the three rows, and the button switches on only after 3 taps', async () => {
    await render(<RateScreenRoute />);
    expect(await screen.findByText(PROMPT)).toBeOnTheScreen();
    expect(screen.getByText('ROOFTOP · CHECKED IN')).toBeOnTheScreen();
    const submit = screen.getByRole('button', { name: SUBMIT_LABEL });
    expect(submit).toBeDisabled();

    await fireEvent.press(screen.getByRole('radio', { name: 'crowd: Packed' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'music: Good' }));
    expect(submit).toBeDisabled();
    await fireEvent.press(screen.getByRole('radio', { name: 'energy: Fire' }));
    expect(screen.getByRole('button', { name: SUBMIT_LABEL })).toBeEnabled();
    // Picked chips are marked "selected" (not by colour alone).
    expect(screen.getByRole('radio', { name: 'crowd: Packed' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'crowd: Quiet' })).not.toBeChecked();
  });

  it('sends the taps, the reaction and the tags, then shows the payoff', async () => {
    await render(<RateScreenRoute />);
    await screen.findByText(PROMPT);
    await tapThreeRows();
    // Pick "Dancing", then switch to "Fire"; pick two heads-ups.
    await fireEvent.press(screen.getByRole('button', { name: 'Reaction: Dancing' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Reaction: Fire' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Heads-up: Long line' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Heads-up: Parking is rough' }));
    await fireEvent.press(screen.getByRole('button', { name: SUBMIT_LABEL }));

    expect(rate).toHaveBeenCalledWith('e1', {
      crowd: 3,
      music: 2,
      energy: 3,
      reaction: 'fire',
      tags: ['lines_long', 'parking_rough'],
    });
    expect(
      await screen.findByText(
        'You and 4 others have rated Rooftop. Your vibe: Hot (8.3). You can update it after 11:05 PM.',
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(mockBack).toHaveBeenCalled();
  });

  it('a reaction can be un-picked by tapping it again (it is optional)', async () => {
    await render(<RateScreenRoute />);
    await screen.findByText(PROMPT);
    await tapThreeRows();
    await fireEvent.press(screen.getByRole('button', { name: 'Reaction: Chill' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Reaction: Chill' }));
    await fireEvent.press(screen.getByRole('button', { name: SUBMIT_LABEL }));
    expect(rate).toHaveBeenCalledWith('e1', expect.objectContaining({ reaction: null, tags: [] }));
  });

  it('shows the nine tags with emoji, and the 911 line while "Felt unsafe" is picked', async () => {
    await render(<RateScreenRoute />);
    await screen.findByText(PROMPT);
    // Emoji then words; no retired tag is offered.
    expect(screen.getByText('⏳ Long line')).toBeOnTheScreen();
    expect(screen.getByText('🅿️ Parking is rough')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Heads-up: Packed' })).toBeNull();
    expect(screen.queryByText(FELT_UNSAFE_HELP)).toBeNull();
    const unsafe = screen.getByRole('button', { name: 'Heads-up: Felt unsafe' });
    await fireEvent.press(unsafe);
    expect(screen.getByText(FELT_UNSAFE_HELP)).toBeOnTheScreen();
    // An alert, so VoiceOver reads it as soon as it appears (cto review).
    expect(screen.getByRole('alert')).toHaveTextContent(FELT_UNSAFE_HELP);
    await fireEvent.press(unsafe);
    expect(screen.queryByText(FELT_UNSAFE_HELP)).toBeNull();
  });

  it('shows "Saving..." while the save runs', async () => {
    rate.mockReturnValue(new Promise(() => {}));
    await render(<RateScreenRoute />);
    await screen.findByText(PROMPT);
    await tapThreeRows();
    await fireEvent.press(screen.getByRole('button', { name: SUBMIT_LABEL }));
    expect(await screen.findByText(SAVING_LABEL)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: SUBMIT_LABEL })).toBeBusy();
  });
});

describe('RateScreen quiet re-check', () => {
  it('for a GPS check-in, sends one quiet reading to check_in before rating', async () => {
    await render(<RateScreenRoute />);
    await screen.findByText(PROMPT);
    await tapThreeRows();
    await fireEvent.press(screen.getByRole('button', { name: SUBMIT_LABEL }));
    await screen.findByText(/Vibe/);
    expect(quietRead).toHaveBeenCalledTimes(1);
    expect(checkIn).toHaveBeenCalledWith('e1', READING);
    expect(rate).toHaveBeenCalled();
    // The reading is never shown.
    expect(screen.queryByText(/38\.91234|77\.04321/)).toBeNull();
  });

  it('"too far" stops the rating and says so', async () => {
    checkIn.mockResolvedValue({ ok: true, result: { status: 'too_far' } });
    await render(<RateScreenRoute />);
    await screen.findByText(PROMPT);
    await tapThreeRows();
    await fireEvent.press(screen.getByRole('button', { name: SUBMIT_LABEL }));
    expect(await screen.findByText(/outside the party area for Rooftop/)).toBeOnTheScreen();
    expect(rate).not.toHaveBeenCalled();
  });

  it('no reading (permission not given) or a weak signal still goes on to the server', async () => {
    quietRead.mockResolvedValueOnce(null);
    await render(<RateScreenRoute />);
    await screen.findByText(PROMPT);
    await tapThreeRows();
    await fireEvent.press(screen.getByRole('button', { name: SUBMIT_LABEL }));
    await screen.findByText(/Vibe/);
    expect(checkIn).not.toHaveBeenCalled();
    expect(rate).toHaveBeenCalledTimes(1);
  });

  it('a party-code check-in gets the quiet check too (VC-48)', async () => {
    checkedInWith('code');
    await render(<RateScreenRoute />);
    await screen.findByText(PROMPT);
    await tapThreeRows();
    await fireEvent.press(screen.getByRole('button', { name: SUBMIT_LABEL }));
    await screen.findByText(/Vibe/);
    expect(quietRead).toHaveBeenCalledTimes(1);
    expect(checkIn).toHaveBeenCalledWith('e1', READING);
    expect(rate).toHaveBeenCalledTimes(1);
  });

  it('a party-code guest who is too far is stopped (VC-48)', async () => {
    checkedInWith('code');
    checkIn.mockResolvedValue({ ok: true, result: { status: 'too_far' } });
    await render(<RateScreenRoute />);
    await screen.findByText(PROMPT);
    await tapThreeRows();
    await fireEvent.press(screen.getByRole('button', { name: SUBMIT_LABEL }));
    expect(await screen.findByText(/outside the party area for Rooftop/)).toBeOnTheScreen();
    expect(rate).not.toHaveBeenCalled();
  });

  it('a party-code guest whose GPS is locked (5 too-far answers) is stopped too', async () => {
    checkedInWith('code');
    // After 5 "too far" answers the server says gps_locked instead. That must
    // not let a guest at home through on the 6th try.
    checkIn.mockResolvedValue({ ok: true, result: { status: 'gps_locked' } });
    await render(<RateScreenRoute />);
    await screen.findByText(PROMPT);
    await tapThreeRows();
    await fireEvent.press(screen.getByRole('button', { name: SUBMIT_LABEL }));
    expect(await screen.findByText(/outside the party area for Rooftop/)).toBeOnTheScreen();
    expect(rate).not.toHaveBeenCalled();
  });

  it('a party-code guest without location permission rates as before (never asked)', async () => {
    checkedInWith('code');
    // The quiet reader returns null when permission isn't already granted;
    // it never shows the phone's question (src/lib/check-in-location.ts).
    quietRead.mockResolvedValueOnce(null);
    await render(<RateScreenRoute />);
    await screen.findByText(PROMPT);
    await tapThreeRows();
    await fireEvent.press(screen.getByRole('button', { name: SUBMIT_LABEL }));
    await screen.findByText(/Vibe/);
    expect(checkIn).not.toHaveBeenCalled();
    expect(rate).toHaveBeenCalledTimes(1);
  });

  it('a tester check-in skips the GPS re-check', async () => {
    checkedInWith('tester');
    await render(<RateScreenRoute />);
    await screen.findByText(PROMPT);
    await tapThreeRows();
    await fireEvent.press(screen.getByRole('button', { name: SUBMIT_LABEL }));
    await screen.findByText(/Vibe/);
    expect(quietRead).not.toHaveBeenCalled();
    expect(checkIn).not.toHaveBeenCalled();
    expect(rate).toHaveBeenCalledTimes(1);
  });
});

describe('RateScreen accessibility (VC-49)', () => {
  it('each rating row is a radio group of radio buttons, with the pick "checked"', async () => {
    await render(<RateScreenRoute />);
    await screen.findByText(PROMPT);
    // One radio group per row, named after the row. (getByRole only finds
    // "accessible" elements, and the group must NOT be one, or its chips
    // couldn't be reached one by one; so look it up by its label.)
    for (const row of ['crowd', 'music', 'energy']) {
      expect(screen.getByLabelText(row).props.accessibilityRole).toBe('radiogroup');
    }
    // Three choices per row are radios, not buttons.
    expect(screen.getAllByRole('radio')).toHaveLength(9);
    expect(screen.queryByRole('button', { name: 'crowd: Packed' })).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'crowd: Packed' }));
    expect(screen.getByRole('radio', { name: 'crowd: Packed', checked: true })).toBeOnTheScreen();
    // The optional reaction and tags stay on/off buttons.
    expect(screen.getByRole('button', { name: 'Reaction: Fire' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Heads-up: Long line' })).toBeOnTheScreen();
  });
});

describe('RateScreen on opening', () => {
  it('not checked in: "Check in first", and "I\'m here" replaces this screen with check-in', async () => {
    checkedInWith(null);
    await render(<RateScreenRoute />);
    expect(await screen.findByText(/Only guests who are at Rooftop can rate it/)).toBeOnTheScreen();
    expect(screen.queryByText(PROMPT)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: "I'm here" }));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/check-in/[id]', params: { id: 'e1' } });
  });

  it('rated 20 minutes ago: says when they can update, without the form', async () => {
    checkedInWith('gps', new Date(Date.now() - 20 * 60_000).toISOString());
    await render(<RateScreenRoute />);
    expect(await screen.findByText(/update your rating in 40 minutes/)).toBeOnTheScreen();
    expect(screen.queryByText(PROMPT)).toBeNull();
  });

  it('rated over an hour ago: the form shows, to update', async () => {
    checkedInWith('gps', new Date(Date.now() - 61 * 60_000).toISOString());
    await render(<RateScreenRoute />);
    expect(await screen.findByText(PROMPT)).toBeOnTheScreen();
  });

  it('admins get the staff message, never the form', async () => {
    (useAuth as jest.Mock).mockReturnValue({ profile: { id: 'p1', role: 'admin' } });
    await render(<RateScreenRoute />);
    expect(await screen.findByText(/admins can't rate events/)).toBeOnTheScreen();
    expect(screen.queryByText(PROMPT)).toBeNull();
  });

  it('a load error offers Try again', async () => {
    myStatus.mockResolvedValueOnce({ ok: false, kind: 'network', message: 'No connection.' });
    await render(<RateScreenRoute />);
    expect(await screen.findByText('No connection.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(PROMPT)).toBeOnTheScreen();
  });
});

describe('RateScreen server answers', () => {
  it('too soon: minutes left', async () => {
    rate.mockResolvedValue({
      ok: true,
      result: { status: 'too_soon', minutesLeft: 1, nextUpdateAt: '2026-10-31T03:05:00Z' },
    });
    await render(<RateScreenRoute />);
    await screen.findByText(PROMPT);
    await tapThreeRows();
    await fireEvent.press(screen.getByRole('button', { name: SUBMIT_LABEL }));
    expect(
      await screen.findByText(/update your rating in 1 minute \(after 11:05 PM\)/),
    ).toBeOnTheScreen();
  });

  it('stale check-in: "Check in again" replaces this screen with check-in', async () => {
    rate.mockResolvedValue({ ok: true, result: { status: 'check_in_stale' } });
    await render(<RateScreenRoute />);
    await screen.findByText(PROMPT);
    await tapThreeRows();
    await fireEvent.press(screen.getByRole('button', { name: SUBMIT_LABEL }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Check in again' }));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/check-in/[id]', params: { id: 'e1' } });
  });

  it('a network error keeps the taps and shows the message', async () => {
    rate.mockResolvedValueOnce({ ok: false, kind: 'network', message: 'No connection.' });
    await render(<RateScreenRoute />);
    await screen.findByText(PROMPT);
    await tapThreeRows();
    await fireEvent.press(screen.getByRole('button', { name: SUBMIT_LABEL }));
    expect(await screen.findByText('No connection.')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'crowd: Packed' })).toBeChecked();
    // Trying again works with the same taps.
    await fireEvent.press(screen.getByRole('button', { name: SUBMIT_LABEL }));
    expect(await screen.findByText(/Vibe/)).toBeOnTheScreen();
    expect(rate).toHaveBeenCalledTimes(2);
  });

  it("the server's staff refusal shows the staff message", async () => {
    rate.mockResolvedValue({ ok: false, kind: 'staff', message: 'x' });
    await render(<RateScreenRoute />);
    await screen.findByText(PROMPT);
    await tapThreeRows();
    await fireEvent.press(screen.getByRole('button', { name: SUBMIT_LABEL }));
    expect(await screen.findByText(/admins can't rate events/)).toBeOnTheScreen();
  });
});
