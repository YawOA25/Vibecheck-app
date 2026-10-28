/**
 * Tests for the home screen (app/(tabs)/index.tsx), tasks VC-B03c, VC-B04,
 * VC-B05, the week view VC-61 and the Q4 header clean-up.
 *
 * React Native Testing Library draws the screen in memory (no phone needed)
 * and lets us look for text the way a user would see it. The sign-in state,
 * the router and the event list read are replaced with fakes. We check:
 *   - the header: "SATURDAY TO FRIDAY" line, "This week" heading, and no
 *     buttons (Q4: they moved to the tab bar, Admin hub and Settings);
 *   - the loading state while the list is on its way;
 *   - the error state, and that "Try again" loads again;
 *   - the empty state when there are no events;
 *   - the list: one section per night (Tonight, Tomorrow, weekday names),
 *     area and time, the "Staff pick" tag, and that a card opens the event
 *     page;
 *   - VC-61: cards for events that haven't started show no vibe and no
 *     headcount (even if the server sent some), the vibes call only asks
 *     about started events (no call at all when none has started), and an
 *     event that starts while the list is open gets its vibe at the next
 *     minute's refresh;
 *   - VC-B09 + VC-42: each card's vibe (live score and word, stale, Early
 *     with "3 so far", No vibe yet) and the "74 here" headcount, asked for
 *     in one call with the ids on screen; no badge if the vibes fail;
 *   - pull to refresh keeps the old list if the refresh fails;
 *   - VC-63 date filter: the four radio chips, each filter's load, title
 *     and empty state, the "Show this week" way back, the date boxes and
 *     wheel labels, and that refresh and the vibes call follow the filter;
 *   - VC-66 paging: no "Load more events" without more; the button and
 *     scrolling to the end load the next page after the last card with the
 *     first page's window and filter, the vibes call covers the new started
 *     cards, a failure is shown with the button kept, and a page answer for
 *     an old filter, or for the list before a refresh landed, is dropped;
 *   - the developer-only "send a Sentry test error" long-press (VC-26).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Alert, Platform } from 'react-native';

import HomeScreen, {
  EMPTY_BODY,
  EMPTY_TITLE,
  LIST_TITLE,
  LOAD_MORE_LABEL,
  SHOW_WEEK_LABEL,
} from '../app/(tabs)/index';
import { ONE_NIGHT, RANGE_NOTE } from '@/components/CustomDatesPicker';
import { TEST_LABEL } from '@/components/EventCard';
import { useAuth } from '@/lib/auth-context';
import { noteCreatedEvent, takeCreatedEvent } from '@/lib/created-event';
import { listHomeEvents } from '@/lib/events-read';
import { sendTestError } from '@/lib/sentry';
import { groupByDay } from '@/lib/tonight';
import type { PublicEvent } from '@/lib/tonight';
import { LIST_VIBE_REFRESH_MS } from '@/lib/vibe';
import type { Vibe } from '@/lib/vibe';
import { getEventsVibe } from '@/lib/vibe-api';

jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/events-read', () => ({ listHomeEvents: jest.fn() }));
jest.mock('@/lib/sentry', () => ({ sendTestError: jest.fn(() => true) }));
// The "mock" prefix lets jest.mock (which runs first) use this fake.
const mockPush = jest.fn();
const mockScrollToTop = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  // Q4: the list scrolls to the top when its tab is tapped again.
  useScrollToTop: (ref: unknown) => mockScrollToTop(ref),
  // Outside a real navigator the screen is "in view" once: run the effect
  // like a normal useEffect. (require inside: jest.mock can't use outer imports.)
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('@/lib/vibe-api', () => ({ getEventsVibe: jest.fn() }));
const vibesFor = getEventsVibe as jest.Mock;

/**
 * Makes a vibe for the fake server answer.
 *
 * @param overrides - fields to change from an "early, 3 raters" vibe.
 * @returns a Vibe.
 */
function makeVibe(overrides: Partial<Vibe> = {}): Vibe {
  return {
    state: 'early',
    raters: 3,
    here: 0,
    score: null,
    label: null,
    nightAverage: null,
    minutesSinceLast: 2,
    reactions: [],
    breakdown: null,
    night: null,
    ...overrides,
  };
}

const signOut = jest.fn();
const list = listHomeEvents as jest.Mock;

const HOUR = 60 * 60 * 1000;

/**
 * Makes a test event starting `startsInHours` from now and lasting 4 hours.
 *
 * @param overrides - fields to change from the defaults.
 * @param startsInHours - hours from now to the start (can be negative).
 * @returns a PublicEvent.
 */
function makeEvent(overrides: Partial<PublicEvent>, startsInHours = 1): PublicEvent {
  const starts = new Date(Date.now() + startsInHours * HOUR);
  return {
    id: 'e1',
    title: 'Saturday rooftop',
    area_label: 'Shaw, DC',
    starts_at: starts.toISOString(),
    ends_at: new Date(starts.getTime() + 4 * HOUR).toISOString(),
    source: 'host',
    ticket_url: null,
    summary: null,
    is_21_plus: false,
    is_test: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Start each test with no leftover "new event" note (VC-63b).
  takeCreatedEvent();
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'user-1', display_name: 'Ava', role: 'user', is_tester: false },
    signOut,
  });
  list.mockResolvedValue({ ok: true, events: [] });
  // By default the vibes call answers with nothing (cards show no badge).
  vibesFor.mockResolvedValue({ ok: true, vibes: {} });
});

describe('HomeScreen header', () => {
  it('shows the nights covered and the This week heading', async () => {
    await render(<HomeScreen />);
    // For example "SATURDAY TO FRIDAY".
    expect(screen.getByText(/^[A-Z]+DAY TO [A-Z]+DAY$/)).toBeOnTheScreen();
    // getByRole finds the heading the same way a screen reader would.
    expect(screen.getByRole('header', { name: LIST_TITLE })).toBeOnTheScreen();
  });

  // Q4 "launch look": Me, New event, Reports and Sign out moved to the tab
  // bar, the Admin hub and Settings, so the header has no buttons at all,
  // even for an admin.
  it('shows no header pills, even to an admin (Q4)', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'admin-1', display_name: 'Yaw', role: 'admin', is_tester: false },
      signOut,
    });
    await render(<HomeScreen />);
    for (const name of ['New event', 'Reports', 'Sign out', 'Me', 'Me, your nights out']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('lets a tap on the open Tonight tab scroll the list to the top', async () => {
    await render(<HomeScreen />);
    // useScrollToTop is handed the list, which it scrolls on a tab tap.
    expect(mockScrollToTop).toHaveBeenCalledWith(
      expect.objectContaining({ current: expect.anything() }),
    );
  });
});

describe('HomeScreen Sentry test error (developers only, VC-26)', () => {
  // __DEV__ is a global React Native sets; we switch it per test and put it back.
  const realDev = (globalThis as any).__DEV__;
  afterEach(() => {
    (globalThis as any).__DEV__ = realDev;
  });

  it('sends a test error on a long-press of the title in development', async () => {
    (globalThis as any).__DEV__ = true;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<HomeScreen />);
    await fireEvent(screen.getByRole('header', { name: LIST_TITLE }), 'longPress');
    expect(sendTestError).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('Test error sent', expect.any(String));
  });

  it('does nothing on a long-press in a store build', async () => {
    (globalThis as any).__DEV__ = false;
    await render(<HomeScreen />);
    // In a store build the title has no long-press handler at all.
    expect(screen.getByRole('header', { name: LIST_TITLE }).props.onLongPress).toBeUndefined();
    expect(sendTestError).not.toHaveBeenCalled();
  });
});

describe('HomeScreen list states', () => {
  it('shows a loading state while the list is on its way', async () => {
    // A promise that never settles keeps the screen loading.
    list.mockReturnValue(new Promise(() => {}));
    await render(<HomeScreen />);
    expect(screen.getByLabelText('Loading events')).toBeOnTheScreen();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
  });

  it('shows an error with Try again, which loads again', async () => {
    list.mockResolvedValueOnce({
      ok: false,
      message: "We couldn't load events. Please try again.",
    });
    await render(<HomeScreen />);
    expect(await screen.findByText("We couldn't load events. Please try again.")).toBeOnTheScreen();

    // The second try works and finds nothing: the empty state shows.
    list.mockResolvedValueOnce({ ok: true, events: [] });
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(EMPTY_TITLE)).toBeOnTheScreen();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state when there are no events', async () => {
    await render(<HomeScreen />);
    expect(await screen.findByRole('header', { name: EMPTY_TITLE })).toBeOnTheScreen();
    expect(screen.getByText(EMPTY_BODY)).toBeOnTheScreen();
  });
});

describe('HomeScreen events', () => {
  it('lists events with area, time and the Early vibe chip, and opens one on tap', async () => {
    // Started an hour ago, so its vibe shows (VC-61).
    list.mockResolvedValue({ ok: true, events: [makeEvent({}, -1)] });
    vibesFor.mockResolvedValue({ ok: true, vibes: { e1: makeVibe() } });
    await render(<HomeScreen />);

    expect(await screen.findByText('Saturday rooftop')).toBeOnTheScreen();
    // "Shaw, DC · On now · until 2 AM": area first, then when.
    expect(screen.getByText(/^Shaw, DC · On now · until /)).toBeOnTheScreen();
    expect(await screen.findByText('Early')).toBeOnTheScreen();
    expect(screen.getByText('3 so far')).toBeOnTheScreen();
    expect(screen.queryByText('Staff pick')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: /^Saturday rooftop, / }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/event/[id]', params: { id: 'e1' } });
  });

  it('marks staff picks and 21+ events', async () => {
    list.mockResolvedValue({
      ok: true,
      events: [makeEvent({ source: 'staff_pick', is_21_plus: true })],
    });
    await render(<HomeScreen />);
    expect(await screen.findByText('Staff pick')).toBeOnTheScreen();
    expect(screen.getByText('21+')).toBeOnTheScreen();
  });

  it('puts a running event under Tonight with "On now"', async () => {
    list.mockResolvedValue({ ok: true, events: [makeEvent({}, -1)] });
    await render(<HomeScreen />);
    expect(await screen.findByText('TONIGHT')).toBeOnTheScreen();
    expect(screen.getByText(/On now · until /)).toBeOnTheScreen();
  });

  it('keeps the old list and shows a message if a pull-to-refresh fails', async () => {
    list.mockResolvedValueOnce({ ok: true, events: [makeEvent({})] });
    await render(<HomeScreen />);
    await screen.findByText('Saturday rooftop');

    list.mockResolvedValueOnce({
      ok: false,
      message: "We couldn't reach the server. Check your connection and try again.",
    });
    // Pulling down calls the list's RefreshControl `onRefresh`.
    const scroll = screen.getByTestId('tonight-list');
    await act(async () => {
      await scroll.props.refreshControl.props.onRefresh();
    });

    expect(
      screen.getByText("We couldn't reach the server. Check your connection and try again."),
    ).toBeOnTheScreen();
    expect(screen.getByText('Saturday rooftop')).toBeOnTheScreen();
  });
});

describe('HomeScreen vibes (VC-B09, VC-42)', () => {
  it('asks for all the vibes in one call with the ids on screen', async () => {
    list.mockResolvedValue({
      ok: true,
      events: [makeEvent({ id: 'e1' }, -1), makeEvent({ id: 'e2', title: 'Basement' }, -2)],
    });
    await render(<HomeScreen />);
    await screen.findByText('Basement');
    expect(vibesFor).toHaveBeenCalledTimes(1);
    expect(vibesFor).toHaveBeenCalledWith(['e1', 'e2']);
  });

  it('shows a live score with its word, the headcount, and says both aloud', async () => {
    list.mockResolvedValue({ ok: true, events: [makeEvent({}, -1)] });
    vibesFor.mockResolvedValue({
      ok: true,
      vibes: { e1: makeVibe({ state: 'live', raters: 6, here: 74, score: 9.1, label: 'Fire' }) },
    });
    await render(<HomeScreen />);

    expect(await screen.findByText('9.1')).toBeOnTheScreen();
    expect(screen.getByText('Fire')).toBeOnTheScreen();
    expect(screen.getByText(/^Shaw, DC · .+ · 74 here$/)).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: /74 here, vibe 9\.1 out of 10, Fire$/ }),
    ).toBeOnTheScreen();
  });

  it('shows a stale score as "quiet", and "No vibe yet" for an unrated event', async () => {
    list.mockResolvedValue({
      ok: true,
      events: [makeEvent({ id: 'e1' }, -1), makeEvent({ id: 'e2', title: 'Basement' }, -1)],
    });
    vibesFor.mockResolvedValue({
      ok: true,
      vibes: {
        e1: makeVibe({
          state: 'stale',
          raters: 5,
          score: 6.2,
          label: 'Good',
          minutesSinceLast: 130,
        }),
        e2: makeVibe({ state: 'none', raters: 0, minutesSinceLast: null }),
      },
    });
    await render(<HomeScreen />);

    expect(await screen.findByText('6.2')).toBeOnTheScreen();
    expect(screen.getByText('quiet')).toBeOnTheScreen();
    expect(screen.getByText('No vibe yet')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: /vibe quiet for 2 hrs, last 6\.2, Good$/ }),
    ).toBeOnTheScreen();
  });

  it('shows no vibe badge (and no number) if the vibes fail to load', async () => {
    list.mockResolvedValue({ ok: true, events: [makeEvent({}, -1)] });
    vibesFor.mockResolvedValue({ ok: false, message: "We couldn't load the vibe." });
    await render(<HomeScreen />);

    await screen.findByText('Saturday rooftop');
    expect(screen.queryByText('Early')).toBeNull();
    expect(screen.queryByText('No vibe yet')).toBeNull();
    // A list error is never shown for the vibes; the list itself is fine.
    expect(screen.queryByText("We couldn't load the vibe.")).toBeNull();
  });
});

describe('HomeScreen week view (VC-61)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows one heading per night, in order', async () => {
    // Tonight (running), and events about 1 and 4 days away. (Three nights
    // only: the list draws its first ~10 rows at once and the rest on scroll.)
    const events = [
      makeEvent({ id: 'a', title: 'Running now' }, -1),
      makeEvent({ id: 'b', title: 'Next night' }, 24),
      makeEvent({ id: 'c', title: 'Later on' }, 96),
    ];
    list.mockResolvedValue({ ok: true, events });
    await render(<HomeScreen />);
    await screen.findByText('Later on');

    // The section logic itself (5 AM edges, daylight saving) is tested in
    // tonight.test.ts; here we check the screen draws each heading.
    const titles = groupByDay(events, new Date()).map((s) => s.title.toUpperCase());
    expect(titles[0]).toBe('TONIGHT');
    expect(titles.length).toBeGreaterThanOrEqual(3);
    for (const title of titles) expect(screen.getByText(title)).toBeOnTheScreen();
  });

  it('asks only about started events, and shows nothing for the others even if sent', async () => {
    list.mockResolvedValue({
      ok: true,
      events: [makeEvent({ id: 'e1' }, -1), makeEvent({ id: 'e2', title: 'Later party' }, 2)],
    });
    // A server that (wrongly) answers for the not-started event too.
    vibesFor.mockResolvedValue({
      ok: true,
      vibes: {
        e1: makeVibe({ state: 'live', raters: 6, here: 74, score: 9.1, label: 'Fire' }),
        e2: makeVibe({ state: 'live', raters: 8, here: 40, score: 7.5, label: 'Hot' }),
      },
    });
    await render(<HomeScreen />);

    expect(await screen.findByText('9.1')).toBeOnTheScreen();
    expect(vibesFor).toHaveBeenCalledTimes(1);
    expect(vibesFor).toHaveBeenCalledWith(['e1']);
    // Nothing of e2's vibe or headcount anywhere, seen or spoken.
    expect(screen.queryByText('7.5')).toBeNull();
    expect(screen.queryByText('Hot')).toBeNull();
    expect(screen.queryByText(/40 here/)).toBeNull();
    const later = screen.getByRole('button', { name: /^Later party, / });
    expect(later.props.accessibilityLabel).not.toMatch(/vibe|here/);
  });

  it('makes no vibes call at all when nothing has started', async () => {
    list.mockResolvedValue({ ok: true, events: [makeEvent({}, 2)] });
    await render(<HomeScreen />);
    await screen.findByText('Saturday rooftop');
    expect(vibesFor).not.toHaveBeenCalled();
    expect(screen.queryByText('No vibe yet')).toBeNull();
  });

  it('shows the vibe at the next minute refresh once the event starts', async () => {
    // Fake clock: we move time forward instead of waiting a real minute.
    jest.useFakeTimers();
    list.mockResolvedValue({ ok: true, events: [makeEvent({}, 0.25)] }); // starts in 15 min
    vibesFor.mockResolvedValue({
      ok: true,
      vibes: { e1: makeVibe({ state: 'live', raters: 6, here: 12, score: 8.4, label: 'Hot' }) },
    });
    await render(<HomeScreen />);
    await screen.findByText('Saturday rooftop');
    expect(vibesFor).not.toHaveBeenCalled();

    // 16 minutes later the event has started; the next refresh asks for it.
    await act(async () => {
      jest.advanceTimersByTime(16 * LIST_VIBE_REFRESH_MS);
    });
    expect(vibesFor).toHaveBeenCalledWith(['e1']);
    expect(await screen.findByText('8.4')).toBeOnTheScreen();
    expect(screen.getByText(/· 12 here$/)).toBeOnTheScreen();
  });
});

describe('HomeScreen date filter (VC-63)', () => {
  /** The filter the list was last loaded with. */
  const lastFilter = () => list.mock.calls[list.mock.calls.length - 1][1];

  it('shows Tonight, This weekend, This week, Custom as radio chips, This week picked', async () => {
    await render(<HomeScreen />);
    expect(screen.getByLabelText('Dates')).toBeOnTheScreen();
    const names = screen.getAllByRole('radio').map((chip) => chip.props.accessibilityLabel);
    expect(names).toEqual(['Tonight', 'This weekend', 'This week', 'Custom']);
    expect(screen.queryByRole('radio', { name: 'Pick a date' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'This week' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Tonight' })).not.toBeChecked();
    expect(lastFilter()).toEqual({ kind: 'week' });
  });

  it('Tonight: loads tonight only, with its own title and empty state', async () => {
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Tonight' }));
    expect(lastFilter()).toEqual({ kind: 'tonight' });
    expect(screen.getByRole('header', { name: 'Tonight' })).toBeOnTheScreen();
    expect(await screen.findByText('Nothing on tonight yet')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: SHOW_WEEK_LABEL })).toBeOnTheScreen();
  });

  it('This weekend: loads the weekend, has its own empty state and a way back', async () => {
    await render(<HomeScreen />);
    await screen.findByText(EMPTY_TITLE);

    await fireEvent.press(screen.getByRole('radio', { name: 'This weekend' }));
    expect(lastFilter()).toEqual({ kind: 'weekend' });
    expect(screen.getByRole('header', { name: 'This weekend' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'This weekend' })).toBeChecked();
    expect(await screen.findByText('Nothing on this weekend yet')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: SHOW_WEEK_LABEL }));
    expect(lastFilter()).toEqual({ kind: 'week' });
    expect(await screen.findByText(EMPTY_TITLE)).toBeOnTheScreen();
    // "This week" needs no way back to itself.
    expect(screen.queryByRole('button', { name: SHOW_WEEK_LABEL })).toBeNull();
  });

  it('pull to refresh and the vibes call follow the filter', async () => {
    await render(<HomeScreen />);
    list.mockResolvedValue({ ok: true, events: [makeEvent({ id: 'e9' }, -1)] });
    await fireEvent.press(screen.getByRole('radio', { name: 'This weekend' }));
    await screen.findByText('Saturday rooftop');
    expect(vibesFor).toHaveBeenLastCalledWith(['e9']);

    const scroll = screen.getByTestId('tonight-list');
    await act(async () => {
      await scroll.props.refreshControl.props.onRefresh();
    });
    expect(lastFilter()).toEqual({ kind: 'weekend' });
  });
});

describe('HomeScreen Custom dates (VC-63 revised, picker bug fix)', () => {
  /** The filter the list was last loaded with. */
  const lastFilter = () => list.mock.calls[list.mock.calls.length - 1][1];
  /** A moment some days from now (the picker hands back moments). */
  const daysAhead = (days: number) => new Date(Date.now() + days * 24 * HOUR);
  /** "Nov 6 – Nov 9" style words. */
  const RANGE_WORDS = /^[A-Z][a-z]{2} \d+ – [A-Z][a-z]{2} \d+$/;
  /** "Sat, Nov 21" style words. */
  const ONE_DATE_WORDS = /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d+$/;

  it('iPhone: a sheet with an inline calendar; nothing changes until Done', async () => {
    await render(<HomeScreen />);
    // No picker anywhere before Custom is tapped.
    expect(screen.queryByTestId('custom-picker')).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'Custom' }));

    expect(screen.getByRole('header', { name: 'Choose dates' })).toBeOnTheScreen();
    const picker = screen.getByTestId('custom-picker');
    // Compact calendar in a sheet, never the old wheel left in the list.
    expect(picker.props.display).toBe('inline');
    expect(picker.props.timeZoneName).toBe('America/New_York');
    expect(screen.getByText(RANGE_NOTE)).toBeOnTheScreen();
    // The list hasn't changed yet: still This week.
    expect(lastFilter()).toEqual({ kind: 'week' });
    expect(screen.getByRole('radio', { name: 'This week' })).toBeChecked();
  });

  it('iPhone: start then end date, Done closes the picker and shows a tappable summary', async () => {
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Custom' }));

    // Pick the start: the sheet moves straight on to the (optional) end.
    await fireEvent(screen.getByTestId('custom-picker'), 'valueChange', {}, daysAhead(20));
    const endBox = screen.getByRole('button', { name: 'End (optional)' });
    expect(endBox.props.accessibilityState.selected).toBe(true);
    expect(endBox.props.accessibilityValue.text).toBe(ONE_NIGHT);
    // The end can't be before the start.
    const startMoment = screen.getByTestId('custom-picker').props.minimumDate as Date;
    expect(startMoment.getTime()).toBeGreaterThan(daysAhead(19).getTime());

    // Pick the end (3 nights later), then Done.
    await fireEvent(screen.getByTestId('custom-picker'), 'valueChange', {}, daysAhead(23));
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));

    // The picker is gone: closed, not sitting in the list.
    expect(screen.queryByTestId('custom-picker')).toBeNull();
    expect(screen.queryByRole('header', { name: 'Choose dates' })).toBeNull();
    const picked = lastFilter();
    expect(picked.kind).toBe('custom');
    expect(screen.getByRole('radio', { name: 'Custom' })).toBeChecked();
    expect(screen.getByText('4 NIGHTS')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: RANGE_WORDS })).toBeOnTheScreen();

    // The summary text reopens the picker, starting on the chosen dates.
    const summary = screen.getByRole('button', { name: 'Custom dates' });
    expect(summary.props.accessibilityValue.text).toMatch(RANGE_WORDS);
    await fireEvent.press(summary);
    expect(screen.getByTestId('custom-picker')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'End (optional)' }).props.accessibilityValue.text,
    ).toMatch(ONE_DATE_WORDS);
  });

  it('iPhone: one date only (no end) gives a one-night list', async () => {
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Custom' }));
    await fireEvent(screen.getByTestId('custom-picker'), 'valueChange', {}, daysAhead(20));
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));

    const picked = lastFilter();
    expect(picked.kind).toBe('custom');
    expect(picked.from).toEqual(picked.to);
    expect(screen.getByRole('header', { name: ONE_DATE_WORDS })).toBeOnTheScreen();
    expect(screen.getByText(/^[A-Z]+DAY NIGHT$/)).toBeOnTheScreen();
    expect(await screen.findByText(/^Nothing on [A-Z][a-z]{2}, .+ yet$/)).toBeOnTheScreen();
  });

  it('iPhone: Cancel and the dimmed area close the sheet and keep the old filter', async () => {
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Custom' }));
    await fireEvent(screen.getByTestId('custom-picker'), 'valueChange', {}, daysAhead(20));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('custom-picker')).toBeNull();
    expect(lastFilter()).toEqual({ kind: 'week' });

    await fireEvent.press(screen.getByRole('radio', { name: 'Custom' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Close date picker' }));
    expect(screen.queryByTestId('custom-picker')).toBeNull();
    expect(lastFilter()).toEqual({ kind: 'week' });
  });

  describe('on Android', () => {
    const realOS = Platform.OS;
    const open = DateTimePickerAndroid.open as jest.Mock;
    beforeEach(() => {
      Platform.OS = 'android';
    });
    afterEach(() => {
      Platform.OS = realOS;
    });
    /** The options of the n-th dialog opened (0 = first). */
    const dialog = (n: number) => open.mock.calls[n][0];

    it('start dialog, then end dialog; each closes itself and no picker is drawn', async () => {
      await render(<HomeScreen />);
      await fireEvent.press(screen.getByRole('radio', { name: 'Custom' }));
      expect(screen.queryByTestId('custom-picker')).toBeNull();
      expect(open).toHaveBeenCalledTimes(1);
      expect(dialog(0)).toMatchObject({
        mode: 'date',
        title: 'Start date',
        timeZoneName: 'America/New_York',
      });

      await act(async () => dialog(0).onValueChange({}, daysAhead(20)));
      expect(open).toHaveBeenCalledTimes(2);
      expect(dialog(1)).toMatchObject({
        title: 'End date (optional)',
        negativeButton: { label: ONE_NIGHT },
      });
      // The end dialog can't go before the start or past 60 nights.
      expect(dialog(1).minimumDate.getTime()).toBeGreaterThan(daysAhead(19).getTime());
      expect(dialog(1).maximumDate.getTime()).toBeLessThan(daysAhead(80).getTime());

      await act(async () => dialog(1).onValueChange({}, daysAhead(23)));
      expect(lastFilter().kind).toBe('custom');
      expect(screen.getByText('4 NIGHTS')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Custom dates' })).toBeOnTheScreen();
    });

    it('"One night" on the end dialog keeps just the start date', async () => {
      await render(<HomeScreen />);
      await fireEvent.press(screen.getByRole('radio', { name: 'Custom' }));
      await act(async () => dialog(0).onValueChange({}, daysAhead(20)));
      await act(async () => dialog(1).onDismiss());
      const picked = lastFilter();
      expect(picked.kind).toBe('custom');
      expect(picked.from).toEqual(picked.to);
    });

    it('cancelling the start dialog changes nothing', async () => {
      await render(<HomeScreen />);
      await fireEvent.press(screen.getByRole('radio', { name: 'Custom' }));
      // The guest backs out: the first dialog's onValueChange never runs.
      expect(open).toHaveBeenCalledTimes(1);
      expect(lastFilter()).toEqual({ kind: 'week' });
    });
  });
});

describe('HomeScreen after creating an event (VC-63b)', () => {
  it('reloads the list and says where to find an event the filter hides', async () => {
    // A party 20 days out: not in "This week".
    noteCreatedEvent({
      id: 'new-1',
      startsAt: new Date(Date.now() + 20 * 24 * HOUR).toISOString(),
    });
    await render(<HomeScreen />);
    expect(
      await screen.findByText(
        /^Saved for [A-Z][a-z]{2}, [A-Z][a-z]{2} \d+\. Switch to Custom to see it\.$/,
      ),
    ).toBeOnTheScreen();
    // The first load plus the reload for the new event.
    expect(list).toHaveBeenCalledTimes(2);

    // Picking another filter clears the note (it was about the old one).
    await fireEvent.press(screen.getByRole('radio', { name: 'Tonight' }));
    expect(screen.queryByText(/^Saved for /)).toBeNull();
  });

  it('reloads but says nothing extra when the event is already in the list', async () => {
    noteCreatedEvent({ id: 'new-2', startsAt: new Date(Date.now() + 2 * HOUR).toISOString() });
    await render(<HomeScreen />);
    await screen.findByText(EMPTY_TITLE);
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/^Saved for /)).toBeNull();
  });

  it('marks a test event with a TEST chip (admins and testers only ever see these)', async () => {
    list.mockResolvedValue({ ok: true, events: [makeEvent({ is_test: true }, 2)] });
    await render(<HomeScreen />);
    expect(await screen.findByText(TEST_LABEL)).toBeOnTheScreen();
    const card = screen.getByRole('button', { name: /^Saturday rooftop, Test event, / });
    expect(card).toBeOnTheScreen();
  });

  it('acts on the note only once', async () => {
    await render(<HomeScreen />);
    await screen.findByText(EMPTY_TITLE);
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe('HomeScreen paging (VC-66)', () => {
  /** Page one: a started party and a later one; more follow. */
  const pageOne = () => ({
    ok: true,
    events: [
      makeEvent({ id: 'e1', title: 'Started party' }, -1),
      makeEvent({ id: 'e2', title: 'Later party' }, 2),
    ],
    hasMore: true,
  });
  /** Page two: one more started party; nothing after it. */
  const pageTwo = () => ({
    ok: true,
    events: [makeEvent({ id: 'e3', title: 'Third party' }, -0.5)],
    hasMore: false,
  });

  it('has no "Load more events" when everything fits on one page', async () => {
    list.mockResolvedValue({ ok: true, events: [makeEvent({})], hasMore: false });
    await render(<HomeScreen />);
    await screen.findByText('Saturday rooftop');
    expect(screen.queryByRole('button', { name: LOAD_MORE_LABEL })).toBeNull();
  });

  it('the button loads the next page after the last card, in the same window', async () => {
    list.mockResolvedValueOnce(pageOne());
    list.mockResolvedValueOnce(pageTwo());
    await render(<HomeScreen />);
    await screen.findByText('Later party');
    const [firstNow, firstFilter, firstAfter] = list.mock.calls[0];
    expect(firstAfter).toBeUndefined();

    await fireEvent.press(screen.getByRole('button', { name: LOAD_MORE_LABEL }));
    expect(await screen.findByText('Third party')).toBeOnTheScreen();
    // The same moment and filter as the first page, after the last card (e2).
    const [now, filter, after] = list.mock.calls[1];
    expect(now).toBe(firstNow);
    expect(filter).toEqual(firstFilter);
    expect(after).toMatchObject({ id: 'e2' });
    // Both pages stay, and nothing follows now.
    expect(screen.getByText('Started party')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: LOAD_MORE_LABEL })).toBeNull();
    // The vibes call now covers the started cards of both pages.
    expect(vibesFor).toHaveBeenLastCalledWith(['e1', 'e3']);
  });

  it('scrolling near the end loads more too; a failure is shown and the button stays', async () => {
    list.mockResolvedValueOnce(pageOne());
    list.mockResolvedValueOnce({
      ok: false,
      message: "We couldn't load events. Please try again.",
    });
    list.mockResolvedValueOnce(pageTwo());
    await render(<HomeScreen />);
    await screen.findByText('Later party');

    const scroll = screen.getByTestId('tonight-list');
    await act(async () => {
      await scroll.props.onEndReached();
    });
    expect(await screen.findByText("We couldn't load events. Please try again.")).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: LOAD_MORE_LABEL })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: LOAD_MORE_LABEL }));
    expect(await screen.findByText('Third party')).toBeOnTheScreen();
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('drops a page that arrives after the filter changed', async () => {
    list.mockResolvedValueOnce(pageOne());
    // The next page is slow: we answer it by hand, after the filter changes.
    let answerPage: (value: unknown) => void = () => {};
    list.mockReturnValueOnce(new Promise((resolve) => (answerPage = resolve)));
    list.mockResolvedValueOnce({
      ok: true,
      events: [makeEvent({ id: 'w1', title: 'Weekend party' }, 3)],
      hasMore: false,
    });
    await render(<HomeScreen />);
    await screen.findByText('Later party');

    await fireEvent.press(screen.getByRole('button', { name: LOAD_MORE_LABEL }));
    await fireEvent.press(screen.getByRole('radio', { name: 'This weekend' }));
    expect(await screen.findByText('Weekend party')).toBeOnTheScreen();

    await act(async () => {
      answerPage(pageTwo());
    });
    // The old week's page never lands on the weekend list.
    expect(screen.queryByText('Third party')).toBeNull();
    expect(screen.getByText('Weekend party')).toBeOnTheScreen();
  });

  it('drops a page asked for the old list when a refresh landed first (cto fix)', async () => {
    list.mockResolvedValueOnce(pageOne());
    // The refresh and the next page are both slow: we answer them by hand.
    let answerRefresh: (value: unknown) => void = () => {};
    let answerPage: (value: unknown) => void = () => {};
    list.mockReturnValueOnce(new Promise((resolve) => (answerRefresh = resolve)));
    list.mockReturnValueOnce(new Promise((resolve) => (answerPage = resolve)));
    await render(<HomeScreen />);
    await screen.findByText('Later party');

    // 1. A pull to refresh starts. 2. "Load more" starts, still on the old list.
    const scroll = screen.getByTestId('tonight-list');
    let refreshDone: Promise<void> = Promise.resolve();
    await act(async () => {
      refreshDone = scroll.props.refreshControl.props.onRefresh();
    });
    await fireEvent.press(screen.getByRole('button', { name: LOAD_MORE_LABEL }));
    // 3. The refresh lands with a new list. 4. The old list's page arrives.
    await act(async () => {
      answerRefresh({
        ok: true,
        events: [makeEvent({ id: 'n1', title: 'Fresh party' }, 3)],
        hasMore: false,
      });
      await refreshDone;
    });
    expect(await screen.findByText('Fresh party')).toBeOnTheScreen();
    await act(async () => {
      answerPage(pageTwo());
    });
    // The old list's page is not glued onto the refreshed list.
    expect(screen.queryByText('Third party')).toBeNull();
    expect(screen.getByText('Fresh party')).toBeOnTheScreen();
  });
});
