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
 *   - "I'm here" opens the check-in screen (tested in check-in-screen.test.tsx);
 *   - admins only (VC-34, VC-35): an Admin box with "Edit event" (opens the
 *     edit screen) and "Show party code" (asks the server, shows the code,
 *     and can hide it again); guests and testers never see the box.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Share } from 'react-native';

import EventScreen, {
  EDIT_EVENT,
  HIDE_CODE,
  NOT_FOUND_TITLE,
  SHARE_LABEL,
  SHOW_CODE,
} from '../app/event/[id]';
import { ENTRY_DISCLAIMER, ENTRY_LINK_LABEL } from '@/components/EntryLink';
import { EARLY_READING_TITLE } from '@/components/LiveVibeCard';
import { NOT_AFFILIATED } from '@/components/TicketLink';
import { useAuth } from '@/lib/auth-context';
import { getEventCode } from '@/lib/events-api';
import { getEvent } from '@/lib/events-read';
import type { PublicEvent } from '@/lib/tonight';

jest.mock('@/lib/events-read', () => ({ getEvent: jest.fn() }));
jest.mock('@/lib/events-api', () => ({ getEventCode: jest.fn() }));
jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));
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
  // Outside a real navigator the page is "in view" once: run the effect like
  // a normal useEffect. (require inside: jest.mock can't use outer imports.)
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(effect, [effect]);
  },
}));

const get = getEvent as jest.Mock;
const code = getEventCode as jest.Mock;

/**
 * Pretends the signed-in person has the given role.
 *
 * @param role - 'user' or 'admin'.
 * @param isTester - whether they are a tester.
 */
function signInAs(role: 'user' | 'admin', isTester = false) {
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'p1', display_name: 'Ava', role, is_tester: isTester },
  });
}
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
  signInAs('user');
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

describe('EventScreen "How to get in" link (VC-40)', () => {
  const ENTRY_URL = 'https://partiful.com/e/rooftop';

  it('shows a plain "How to get in" link and the disclaimer for a host event', async () => {
    get.mockResolvedValue({ ok: true, event: makeEvent({ entry_url: ENTRY_URL }) });
    await render(<EventScreen />);

    const link = await screen.findByRole('link', { name: ENTRY_LINK_LABEL });
    expect(screen.getByText(ENTRY_DISCLAIMER)).toBeOnTheScreen();
    // No site names anywhere (legal prep: no marks in or near the link).
    expect(screen.queryByText(/partiful/i)).toBeNull();
    // It opens the host's page in the phone's browser.
    await fireEvent.press(link);
    expect(openURL).toHaveBeenCalledWith(ENTRY_URL);
  });

  it('shows nothing when no link is set', async () => {
    get.mockResolvedValue({ ok: true, event: makeEvent() });
    await render(<EventScreen />);
    await screen.findByRole('header', { name: 'Rooftop Sundown' });
    expect(screen.queryByRole('link', { name: ENTRY_LINK_LABEL })).toBeNull();
    expect(screen.queryByText(ENTRY_DISCLAIMER)).toBeNull();
  });

  it('shows nothing for a staff pick, or for a link that fails the safety check', async () => {
    get.mockResolvedValue({
      ok: true,
      event: makeEvent({ source: 'staff_pick', entry_url: ENTRY_URL }),
    });
    const first = await render(<EventScreen />);
    await screen.findByText('Staff pick');
    expect(screen.queryByRole('link', { name: ENTRY_LINK_LABEL })).toBeNull();
    await first.unmount();

    get.mockResolvedValue({
      ok: true,
      event: makeEvent({ entry_url: 'https://partiful.com@evil.example' }),
    });
    await render(<EventScreen />);
    await screen.findByRole('header', { name: 'Rooftop Sundown' });
    expect(screen.queryByRole('link', { name: ENTRY_LINK_LABEL })).toBeNull();
  });
});

describe('EventScreen Share (VC-41)', () => {
  it('opens the share sheet with the name, area and time, never the code or pin', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    // Even if an event object somehow carried secrets, they must not be shared.
    const event = {
      ...makeEvent({ state: 'DC' }),
      check_in_code: 'K7MX2Q',
      lat: 38.8765,
      lng: -77.0031,
    } as PublicEvent;
    get.mockResolvedValue({ ok: true, event });
    await render(<EventScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: SHARE_LABEL }));

    expect(share).toHaveBeenCalledTimes(1);
    const { message } = share.mock.calls[0][0] as { message: string };
    expect(message).toContain('Rooftop Sundown');
    expect(message).toContain('Navy Yard, DC');
    expect(message).not.toMatch(/K7MX2Q|38\.87|77\.00/);
    share.mockRestore();
  });
});

describe('EventScreen admin tools (VC-34, VC-35)', () => {
  it('guests see no Admin box, no Edit event and no party code button', async () => {
    get.mockResolvedValue({ ok: true, event: makeEvent() });
    await render(<EventScreen />);
    await screen.findByRole('header', { name: 'Rooftop Sundown' });

    expect(screen.queryByText('ADMIN')).toBeNull();
    expect(screen.queryByRole('button', { name: EDIT_EVENT })).toBeNull();
    expect(screen.queryByRole('button', { name: SHOW_CODE })).toBeNull();
  });

  it('a tester who is not an admin sees no admin tools either', async () => {
    signInAs('user', true);
    get.mockResolvedValue({ ok: true, event: makeEvent() });
    await render(<EventScreen />);
    await screen.findByRole('header', { name: 'Rooftop Sundown' });
    expect(screen.queryByRole('button', { name: EDIT_EVENT })).toBeNull();
    expect(screen.queryByRole('button', { name: SHOW_CODE })).toBeNull();
  });

  it('an admin can open Edit event', async () => {
    signInAs('admin');
    get.mockResolvedValue({ ok: true, event: makeEvent() });
    await render(<EventScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: EDIT_EVENT }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/admin/edit-event/[id]',
      params: { id: 'e1' },
    });
  });

  it('the party code stays hidden until the admin taps, then can be hidden again', async () => {
    signInAs('admin');
    get.mockResolvedValue({ ok: true, event: makeEvent() });
    code.mockResolvedValue({ ok: true, code: 'K7MX2Q' });
    await render(<EventScreen />);
    await screen.findByRole('header', { name: 'Rooftop Sundown' });

    // Not fetched, not shown, until the tap.
    expect(code).not.toHaveBeenCalled();
    expect(screen.queryByText('K7MX2Q')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: SHOW_CODE }));
    expect(code).toHaveBeenCalledWith('e1');
    expect(screen.getByText('K7MX2Q')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: HIDE_CODE }));
    expect(screen.queryByText('K7MX2Q')).toBeNull();
    expect(screen.getByRole('button', { name: SHOW_CODE })).toBeOnTheScreen();
  });

  it('shows a plain message if the code cannot be loaded', async () => {
    signInAs('admin');
    get.mockResolvedValue({ ok: true, event: makeEvent() });
    code.mockResolvedValue({ ok: false, message: 'Only admins can see the party code.' });
    await render(<EventScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: SHOW_CODE }));
    expect(screen.getByText('Only admins can see the party code.')).toBeOnTheScreen();
  });

  it('never writes the code to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => {}),
    );
    signInAs('admin');
    get.mockResolvedValue({ ok: true, event: makeEvent() });
    code.mockResolvedValue({ ok: true, code: 'K7MX2Q' });
    await render(<EventScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: SHOW_CODE }));
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain('K7MX2Q');
      spy.mockRestore();
    }
  });
});
