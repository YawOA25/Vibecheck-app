/**
 * Tests for the VC-80 home redesign (Concept A "Live hero + carousel") on
 * the home screen (app/(tabs)/index.tsx) and its cards
 * (src/components/TonightCards.tsx, src/components/LiveDot.tsx).
 *
 * The list read, the vibes call, sign-in, the router and the haptics are
 * fakes; the phone's Reduce Motion answer is set per test. Only the Date is
 * pinned (Saturday 17 Oct 2026, 8 PM New York), so "tonight" never slips
 * into tomorrow when the tests run near 5 AM New York; every other timer
 * stays real. We check:
 *   - the hero rule: the live event with the highest published live score,
 *     "ON FIRE RIGHT NOW" with the mini gauge, the LIVE pill and the gold
 *     edge; with no live score "NEXT UP": the soonest event still to start,
 *     no gauge, no LIVE, a countdown;
 *   - the states: 1 event (hero only), 2 (hero + one wide card), 3+ (hero +
 *     carousel, each card saying "2 of 3"), none tonight (the moon note,
 *     then the later nights), and the TEST chip on a test event;
 *   - later nights: under "LATER THIS WEEK", with sticky day headings;
 *   - motion: the carousel's neighbours at 94% with their art shifted 12 px
 *     and the LIVE dot pulsing, the header title set to shrink; none of it
 *     under Reduce Motion;
 *   - haptics: a tick on a chip pick and on the carousel settling on a new
 *     card, a light tap on pull to refresh, and no stray tick (carousel or
 *     day heading) after the list reloads.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';

import HomeScreen from '../app/(tabs)/index';
import {
  CAROUSEL_STEP,
  NEIGHBOUR_SCALE,
  PARALLAX_PX,
  STARTS_WORD,
} from '@/components/TonightCards';
import { useAuth } from '@/lib/auth-context';
import { listHomeEvents } from '@/lib/events-read';
import { tapLight, tapSelection } from '@/lib/haptics';
import { NEXT_UP_LABEL, ON_FIRE_LABEL } from '@/lib/home-layout';
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
// The Map side of Tonight reads through supabase; these tests stay on the list.
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
/** Saturday 17 Oct 2026, 8 PM New York (EDT). */
const NOW = new Date('2026-10-18T00:00:00Z');

/**
 * Makes an event starting `startsInHours` from NOW, lasting 4 hours.
 *
 * @param id - its id; the title is "Party <id>".
 * @param startsInHours - hours to the start (negative: already started).
 * @param overrides - other fields to change.
 * @returns a PublicEvent.
 */
function ev(id: string, startsInHours: number, overrides: Partial<PublicEvent> = {}): PublicEvent {
  const starts = new Date(NOW.getTime() + startsInHours * HOUR);
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
 * Makes a live published vibe.
 *
 * @param score - the live score.
 * @param label - its word.
 * @param here - how many are here.
 * @returns a Vibe.
 */
function live(score: number, label: Vibe['label'], here = 10): Vibe {
  return {
    state: 'live',
    raters: 8,
    here,
    score,
    label,
    nightAverage: null,
    minutesSinceLast: 2,
    reactions: [],
    breakdown: null,
    night: null,
  };
}

/**
 * Makes the phone answer the Reduce Motion question.
 *
 * @param on - true when Reduce Motion is on.
 */
function setReduceMotion(on: boolean) {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(on);
  resetReduceMotionForTests(on);
}

/**
 * Reads one transform entry (e.g. scale) from a view's style.
 *
 * @param node - the drawn view.
 * @param key - 'scale' or 'translateX'.
 * @returns the value, or undefined when there is no such transform.
 */
function transformOf(node: { props: Record<string, unknown> }, key: string): unknown {
  const style = StyleSheet.flatten(node.props.style as never) as {
    transform?: Record<string, unknown>[];
  };
  return style.transform?.find((t) => key in t)?.[key];
}

beforeEach(() => {
  jest.clearAllMocks();
  // Pin only the clock's date (and let it run on in real time, so
  // animations still finish); timers and animation frames stay real.
  jest.useFakeTimers({
    now: NOW,
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
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'user-1', display_name: 'Ava', role: 'user', is_tester: false },
  });
  vibesFor.mockResolvedValue({ ok: true, vibes: {} });
  setReduceMotion(false);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the hero card', () => {
  it('shows the live event with the highest live score: label, gauge, LIVE, gold edge', async () => {
    list.mockResolvedValue({
      ok: true,
      events: [ev('good', -1), ev('fire', -2), ev('later', 2)],
    });
    vibesFor.mockResolvedValue({
      ok: true,
      vibes: { good: live(6.4, 'Good'), fire: live(9.1, 'Fire', 74) },
    });
    await render(<HomeScreen />);

    expect(await screen.findByRole('header', { name: ON_FIRE_LABEL })).toBeOnTheScreen();
    const hero = screen.getByTestId('hero-card');
    expect(hero.props.accessibilityLabel).toMatch(
      /^Party fire, .+, 74 here, vibe 9\.1 out of 10, Fire$/,
    );
    // The mini gauge with the score and word, inside the hero.
    expect(within(hero).getByTestId('vibe-meter')).toBeOnTheScreen();
    expect(await within(hero).findByText('9.1')).toBeOnTheScreen();
    // The LIVE pill (decoration, hidden from screen readers).
    expect(within(hero).getByTestId('live-pill', { includeHiddenElements: true })).toBeTruthy();
    // VC-77: a live Fire score gets the gold edge.
    expect(StyleSheet.flatten(hero.props.style).borderColor).toBe(colors.goldBorder);

    await fireEvent.press(hero);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/event/[id]', params: { id: 'fire' } });
  });

  it('with no live score: "Next up" is the soonest event still to start, with no gauge or LIVE', async () => {
    list.mockResolvedValue({
      ok: true,
      // "early" is on now but only has an Early reading; "soon" starts in 40 min.
      events: [ev('early', -1), ev('soon', 40 / 60), ev('late', 3)],
    });
    vibesFor.mockResolvedValue({
      ok: true,
      vibes: { early: { ...live(0, null), state: 'early', score: null, raters: 3 } },
    });
    await render(<HomeScreen />);

    expect(await screen.findByRole('header', { name: NEXT_UP_LABEL })).toBeOnTheScreen();
    const hero = screen.getByTestId('hero-card');
    expect(hero.props.accessibilityLabel).toMatch(/^Party soon, /);
    expect(within(hero).queryByTestId('vibe-meter')).toBeNull();
    expect(within(hero).queryByTestId('live-pill', { includeHiddenElements: true })).toBeNull();
    expect(within(hero).getByText(STARTS_WORD)).toBeOnTheScreen();
    expect(within(hero).getByText('in 40 min')).toBeOnTheScreen();
  });

  it('marks a test event with the TEST chip', async () => {
    list.mockResolvedValue({ ok: true, events: [ev('t', 1, { is_test: true })] });
    await render(<HomeScreen />);
    const hero = await screen.findByTestId('hero-card');
    expect(within(hero).getByText('TEST')).toBeOnTheScreen();
    expect(hero.props.accessibilityLabel).toMatch(/^Party t, Test event, /);
  });
});

describe('tonight states', () => {
  it('1 event: the hero only', async () => {
    list.mockResolvedValue({ ok: true, events: [ev('a', 1)] });
    await render(<HomeScreen />);
    await screen.findByTestId('hero-card');
    expect(screen.queryByTestId('art-card')).toBeNull();
    expect(screen.queryByTestId('tonight-carousel')).toBeNull();
    expect(screen.queryByText(/ON TONIGHT/)).toBeNull();
  });

  it('2 events: the hero plus one wide art card, no carousel', async () => {
    list.mockResolvedValue({ ok: true, events: [ev('a', 1), ev('b', 2)] });
    await render(<HomeScreen />);
    await screen.findByTestId('hero-card');
    expect(screen.getByText('ON TONIGHT · 1 MORE')).toBeOnTheScreen();
    expect(screen.getAllByTestId('art-card')).toHaveLength(1);
    expect(screen.queryByTestId('tonight-carousel')).toBeNull();
    expect(screen.getByTestId('art-card').props.accessibilityLabel).toMatch(/^Party b, /);
  });

  it('3 or more: the hero plus the carousel, each card saying its place', async () => {
    list.mockResolvedValue({ ok: true, events: [ev('a', 1), ev('b', 2), ev('c', 3)] });
    await render(<HomeScreen />);
    await screen.findByTestId('tonight-carousel');
    expect(screen.getByText('ON TONIGHT · 2 MORE')).toBeOnTheScreen();
    const cards = screen.getAllByTestId('art-card');
    expect(cards.map((c) => c.props.accessibilityLabel)).toEqual([
      expect.stringMatching(/^Party b, .+, 1 of 2$/),
      expect.stringMatching(/^Party c, .+, 2 of 2$/),
    ]);
    await fireEvent.press(cards[1]);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/event/[id]', params: { id: 'c' } });
  });

  it('none tonight: the moon note, then the later nights with sticky headings', async () => {
    list.mockResolvedValue({ ok: true, events: [ev('sun', 24), ev('mon', 48)] });
    await render(<HomeScreen />);
    expect(await screen.findByText('Nothing on tonight yet')).toBeOnTheScreen();
    expect(screen.getByText("Here's what's coming up this week.")).toBeOnTheScreen();
    expect(screen.queryByTestId('hero-card')).toBeNull();
    expect(screen.getByText('TOMORROW')).toBeOnTheScreen();
    expect(screen.getByText('MONDAY')).toBeOnTheScreen();
    // Day headings stick (the list marks them as sticky rows).
    expect(screen.getByTestId('tonight-list').props.stickyHeaderIndices.length).toBeGreaterThan(0);
  });

  it('tonight plus later nights: the later nights sit under "LATER THIS WEEK"', async () => {
    list.mockResolvedValue({ ok: true, events: [ev('a', 1), ev('sun', 24)] });
    await render(<HomeScreen />);
    expect(await screen.findByText('LATER THIS WEEK')).toBeOnTheScreen();
    expect(screen.getByText('TOMORROW')).toBeOnTheScreen();
    expect(screen.queryByText('Nothing on tonight yet')).toBeNull();
    // The later event is an ordinary list card.
    expect(screen.getByTestId('event-card').props.accessibilityLabel).toMatch(/^Party sun, /);
  });
});

describe('motion', () => {
  const threeLive = [ev('a', -1), ev('b', -1), ev('c', -1)];

  it('carousel neighbours at 94% with their art shifted 12 px; the LIVE dot pulses; the title shrinks', async () => {
    const loopSpy = jest.spyOn(Animated, 'loop');
    list.mockResolvedValue({ ok: true, events: threeLive });
    await render(<HomeScreen />);
    await screen.findByTestId('tonight-carousel');
    const slots = screen.getAllByTestId('art-card-slot');
    // At rest the first carousel card is in the middle: full size; the next one 94%.
    expect(transformOf(slots[0], 'scale')).toBe(1);
    expect(transformOf(slots[1], 'scale')).toBe(NEIGHBOUR_SCALE);
    const arts = screen.getAllByTestId('art-card-art', { includeHiddenElements: true });
    expect(transformOf(arts[1], 'translateX')).toBe(-PARALLAX_PX);
    expect(loopSpy).toHaveBeenCalled();
    // The header title is set up to shrink with the scroll.
    expect(transformOf(screen.getByTestId('tonight-title'), 'scale')).toBe(1);
  });

  it('under Reduce Motion: no scaling, parallax, pulse or title shrink', async () => {
    setReduceMotion(true);
    const loopSpy = jest.spyOn(Animated, 'loop');
    list.mockResolvedValue({ ok: true, events: threeLive });
    await render(<HomeScreen />);
    await screen.findByTestId('tonight-carousel');
    const slots = screen.getAllByTestId('art-card-slot');
    expect(transformOf(slots[1], 'scale')).toBe(1);
    const arts = screen.getAllByTestId('art-card-art', { includeHiddenElements: true });
    expect(transformOf(arts[1], 'translateX')).toBe(0);
    expect(loopSpy).not.toHaveBeenCalled();
    expect(transformOf(screen.getByTestId('tonight-title'), 'scale')).toBeUndefined();
  });
});

describe('haptics', () => {
  it('ticks on a chip pick, and on the carousel settling on a new card only', async () => {
    list.mockResolvedValue({ ok: true, events: [ev('a', 1), ev('b', 2), ev('c', 3)] });
    await render(<HomeScreen />);
    const carousel = await screen.findByTestId('tonight-carousel');

    // Settling back on the same card: no tick.
    await fireEvent(carousel, 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 0, y: 0 } },
    });
    expect(tapSelection).not.toHaveBeenCalled();
    // Settling on the next card: one tick.
    await fireEvent(carousel, 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: CAROUSEL_STEP, y: 0 } },
    });
    expect(tapSelection).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole('radio', { name: 'Tonight' }));
    expect(tapSelection).toHaveBeenCalledTimes(2);
  });

  it('gives no stray carousel tick on the first swipe after a reload', async () => {
    // Hero "a" (Next up), carousel b, c, d.
    list.mockResolvedValue({
      ok: true,
      events: [ev('a', 1), ev('b', 2), ev('c', 3), ev('d', 4)],
    });
    await render(<HomeScreen />);
    // Settle on the third carousel card: one tick.
    await fireEvent(await screen.findByTestId('tonight-carousel'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 2 * CAROUSEL_STEP, y: 0 } },
    });
    expect(tapSelection).toHaveBeenCalledTimes(1);

    // Pull to refresh brings a new list.
    list.mockResolvedValue({ ok: true, events: [ev('a', 1), ev('e', 2), ev('f', 3)] });
    await act(async () => {
      await screen.getByTestId('tonight-list').props.refreshControl.props.onRefresh();
    });
    await screen.findByRole('button', { name: /Party e/ });
    // The reloaded carousel starts over at its first card, so stopping
    // there is no "new card" (before the fix it still remembered card 3).
    await fireEvent(screen.getByTestId('tonight-carousel'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 0, y: 0 } },
    });
    expect(tapSelection).toHaveBeenCalledTimes(1);
  });

  it('gives no stray day-heading tick when a reloaded list first draws', async () => {
    // Nothing tonight: only later nights, so the list has day sections.
    list.mockResolvedValue({ ok: true, events: [ev('a', 24), ev('b', 48)] });
    await render(<HomeScreen />);
    await screen.findByTestId('tonight-list');
    /**
     * Tells the list which row is at the top, as React Native would. The
     * section list works the night out from the row's place: each night is
     * a heading, its cards, then an end row, so row 1 is the first night's
     * card and row 4 the second night's card.
     *
     * @param index - the row's place in the whole list.
     */
    const topIs = (index: number) =>
      act(() => {
        screen.getByTestId('tonight-list').props.onViewableItemsChanged({
          viewableItems: [{ isViewable: true, item: ev('a', 24), key: String(index), index }],
          changed: [],
        });
      });
    await topIs(1);
    // The person scrolls on to the next night: one tick.
    await act(() => screen.getByTestId('tonight-list').props.onScrollBeginDrag());
    await topIs(4);
    expect(tapSelection).toHaveBeenCalledTimes(1);

    // A pull to refresh reloads; the new list draws its first night.
    await act(async () => {
      await screen.getByTestId('tonight-list').props.refreshControl.props.onRefresh();
    });
    await topIs(1);
    // That first draw is not the person's own scrolling: no tick.
    expect(tapSelection).toHaveBeenCalledTimes(1);
  });

  it('gives a light tap when a pull to refresh starts', async () => {
    list.mockResolvedValue({ ok: true, events: [ev('a', 1)] });
    await render(<HomeScreen />);
    await screen.findByTestId('hero-card');
    // Pulling down calls the list's RefreshControl `onRefresh`.
    await act(async () => {
      await screen.getByTestId('tonight-list').props.refreshControl.props.onRefresh();
    });
    expect(tapLight).toHaveBeenCalledTimes(1);
  });
});
