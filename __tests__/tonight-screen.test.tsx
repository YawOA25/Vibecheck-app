/**
 * Tests for the Tonight screen (app/index.tsx), tasks VC-B03c, VC-B04, VC-B05.
 *
 * React Native Testing Library draws the screen in memory (no phone needed)
 * and lets us look for text the way a user would see it. The sign-in state,
 * the router and the event list read are replaced with fakes. We check:
 *   - the header: day line, "Tonight" heading, Sign out, admin-only New event;
 *   - the loading state while the list is on its way;
 *   - the error state, and that "Try again" loads again;
 *   - the empty state when there are no events;
 *   - the list: Today/Tomorrow sections, area and time, the "Early" vibe
 *     chip, the "Staff pick" tag, and that a card opens the event page;
 *   - pull to refresh keeps the old list if the refresh fails;
 *   - the developer-only "send a Sentry test error" long-press (VC-26).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import TonightScreen, { EMPTY_BODY, EMPTY_TITLE } from '../app/index';
import { useAuth } from '@/lib/auth-context';
import { listTonightEvents } from '@/lib/events-read';
import { sendTestError } from '@/lib/sentry';
import type { PublicEvent } from '@/lib/tonight';

jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/events-read', () => ({ listTonightEvents: jest.fn() }));
jest.mock('@/lib/sentry', () => ({ sendTestError: jest.fn(() => true) }));
// The "mock" prefix lets jest.mock (which runs first) use this fake.
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const signOut = jest.fn();
const list = listTonightEvents as jest.Mock;

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
});

describe('TonightScreen header', () => {
  it('shows the day and the Tonight heading', async () => {
    await render(<TonightScreen />);
    // For example "SATURDAY NIGHT".
    expect(screen.getByText(/^[A-Z]+DAY NIGHT$/)).toBeOnTheScreen();
    // getByRole finds the heading the same way a screen reader would.
    expect(screen.getByRole('header', { name: 'Tonight' })).toBeOnTheScreen();
  });

  it('hides the New event button from normal users', async () => {
    await render(<TonightScreen />);
    expect(screen.queryByRole('button', { name: 'New event' })).toBeNull();
  });

  it('shows admins a New event button that opens the admin screen', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'admin-1', display_name: 'Yaw', role: 'admin', is_tester: false },
      signOut,
    });
    await render(<TonightScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'New event' }));
    expect(mockPush).toHaveBeenCalledWith('/admin/new-event');
  });

  it('signs out from the Sign out button', async () => {
    await render(<TonightScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalled();
  });
});

describe('TonightScreen Sentry test error (developers only, VC-26)', () => {
  // __DEV__ is a global React Native sets; we switch it per test and put it back.
  const realDev = (globalThis as any).__DEV__;
  afterEach(() => {
    (globalThis as any).__DEV__ = realDev;
  });

  it('sends a test error on a long-press of the title in development', async () => {
    (globalThis as any).__DEV__ = true;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<TonightScreen />);
    await fireEvent(screen.getByRole('header', { name: 'Tonight' }), 'longPress');
    expect(sendTestError).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('Test error sent', expect.any(String));
  });

  it('does nothing on a long-press in a store build', async () => {
    (globalThis as any).__DEV__ = false;
    await render(<TonightScreen />);
    // In a store build the title has no long-press handler at all.
    expect(screen.getByRole('header', { name: 'Tonight' }).props.onLongPress).toBeUndefined();
    expect(sendTestError).not.toHaveBeenCalled();
  });
});

describe('TonightScreen list states', () => {
  it('shows a loading state while the list is on its way', async () => {
    // A promise that never settles keeps the screen loading.
    list.mockReturnValue(new Promise(() => {}));
    await render(<TonightScreen />);
    expect(screen.getByLabelText("Loading tonight's events")).toBeOnTheScreen();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
  });

  it('shows an error with Try again, which loads again', async () => {
    list.mockResolvedValueOnce({
      ok: false,
      message: "We couldn't load events. Please try again.",
    });
    await render(<TonightScreen />);
    expect(await screen.findByText("We couldn't load events. Please try again.")).toBeOnTheScreen();

    // The second try works and finds nothing: the empty state shows.
    list.mockResolvedValueOnce({ ok: true, events: [] });
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(EMPTY_TITLE)).toBeOnTheScreen();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state when there are no events', async () => {
    await render(<TonightScreen />);
    expect(await screen.findByRole('header', { name: EMPTY_TITLE })).toBeOnTheScreen();
    expect(screen.getByText(EMPTY_BODY)).toBeOnTheScreen();
  });
});

describe('TonightScreen events', () => {
  it('lists events with area, time and the Early vibe chip, and opens one on tap', async () => {
    list.mockResolvedValue({ ok: true, events: [makeEvent({})] });
    await render(<TonightScreen />);

    expect(await screen.findByText('Saturday rooftop')).toBeOnTheScreen();
    // "Shaw, DC · Today · 10 PM" or similar: area first, then when.
    expect(screen.getByText(/^Shaw, DC · (Today|Tomorrow) · /)).toBeOnTheScreen();
    expect(screen.getByText('Early')).toBeOnTheScreen();
    expect(screen.queryByText('Staff pick')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: /^Saturday rooftop, / }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/event/[id]', params: { id: 'e1' } });
  });

  it('marks staff picks and 21+ events', async () => {
    list.mockResolvedValue({
      ok: true,
      events: [makeEvent({ source: 'staff_pick', is_21_plus: true })],
    });
    await render(<TonightScreen />);
    expect(await screen.findByText('Staff pick')).toBeOnTheScreen();
    expect(screen.getByText('21+')).toBeOnTheScreen();
  });

  it('puts a running event under Today with "On now"', async () => {
    list.mockResolvedValue({ ok: true, events: [makeEvent({}, -1)] });
    await render(<TonightScreen />);
    expect(await screen.findByText('TODAY')).toBeOnTheScreen();
    expect(screen.getByText(/On now · until /)).toBeOnTheScreen();
  });

  it('keeps the old list and shows a message if a pull-to-refresh fails', async () => {
    list.mockResolvedValueOnce({ ok: true, events: [makeEvent({})] });
    await render(<TonightScreen />);
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
