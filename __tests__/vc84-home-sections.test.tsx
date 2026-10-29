/**
 * Screen tests for VC-84 home sections, Direction A "Bands"
 * (app/(tabs)/index.tsx with src/components/HomeSections.tsx).
 *
 * The list read, the vibes call, sign-in, the router and the haptics are
 * fakes. Only the Date is pinned (other timers stay real), the same way as
 * vc80-home.test.tsx. We check:
 *   - empty, 1-event and many-event pages: which bands show, in which
 *     order, and that empty bands are left out;
 *   - section headers: a heading that says its count ("Live now, 2
 *     events"), the gold line on the Live now band, and "See all" picking
 *     the Tonight filter (and not shown once Tonight is picked);
 *   - Staff picks: repeated from their own night;
 *   - Coming up: day headings with date and count;
 *   - Halloween: the gold day heading with its tag and the gold-edged
 *     feature card, and the tag on tonight's band when tonight is Halloween.
 */
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';

import HomeScreen, { SEE_ALL_TONIGHT_SPOKEN } from '../app/(tabs)/index';
import { useAuth } from '@/lib/auth-context';
import { listHomeEvents } from '@/lib/events-read';
import { resetReduceMotionForTests } from '@/lib/reduce-motion';
import type { PublicEvent } from '@/lib/tonight';
import type { Vibe } from '@/lib/vibe';
import { getEventsVibe } from '@/lib/vibe-api';
import { colors } from '@/theme';

jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/events-read', () => ({ listHomeEvents: jest.fn() }));
jest.mock('@/lib/sentry', () => ({ sendTestError: jest.fn(() => true) }));
jest.mock('@/lib/vibe-api', () => ({ getEventsVibe: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ tapLight: jest.fn(), tapSelection: jest.fn() }));
// The Map side of Home reads through supabase; these tests stay on the list.
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useScrollToTop: () => {},
  // Outside a real navigator: run the focus effect like a normal useEffect.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(effect, [effect]);
  },
}));

const list = listHomeEvents as jest.Mock;
const vibesFor = getEventsVibe as jest.Mock;
const HOUR = 60 * 60 * 1000;
/** Saturday 17 Oct 2026, 8 PM New York (EDT): an ordinary night. */
const SAT_17 = new Date('2026-10-18T00:00:00Z');
/** Thursday 29 Oct 2026, 8 PM New York: Halloween is in two nights. */
const THU_29 = new Date('2026-10-30T00:00:00Z');
/** Saturday 31 Oct 2026, 8 PM New York: Halloween night. */
const SAT_31 = new Date('2026-11-01T00:00:00Z');

/** The pinned "now" for the current test (ev() counts from it). */
let now = SAT_17;

/**
 * Pins the clock's date (animations and timers keep running for real).
 *
 * @param at - the moment to pin.
 */
function pinClock(at: Date) {
  now = at;
  jest.useFakeTimers({
    now: at,
    advanceTimers: true,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

/**
 * Makes an event starting `startsInHours` from the pinned now, lasting 4 h.
 *
 * @param id - its id; the title is "Party <id>".
 * @param startsInHours - hours to the start (negative: already started).
 * @param overrides - other fields to change.
 * @returns a PublicEvent.
 */
function ev(id: string, startsInHours: number, overrides: Partial<PublicEvent> = {}): PublicEvent {
  const starts = new Date(now.getTime() + startsInHours * HOUR);
  return {
    id,
    title: `Party ${id}`,
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

/**
 * A live published vibe.
 *
 * @param score - the score.
 * @returns a Vibe.
 */
function live(score: number): Vibe {
  return {
    state: 'live',
    raters: 8,
    here: 10,
    score,
    label: 'Fire',
    nightAverage: null,
    minutesSinceLast: 2,
    reactions: [],
    breakdown: null,
    night: null,
  };
}

/** Every band on screen, top to bottom, by its testID ("band-live", ...). */
const bandIds = () =>
  screen.queryAllByTestId(/^band-/).map((b) => String(b.props.testID).replace('band-', ''));

beforeEach(() => {
  jest.clearAllMocks();
  pinClock(SAT_17);
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'user-1', display_name: 'Ava', role: 'user', is_tester: false },
  });
  vibesFor.mockResolvedValue({ ok: true, vibes: {} });
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  resetReduceMotionForTests(false);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('which bands show', () => {
  it('no events: no bands and no section headers, only the empty card', async () => {
    list.mockResolvedValue({ ok: true, events: [] });
    await render(<HomeScreen />);
    await screen.findByTestId('empty-moon');
    expect(bandIds()).toEqual([]);
    expect(screen.queryByRole('header', { name: 'Coming up' })).toBeNull();
  });

  it('1 event: only its band; no empty Live now, Staff picks or Coming up', async () => {
    list.mockResolvedValue({ ok: true, events: [ev('a', 1)] });
    await render(<HomeScreen />);
    await screen.findByTestId('hero-card');
    expect(bandIds()).toEqual(['later']);
    expect(screen.getByRole('header', { name: 'Later tonight, 1 event' })).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Coming up' })).toBeNull();
  });

  it('many: Live now, Later tonight, Staff picks, then Coming up, each with its count', async () => {
    list.mockResolvedValue({
      ok: true,
      events: [
        ev('fire', -1),
        ev('early', -1),
        ev('soon', 1),
        ev('pick', 24, { source: 'staff_pick' }),
        ev('mon', 48),
      ],
    });
    vibesFor.mockResolvedValue({ ok: true, vibes: { fire: live(9.2) } });
    await render(<HomeScreen />);
    await screen.findByTestId('hero-card');
    expect(bandIds()).toEqual(['live', 'later', 'picks']);
    expect(screen.getByRole('header', { name: 'Live now, 2 events' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Later tonight, 1 event' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Staff picks, 1 event' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Coming up' })).toBeOnTheScreen();
    // The live hero sits in the Live now band; the not-started event in Later tonight.
    expect(within(screen.getByTestId('band-live')).getByTestId('hero-card')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('band-later')).getByTestId('art-card').props.accessibilityLabel,
    ).toMatch(/^Party soon, /);
    // The staff pick is repeated: in its band and in its own night below.
    expect(screen.getAllByRole('button', { name: /^Party pick, / })).toHaveLength(2);
    // Day headings say their date and count.
    expect(screen.getByRole('header', { name: 'Tomorrow, Oct 18, 1 event' })).toBeOnTheScreen();
    expect(screen.getByText('MONDAY, OCT 19')).toBeOnTheScreen();
  });

  it('gives the Live now band the surface colour and a 2 px gold top line', async () => {
    list.mockResolvedValue({ ok: true, events: [ev('on', -1)] });
    await render(<HomeScreen />);
    const style = StyleSheet.flatten((await screen.findByTestId('band-live')).props.style);
    expect(style).toMatchObject({
      backgroundColor: colors.surface,
      borderTopWidth: 2,
      borderTopColor: colors.accent,
    });
  });
});

describe('See all', () => {
  it('picks the Tonight filter, and is gone once Tonight is picked', async () => {
    list.mockResolvedValue({ ok: true, events: [ev('a', 1), ev('b', 2)] });
    await render(<HomeScreen />);
    await screen.findByTestId('hero-card');
    await fireEvent.press(screen.getByRole('button', { name: SEE_ALL_TONIGHT_SPOKEN }));
    expect(list).toHaveBeenLastCalledWith(expect.any(Date), { kind: 'tonight' });
    expect(screen.getByRole('radio', { name: 'Tonight' }).props.accessibilityState).toMatchObject({
      checked: true,
    });
    await screen.findByTestId('hero-card');
    expect(screen.queryByRole('button', { name: SEE_ALL_TONIGHT_SPOKEN })).toBeNull();
  });
});

describe('special nights', () => {
  it('Halloween under Coming up: gold heading with its tag, and one gold-edged feature card', async () => {
    pinClock(THU_29);
    // Friday 30 at 10 PM, then Halloween (Saturday 31) at 9 PM and 10 PM.
    list.mockResolvedValue({ ok: true, events: [ev('fri', 26), ev('mask', 49), ev('cos', 50)] });
    await render(<HomeScreen />);
    const heading = await screen.findByTestId('day-heading-special');
    expect(heading.props.accessibilityLabel).toBe('Saturday, Oct 31, Halloween, 2 events');
    expect(within(heading).getByText('SATURDAY, OCT 31')).toBeOnTheScreen();
    expect(within(heading).getByText('HALLOWEEN')).toBeOnTheScreen();
    // Only the night's first event is the feature card; it says its night.
    const feature = screen.getByTestId('event-card-feature');
    expect(feature.props.accessibilityLabel).toMatch(/^Party mask, .+, Halloween$/);
    expect(StyleSheet.flatten(feature.props.style).borderColor).toBe(colors.accent);
    expect(screen.getAllByTestId('event-card-feature')).toHaveLength(1);
    // Friday (tomorrow) stays an ordinary night.
    expect(screen.getByRole('header', { name: 'Tomorrow, Oct 30, 1 event' })).toBeOnTheScreen();
  });

  it('on Halloween night, tonight’s band header carries the Halloween tag', async () => {
    pinClock(SAT_31);
    list.mockResolvedValue({ ok: true, events: [ev('party', 1)] });
    await render(<HomeScreen />);
    await screen.findByTestId('hero-card');
    expect(
      screen.getByRole('header', { name: 'Later tonight, Halloween, 1 event' }),
    ).toBeOnTheScreen();
  });

  it('on Halloween night, the hero (tonight’s first card) is the gold-edged feature card', async () => {
    // VC-84 polish (cto): before, tonight had the tag but no feature card.
    pinClock(SAT_31);
    list.mockResolvedValue({ ok: true, events: [ev('party', 1), ev('late', 2)] });
    await render(<HomeScreen />);
    const hero = await screen.findByTestId('hero-card');
    // Solid gold edge, the HALLOWEEN tag, and it says its night.
    expect(StyleSheet.flatten(hero.props.style).borderColor).toBe(colors.accent);
    expect(within(hero).getByText('HALLOWEEN')).toBeOnTheScreen();
    expect(hero.props.accessibilityLabel).toMatch(/^Party party, .+, Halloween$/);
    // Only one feature card for the night: the other tonight card stays plain.
    const other = screen.getByTestId('art-card');
    expect(StyleSheet.flatten(other.props.style).borderColor).not.toBe(colors.accent);
    expect(within(other).queryByText('HALLOWEEN')).toBeNull();
  });

  it('on an ordinary night the hero is not a feature card', async () => {
    list.mockResolvedValue({ ok: true, events: [ev('party', 1)] });
    await render(<HomeScreen />);
    const hero = await screen.findByTestId('hero-card');
    expect(StyleSheet.flatten(hero.props.style).borderColor).not.toBe(colors.accent);
    expect(hero.props.accessibilityLabel).not.toMatch(/Halloween/);
  });

  it('an ordinary week has no special heading, tag or feature card', async () => {
    list.mockResolvedValue({ ok: true, events: [ev('sun', 24), ev('mon', 48)] });
    await render(<HomeScreen />);
    await screen.findAllByTestId('day-heading');
    expect(screen.queryByTestId('day-heading-special')).toBeNull();
    expect(screen.queryByTestId('event-card-feature')).toBeNull();
    expect(screen.queryByText('HALLOWEEN')).toBeNull();
  });
});
