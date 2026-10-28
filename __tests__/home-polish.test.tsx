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
 *   - VC-72: a card shrinks to 0.98 over 120 ms while pressed, and the list
 *     fades in over 200 ms when a load lands; with Reduce Motion on, neither
 *     happens (the list shows at full strength straight away).
 */
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';

import HomeScreen, { EMPTY_TITLE, LIST_FADE_MS } from '../app/(tabs)/index';
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
    expect(StyleSheet.flatten(picked.props.style).backgroundColor).toBe(colors.accent);
    // The title says "This week" too, so look for the words inside the chip.
    expect(StyleSheet.flatten(within(picked).getByText('This week').props.style).color).toBe(
      colors.onAccent,
    );
    // An unpicked chip stays clear.
    const other = screen.getByRole('radio', { name: 'Tonight' });
    expect(StyleSheet.flatten(other.props.style).backgroundColor).toBe('transparent');
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
    await fireEvent(card, 'pressOut');
    expect(timings()[1]).toEqual(expect.objectContaining({ toValue: 1, duration: PRESS_MS }));
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
