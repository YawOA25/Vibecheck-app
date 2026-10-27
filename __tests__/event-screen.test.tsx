/**
 * Tests for the event page (app/event/[id].tsx), task VC-B05. (The
 * party-code screen it leads to is tested in join-screen.test.tsx, VC-B07.)
 *
 * The router and the event read are replaced with fakes, and the phone's
 * "open this link" function is watched. We check:
 *   - loading, error (with Try again) and not-found states;
 *   - the details: time range, name, area, 21+, our summary, and the
 *     "Early reading" live vibe block;
 *   - staff picks (VC-29): the "Staff pick" tag, a plain "Get tickets" link
 *     that opens the ticket page in the browser, and "Not affiliated with
 *     Eventbrite.";
 *   - a host party never shows a ticket link, even if one is stored;
 *   - "I'm here" opens the check-in screen (tested in check-in-screen.test.tsx).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import EventScreen, { NOT_FOUND_TITLE } from '../app/event/[id]';
import { EARLY_READING_TITLE } from '@/components/LiveVibeCard';
import { NOT_AFFILIATED } from '@/components/TicketLink';
import { getEvent } from '@/lib/events-read';
import type { PublicEvent } from '@/lib/tonight';

jest.mock('@/lib/events-read', () => ({ getEvent: jest.fn() }));
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
const TICKET_URL = 'https://www.eventbrite.com/e/rooftop-sundown-123';
const HOUR = 60 * 60 * 1000;

/**
 * Makes a test event starting in an hour and lasting 4 hours.
 *
 * @param overrides - fields to change from the defaults.
 * @returns a PublicEvent.
 */
function makeEvent(overrides: Partial<PublicEvent> = {}): PublicEvent {
  const starts = new Date(Date.now() + HOUR);
  return {
    id: 'e1',
    title: 'Rooftop Sundown',
    area_label: 'Navy Yard, DC',
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

let openURL: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});

afterEach(() => openURL.mockRestore());

describe('EventScreen states', () => {
  it('shows a loading state first, and asks for the event in the address', async () => {
    get.mockReturnValue(new Promise(() => {}));
    await render(<EventScreen />);
    expect(screen.getByLabelText('Loading the event')).toBeOnTheScreen();
    expect(get).toHaveBeenCalledWith('e1');
  });

  it('shows an error with Try again, which loads again', async () => {
    get.mockResolvedValueOnce({ ok: false, message: "We couldn't load events. Please try again." });
    await render(<EventScreen />);
    expect(await screen.findByText("We couldn't load events. Please try again.")).toBeOnTheScreen();

    get.mockResolvedValueOnce({ ok: true, event: makeEvent() });
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('header', { name: 'Rooftop Sundown' })).toBeOnTheScreen();
  });

  it('says "Event not found" for a missing or hidden event', async () => {
    get.mockResolvedValue({ ok: true, event: null });
    await render(<EventScreen />);
    expect(await screen.findByRole('header', { name: NOT_FOUND_TITLE })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: "I'm here" })).toBeNull();
  });
});

describe('EventScreen details', () => {
  it('shows the time, name, area, 21+, summary and the Early reading block', async () => {
    get.mockResolvedValue({
      ok: true,
      event: makeEvent({ is_21_plus: true, summary: 'Sunset DJ set on the roof.' }),
    });
    await render(<EventScreen />);

    expect(await screen.findByRole('header', { name: 'Rooftop Sundown' })).toBeOnTheScreen();
    // For example "TODAY · 9 PM – 1 AM".
    expect(screen.getByText(/^(TODAY|TOMORROW) · .+ – .+$/)).toBeOnTheScreen();
    expect(screen.getByText('Navy Yard, DC')).toBeOnTheScreen();
    expect(screen.getByText('21+')).toBeOnTheScreen();
    expect(screen.getByText('Sunset DJ set on the roof.')).toBeOnTheScreen();
    expect(screen.getByText(EARLY_READING_TITLE)).toBeOnTheScreen();
  });

  it('shows no staff-pick tag or ticket link for a host party, even with a stored link', async () => {
    get.mockResolvedValue({ ok: true, event: makeEvent({ ticket_url: TICKET_URL }) });
    await render(<EventScreen />);
    await screen.findByRole('header', { name: 'Rooftop Sundown' });

    expect(screen.queryByText('Staff pick')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Get tickets' })).toBeNull();
    expect(screen.queryByText(NOT_AFFILIATED)).toBeNull();
  });

  it('opens check-in from "I\'m here"', async () => {
    get.mockResolvedValue({ ok: true, event: makeEvent() });
    await render(<EventScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: "I'm here" }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/check-in/[id]',
      params: { id: 'e1' },
    });
  });
});

describe('EventScreen staff picks (VC-29)', () => {
  it('shows the Staff pick tag, a plain Get tickets link and the not-affiliated line', async () => {
    get.mockResolvedValue({
      ok: true,
      event: makeEvent({ source: 'staff_pick', ticket_url: TICKET_URL }),
    });
    await render(<EventScreen />);

    expect(await screen.findByText('Staff pick')).toBeOnTheScreen();
    expect(screen.getByText(NOT_AFFILIATED)).toBeOnTheScreen();
    // A link (not a button), opening the ticket page in the phone's browser.
    await fireEvent.press(screen.getByRole('link', { name: 'Get tickets' }));
    expect(openURL).toHaveBeenCalledWith(TICKET_URL);
  });

  it('shows the Staff pick tag but no link when a staff pick has no ticket page', async () => {
    get.mockResolvedValue({ ok: true, event: makeEvent({ source: 'staff_pick' }) });
    await render(<EventScreen />);
    expect(await screen.findByText('Staff pick')).toBeOnTheScreen();
    expect(screen.queryByRole('link', { name: 'Get tickets' })).toBeNull();
  });

  it('never opens a link that fails the safety check', async () => {
    get.mockResolvedValue({
      ok: true,
      event: makeEvent({ source: 'staff_pick', ticket_url: 'https://eventbrite.com@evil.example' }),
    });
    await render(<EventScreen />);
    await screen.findByText('Staff pick');
    expect(screen.queryByRole('link', { name: 'Get tickets' })).toBeNull();
  });
});
