/**
 * Tests for Q6 "home polish and motion" on the home list
 * (app/(tabs)/index.tsx) and the event card (src/components/EventCard.tsx).
 *
 * The list read, the vibes call, sign-in and the router are fakes, and the
 * phone's Reduce Motion answer is set per test. We check:
 *   - fix #2: the picked date chip is solid gold with dark words (v3's
 *     single-select look);
 *   - fix #8: three card-shaped skeleton blocks while the list loads;
 *   - the error state's alert icon and the empty card's moon;
 *   - VC-72: a card shrinks to 0.98 over 120 ms while pressed (and, since
 *     VC-76, springs back on release), and the list fades in over 200 ms
 *     when a load lands; with Reduce Motion on, neither happens (the list
 *     shows at full strength straight away);
 *   - VC-76: pull to refresh does NOT fade (no blink); a filter change keeps
 *     the old list dimmed to 40% and untappable, then fades the new one in.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';

import HomeScreen, { DIMMED_OPACITY, EMPTY_TITLE, LIST_FADE_MS } from '../app/(tabs)/index';
import { EventCard, PRESS_MS, PRESS_SCALE } from '@/components/EventCard';
import { listHomeEvents } from '@/lib/events-read';
import type { PublicEvent } from '@/lib/tonight';
import { getEventsVibe } from '@/lib/vibe-api';
import { colors } from '@/theme';

jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/events-read', () => ({ listHomeEvents: jest.fn() }));
jest.mock('@/lib/sentry', () => ({ sendTestError: jest.fn(() => true) }));
jest.mock('@/lib/vibe-api', () => ({ getEventsVibe: jest.fn() }));
// The "mock" prefix lets jest.mock (which runs first) use this fake.
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
const HOUR = 60 * 60 * 1000;
let timingSpy: jest.SpyInstance;

/**
 * Makes a test event starting in an hour (not started, so no vibe).
 *
 * @param id - the event's id.
 * @returns a PublicEvent.
 */
function makeEvent(id = 'e1'): PublicEvent {
  const starts = new Date(Date.now() + HOUR);
  return {
    id,
    title: `Rooftop ${id}`,
    area_label: 'Shaw, DC',
    starts_at: starts.toISOString(),
    ends_at: new Date(starts.getTime() + 4 * HOUR).toISOString(),
    source: 'host',
    ticket_url: null,
    summary: null,
    is_21_plus: false,
    is_test: false,
  } as PublicEvent;
}

/**
 * Makes the phone answer the Reduce Motion question.
 *
 * @param on - true when Reduce Motion is on.
 */
function setReduceMotion(on: boolean) {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(on);
}

/**
 * The Animated.timing calls made so far, as their settings objects.
 *
 * @returns e.g. [{ toValue: 1, duration: 200, ... }].
 */
function timings() {
  return timingSpy.mock.calls.map((call) => call[1]);
}

beforeEach(() => {
  jest.clearAllMocks();
  timingSpy = jest.spyOn(Animated, 'timing');
  list.mockResolvedValue({ ok: true, events: [makeEvent()] });
  (getEventsVibe as jest.Mock).mockResolvedValue({ ok: true, vibes: {} });
});

afterEach(() => jest.restoreAllMocks());

describe('Home header (fix #2)', () => {
  it('the picked date chip is solid gold with dark words', async () => {
    setReduceMotion(true);
    await render(<HomeScreen />);
    const picked = screen.getByRole('radio', { name: 'This week' });
    // VC-76: the gold fill is the chip's picked layer (it fades in on a
    // change), fully shown on the picked chip, hidden on the others.
    const layer = within(picked).getByTestId('chip-selected-layer');
    expect(StyleSheet.flatten(layer.props.style).backgroundColor).toBe(colors.accent);
    expect(StyleSheet.flatten(layer.props.style).opacity).toBe(1);
    // The title says "This week" too, so look for the words inside the chip.
    expect(StyleSheet.flatten(within(picked).getByText('This week').props.style).color).toBe(
      colors.onAccent,
    );
    // An unpicked chip stays clear.
    const other = screen.getByRole('radio', { name: 'Tonight' });
    expect(StyleSheet.flatten(other.props.style).backgroundColor).toBe('transparent');
    expect(
      StyleSheet.flatten(within(other).getByTestId('chip-selected-layer').props.style).opacity,
    ).toBe(0);
  });
});

describe('Home states (fix #8 and icons)', () => {
  it('shows three skeleton cards, not a spinner, while loading', async () => {
    setReduceMotion(true);
    list.mockReturnValue(new Promise(() => {}));
    await render(<HomeScreen />);
    expect(screen.getByLabelText('Loading events')).toBeOnTheScreen();
    expect(screen.getByTestId('list-skeleton')).toBeOnTheScreen();
    expect(screen.getAllByTestId('skeleton-block')).toHaveLength(3);
  });

  it('shows the alert icon over the announced error sentence', async () => {
    setReduceMotion(true);
    list.mockResolvedValue({ ok: false, message: "We couldn't load events." });
    await render(<HomeScreen />);
    expect(await screen.findByTestId('status-icon-alert')).toBeOnTheScreen();
    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load events.");
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });

  it('puts the moon above the empty card heading', async () => {
    setReduceMotion(true);
    list.mockResolvedValue({ ok: true, events: [] });
    await render(<HomeScreen />);
    expect(await screen.findByRole('header', { name: EMPTY_TITLE })).toBeOnTheScreen();
    expect(screen.getByTestId('empty-moon')).toBeOnTheScreen();
  });
});

describe('Home motion (VC-72)', () => {
  it('fades the list in over 200 ms when a load lands', async () => {
    setReduceMotion(false);
    await render(<HomeScreen />);
    await screen.findByText('Rooftop e1');
    expect(timings()).toContainEqual(
      expect.objectContaining({ toValue: 1, duration: LIST_FADE_MS }),
    );
  });

  it('shrinks a pressed card to 0.98 over 120 ms, and back on release', async () => {
    setReduceMotion(false);
    await render(<HomeScreen />);
    const card = await screen.findByRole('button', { name: /Rooftop e1/ });
    timingSpy.mockClear();
    await fireEvent(card, 'pressIn');
    expect(timings()).toEqual([
      expect.objectContaining({ toValue: PRESS_SCALE, duration: PRESS_MS }),
    ]);
    const springSpy = jest.spyOn(Animated, 'spring');
    await fireEvent(card, 'pressOut');
    // VC-76: release springs back (quick, no wobble) instead of a timing.
    expect(springSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: 1, speed: 40, bounciness: 0 }),
    );
    expect(PRESS_SCALE).toBe(0.98);
    expect(PRESS_MS).toBe(120);
  });

  it('under Reduce Motion: no fade (full strength) and no press scale', async () => {
    setReduceMotion(true);
    await render(<HomeScreen />);
    const card = await screen.findByRole('button', { name: /Rooftop e1/ });
    expect(StyleSheet.flatten(screen.getByTestId('tonight-list-fade').props.style).opacity).toBe(1);
    await fireEvent(card, 'pressIn');
    await fireEvent(card, 'pressOut');
    expect(timings()).toEqual([]);
  });
});

describe('EventCard press scale', () => {
  it('is off unless the screen asks for it', async () => {
    await render(<EventCard event={makeEvent()} now={new Date()} onPress={() => {}} />);
    await fireEvent(screen.getByRole('button'), 'pressIn');
    expect(timings()).toEqual([]);
  });
});

describe('Home refresh and filter change (VC-76)', () => {
  /** The fade-in calls for the list (200 ms, to full strength). */
  function listFades() {
    return timings().filter((t) => t.toValue === 1 && t.duration === LIST_FADE_MS);
  }

  it('pull to refresh swaps the list in place: no fade, so nothing blinks', async () => {
    setReduceMotion(false);
    await render(<HomeScreen />);
    await screen.findByText('Rooftop e1');
    timingSpy.mockClear();
    list.mockResolvedValue({ ok: true, events: [makeEvent('e2')] });
    const refresh = screen.getByTestId('tonight-list').props.refreshControl.props.onRefresh;
    await act(async () => {
      await refresh();
    });
    expect(await screen.findByText('Rooftop e2')).toBeOnTheScreen();
    // No new fade started, so the list never went see-through.
    expect(listFades()).toEqual([]);
  });

  it('a filter change keeps the old list dimmed and untappable, then fades the new one in', async () => {
    setReduceMotion(false);
    await render(<HomeScreen />);
    await screen.findByText('Rooftop e1');
    timingSpy.mockClear();
    // The new filter's list hasn't come back yet.
    let land: (value: unknown) => void = () => {};
    list.mockReturnValue(new Promise((resolve) => (land = resolve)));
    await fireEvent.press(screen.getByRole('radio', { name: 'Tonight' }));
    const dim = screen.getByTestId('tonight-list-dim');
    expect(StyleSheet.flatten(dim.props.style).opacity).toBe(DIMMED_OPACITY);
    expect(dim.props.pointerEvents).toBe('none');
    // The old card is still there (no skeleton) while waiting.
    expect(screen.getByText('Rooftop e1')).toBeOnTheScreen();
    expect(screen.queryByTestId('list-skeleton')).toBeNull();
    await act(async () => land({ ok: true, events: [makeEvent('e3')] }));
    expect(await screen.findByText('Rooftop e3')).toBeOnTheScreen();
    expect(StyleSheet.flatten(screen.getByTestId('tonight-list-dim').props.style).opacity).toBe(
      undefined,
    );
    expect(listFades()).toHaveLength(1);
  });
});
