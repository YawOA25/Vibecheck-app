/**
 * Tests for the home screen (app/index.tsx), tasks VC-B03c, VC-B04, VC-B05,
 * and the week view VC-61.
 *
 * React Native Testing Library draws the screen in memory (no phone needed)
 * and lets us look for text the way a user would see it. The sign-in state,
 * the router and the event list read are replaced with fakes. We check:
 *   - the header: "SATURDAY TO FRIDAY" line, "This week" heading, Sign out,
 *     admin-only New event;
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
 *   - the developer-only "send a Sentry test error" long-press (VC-26).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import HomeScreen, { EMPTY_BODY, EMPTY_TITLE, LIST_TITLE, SHOW_WEEK_LABEL } from '../app/index';
import { RANGE_NOTE } from '@/components/DateFilterBar';
import { useAuth } from '@/lib/auth-context';
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
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
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

  it('hides the New event button from normal users', async () => {
    await render(<HomeScreen />);
    expect(screen.queryByRole('button', { name: 'New event' })).toBeNull();
  });

  it('shows admins a New event button that opens the admin screen', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'admin-1', display_name: 'Yaw', role: 'admin', is_tester: false },
      signOut,
    });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'New event' }));
    expect(mockPush).toHaveBeenCalledWith('/admin/new-event');
  });

  it('shows admins a Reports button for the tag report queue (VC-58), and nobody else', async () => {
    await render(<HomeScreen />);
    expect(screen.queryByRole('button', { name: 'Reports' })).toBeNull();
    await screen.unmount();

    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'admin-1', display_name: 'Yaw', role: 'admin', is_tester: false },
      signOut,
    });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Reports' }));
    expect(mockPush).toHaveBeenCalledWith('/admin/reports');
  });

  it('signs out from the Sign out button', async () => {
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalled();
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

  it('shows four radio chips in a "Dates" group, This week picked first', async () => {
    await render(<HomeScreen />);
    expect(screen.getByLabelText('Dates')).toBeOnTheScreen();
    for (const name of ['This week', 'This weekend', 'Pick a date', 'Custom']) {
      expect(screen.getByRole('radio', { name })).toBeOnTheScreen();
    }
    expect(screen.getByRole('radio', { name: 'This week' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'This weekend' })).not.toBeChecked();
    expect(lastFilter()).toEqual({ kind: 'week' });
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

  it('Pick a date: a "Night" date box, and the picked night loads', async () => {
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Pick a date' }));
    // Starts on tonight.
    expect(lastFilter()).toEqual({ kind: 'date', night: expect.any(Object) });

    const box = screen.getByRole('button', { name: 'Night' });
    expect(box.props.accessibilityValue.text).toMatch(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d+$/);
    // Open the iPhone wheel and spin it to 20 days from now (noon New York).
    await fireEvent.press(box);
    const wheel = screen.getByTestId('night-picker');
    expect(wheel.props.accessibilityLabel).toBe('Night date picker');
    const later = new Date(Date.now() + 20 * 24 * HOUR);
    await fireEvent(wheel, 'valueChange', {}, later);

    const picked = lastFilter();
    expect(picked.kind).toBe('date');
    // The title is that night's short date, e.g. "Sat, Nov 21".
    const title = screen.getByRole('header', { name: /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d+$/ });
    expect(title).toBeOnTheScreen();
    expect(await screen.findByText(/^Nothing on [A-Z][a-z]{2}, .+ yet$/)).toBeOnTheScreen();
  });

  it('Custom: From and To boxes, the 60-night note, and a range title', async () => {
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Custom' }));
    expect(lastFilter().kind).toBe('range');
    expect(screen.getByRole('button', { name: 'From' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'To' })).toBeOnTheScreen();
    expect(screen.getByText(RANGE_NOTE)).toBeOnTheScreen();
    // Two weeks to start with, e.g. "Oct 31 – Nov 13".
    expect(
      screen.getByRole('header', { name: /^[A-Z][a-z]{2} \d+ – [A-Z][a-z]{2} \d+$/ }),
    ).toBeOnTheScreen();
    expect(screen.getByText('14 NIGHTS')).toBeOnTheScreen();
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
