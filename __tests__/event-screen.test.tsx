/**
 * Tests for the event page (app/event/[id].tsx), task VC-B05. (The
 * party-code screen it leads to is tested in join-screen.test.tsx, VC-B07.)
 *
 * The router and the event read are replaced with fakes, and the phone's
 * "open this link" function is watched. We check:
 *   - loading, error (with Try again) and not-found states;
 *   - the details: time range, name, area, 21+, our summary, and the
 *     live vibe card (VC-B09; its states are tested in
 *     live-vibe-card.test.tsx);
 *   - staff picks (VC-29): the "Staff pick" tag, a plain "Get tickets" link
 *     that opens the ticket page in the browser, and "Not affiliated with
 *     Eventbrite.";
 *   - a host party never shows a ticket link, even if one is stored;
 *   - "I'm here" opens the check-in screen (tested in check-in-screen.test.tsx);
 *   - admins only (VC-34, VC-35): an Admin box with "Edit event" (opens the
 *     edit screen) and "Show party code" (asks the server, shows the code,
 *     and can hide it again); guests and testers never see the box;
 *   - VC-B08: "Rate the night" shows only once the guest is checked in here
 *     (never for admins) and opens the rating screen;
 *   - VC-43: the Heads-up card shows counts, "+1" sends one and reloads,
 *     a refused +1 says why, and admins can't +1.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Share } from 'react-native';

import EventScreen, {
  EDIT_EVENT,
  MODERATE_LABEL,
  HIDE_CODE,
  NOT_FOUND_TITLE,
  RATE_LABEL,
  SHARE_LABEL,
  SHOW_CODE,
} from '../app/event/[id]';
import { ENTRY_DISCLAIMER, ENTRY_LINK_LABEL } from '@/components/EntryLink';
import { NO_HEADS_UPS } from '@/components/HeadsUpCard';
import { addHeadsUp, getEventHeadsUps, getMyRatingStatus } from '@/lib/ratings-api';
import { EARLY_TITLE } from '@/lib/vibe';
import { getEventVibe } from '@/lib/vibe-api';
import { NOT_AFFILIATED } from '@/components/TicketLink';
import { useAuth } from '@/lib/auth-context';
import { getEventCode } from '@/lib/events-api';
import { getEvent } from '@/lib/events-read';
import type { PublicEvent } from '@/lib/tonight';

jest.mock('@/lib/events-read', () => ({ getEvent: jest.fn() }));
jest.mock('@/lib/events-api', () => ({ getEventCode: jest.fn() }));
jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/vibe-api', () => ({ getEventVibe: jest.fn() }));
// The Heads-up card's "Report this tag" call (VC-58); tested in heads-up-report.test.tsx.
jest.mock('@/lib/moderation-api', () => ({ reportHeadsUpTag: jest.fn() }));
jest.mock('@/lib/ratings-api', () => ({
  getMyRatingStatus: jest.fn(),
  getEventHeadsUps: jest.fn(),
  addHeadsUp: jest.fn(),
}));
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
const myStatus = getMyRatingStatus as jest.Mock;
const headsUps = getEventHeadsUps as jest.Mock;
const plusOne = addHeadsUp as jest.Mock;

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
  // By default: not checked in, and no heads-ups yet.
  myStatus.mockResolvedValue({ ok: true, status: { checkIn: null, ratedAt: null } });
  headsUps.mockResolvedValue({ ok: true, tags: [] });
  // And an early vibe: 3 ratings, 4 people here.
  (getEventVibe as jest.Mock).mockResolvedValue({
    ok: true,
    vibe: {
      state: 'early',
      raters: 3,
      here: 4,
      score: null,
      label: null,
      nightAverage: null,
      minutesSinceLast: 1,
      reactions: [],
    },
  });
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
    expect(await screen.findByText(EARLY_TITLE)).toBeOnTheScreen();
    expect(screen.getByText('Early reading: 3 people so far')).toBeOnTheScreen();
    // VC-42: the headcount, a number only.
    expect(screen.getByText('4 here')).toBeOnTheScreen();
    expect(getEventVibe).toHaveBeenCalledWith('e1');
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

  it('an admin can open the Moderate screen (VC-47); guests have no such button', async () => {
    get.mockResolvedValue({ ok: true, event: makeEvent() });
    await render(<EventScreen />);
    await screen.findByRole('header', { name: 'Rooftop Sundown' });
    expect(screen.queryByRole('button', { name: MODERATE_LABEL })).toBeNull();
    await screen.unmount();

    signInAs('admin');
    await render(<EventScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: MODERATE_LABEL }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/admin/moderate/[id]',
      params: { id: 'e1', title: 'Rooftop Sundown' },
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

describe('EventScreen rating (VC-B08)', () => {
  it('hides "Rate the night" until the guest is checked in', async () => {
    get.mockResolvedValue({ ok: true, event: makeEvent() });
    await render(<EventScreen />);
    expect(await screen.findByRole('button', { name: "I'm here" })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: RATE_LABEL })).toBeNull();
    expect(myStatus).toHaveBeenCalledWith('e1');
  });

  it('shows "Rate the night" once checked in, and it opens the rating screen', async () => {
    myStatus.mockResolvedValue({
      ok: true,
      status: { checkIn: { method: 'gps', lastVerifiedAt: '2026-10-31T02:00:00Z' }, ratedAt: null },
    });
    get.mockResolvedValue({ ok: true, event: makeEvent() });
    await render(<EventScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: RATE_LABEL }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/rate/[id]', params: { id: 'e1' } });
    // "I'm here" stays, for checking in again later.
    expect(screen.getByRole('button', { name: "I'm here" })).toBeOnTheScreen();
  });

  it('never shows "Rate the night" to an admin, even when checked in', async () => {
    signInAs('admin');
    myStatus.mockResolvedValue({
      ok: true,
      status: { checkIn: { method: 'gps', lastVerifiedAt: '2026-10-31T02:00:00Z' }, ratedAt: null },
    });
    get.mockResolvedValue({ ok: true, event: makeEvent() });
    await render(<EventScreen />);
    expect(await screen.findByRole('button', { name: "I'm here" })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: RATE_LABEL })).toBeNull();
  });
});

describe('EventScreen heads-up card (VC-43)', () => {
  it('says there are no heads-ups yet', async () => {
    get.mockResolvedValue({ ok: true, event: makeEvent() });
    await render(<EventScreen />);
    expect(await screen.findByText(NO_HEADS_UPS)).toBeOnTheScreen();
    expect(headsUps).toHaveBeenCalledWith('e1');
  });

  it('shows counts, and a +1 is sent and the counts reload', async () => {
    headsUps
      .mockResolvedValueOnce({
        ok: true,
        tags: [
          { tag: 'lines_long', count: 3, mine: false },
          { tag: 'good_crowd', count: 1, mine: true },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        tags: [
          { tag: 'lines_long', count: 4, mine: true },
          { tag: 'good_crowd', count: 1, mine: true },
        ],
      });
    plusOne.mockResolvedValue({ ok: true, result: { status: 'added' } });
    get.mockResolvedValue({ ok: true, event: makeEvent() });
    await render(<EventScreen />);

    const lines = await screen.findByRole('button', { name: 'Lines are long, 3 people' });
    // The guest's own +1 is marked (a check mark, and "selected").
    expect(
      screen.getByRole('button', { name: "Good crowd, 1 person, you +1'd this" }),
    ).toBeSelected();
    await fireEvent.press(lines);
    expect(plusOne).toHaveBeenCalledWith('e1', 'lines_long');
    expect(
      await screen.findByRole('button', { name: "Lines are long, 4 people, you +1'd this" }),
    ).toBeOnTheScreen();
  });

  it('says why when a +1 is refused', async () => {
    headsUps.mockResolvedValue({ ok: true, tags: [{ tag: 'packed', count: 2, mine: false }] });
    plusOne.mockResolvedValue({ ok: true, result: { status: 'not_checked_in' } });
    get.mockResolvedValue({ ok: true, event: makeEvent() });
    await render(<EventScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Packed, 2 people' }));
    expect(
      await screen.findByText('Check in first: only guests who are here can +1 a heads-up.'),
    ).toBeOnTheScreen();
  });

  it('admins see the counts but their chips are switched off', async () => {
    signInAs('admin');
    headsUps.mockResolvedValue({ ok: true, tags: [{ tag: 'packed', count: 2, mine: false }] });
    get.mockResolvedValue({ ok: true, event: makeEvent() });
    await render(<EventScreen />);
    const chip = await screen.findByRole('button', { name: 'Packed, 2 people' });
    expect(chip).toBeDisabled();
    await fireEvent.press(chip);
    expect(plusOne).not.toHaveBeenCalled();
  });
});
