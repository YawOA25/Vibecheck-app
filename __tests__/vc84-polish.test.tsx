/**
 * Tests for the VC-84 polish fixes the cto asked for after the Home bands
 * merge (src/components/TonightCards.tsx and src/components/EventCard.tsx):
 *
 *   - the tonight carousel stays on the card the guest is looking at when
 *     cards leave or join it (an event starts and moves from Later tonight
 *     to Live now), without a stray "new card" tick, and a fresh carousel
 *     (a reload gives it a new key) still starts at the first card;
 *   - the hero card and the list card re-draw only when something they
 *     SHOW changes, not on every vibe poll (new "now", new vibe objects
 *     with the same values).
 *
 * (The Halloween feature hero is tested on the real screen in
 * __tests__/vc84-home-sections.test.tsx.)
 */
import { createElement } from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { ScrollView } from 'react-native';

import { EventCard } from '@/components/EventCard';
import { CAROUSEL_STEP, HeroCard, TonightCarousel } from '@/components/TonightCards';
import { tapSelection } from '@/lib/haptics';
import type { PublicEvent } from '@/lib/tonight';
import type { Vibe } from '@/lib/vibe';

jest.mock('@/lib/haptics', () => ({ tapSelection: jest.fn() }));
// The art is drawn with react-native-svg; these tests don't look at it.
jest.mock('@/components/GeneratedArt', () => ({ GeneratedArt: () => null }));

// How many times each card was drawn, by its testID ("hero-card",
// "event-card"). PressableScale is the outer view of both cards, so a
// stand-in that counts and then draws the real one counts card draws.
const mockDraws: Record<string, number> = {};
jest.mock('@/components/PressableScale', () => {
  const actual = jest.requireActual('@/components/PressableScale');
  const { createElement: make } = jest.requireActual('react');
  return {
    /**
     * Counts a draw under the card's testID, then draws the real wrapper.
     *
     * @param props - the real PressableScale's props.
     * @returns the real PressableScale.
     */
    PressableScale: (props: { testID?: string }) => {
      const id = props.testID ?? 'other';
      mockDraws[id] = (mockDraws[id] ?? 0) + 1;
      return make(actual.PressableScale, props);
    },
  };
});

const HOUR = 60 * 60 * 1000;
/** Saturday 17 Oct 2026, 8 PM New York (EDT). */
const NOW = new Date('2026-10-18T00:00:00Z');
/** One minute later (the next vibe poll). */
const NEXT_MINUTE = new Date(NOW.getTime() + 60 * 1000);

/**
 * Makes an event starting `startsInHours` from NOW, lasting 4 hours.
 *
 * @param id - its id; the title is "Party <id>".
 * @param startsInHours - hours to the start (negative: already started).
 * @returns a PublicEvent.
 */
function ev(id: string, startsInHours: number): PublicEvent {
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
  };
}

/**
 * Makes a live published vibe (a new object every call, like the server's).
 *
 * @param score - the live score.
 * @param label - its word.
 * @returns a Vibe.
 */
function live(score: number, label: Vibe['label']): Vibe {
  return {
    state: 'live',
    raters: 8,
    here: 10,
    score,
    label,
    nightAverage: null,
    minutesSinceLast: 2,
    reactions: [],
    breakdown: null,
    night: null,
  };
}

const onPress = jest.fn();
const tick = tapSelection as jest.Mock;
// The mocked ScrollView's scrollTo (one shared fake on its prototype); the
// carousel's FlatList moves through it.
const scrollTo = (ScrollView.prototype as unknown as { scrollTo: jest.Mock }).scrollTo;

/**
 * Pretends the guest swiped the carousel and it came to rest on a card.
 *
 * @param index - the card it rests on (0 = first).
 */
async function settleOn(index: number) {
  const carousel = screen.getByTestId('tonight-carousel');
  await act(async () => {
    carousel.props.onMomentumScrollEnd({
      nativeEvent: { contentOffset: { x: index * CAROUSEL_STEP, y: 0 } },
    });
  });
}

/**
 * Draws the carousel with the given cards.
 *
 * @param events - the carousel's events, in order.
 * @returns the carousel element.
 */
function carousel(events: PublicEvent[]) {
  return createElement(TonightCarousel, { events, vibes: {}, now: NOW, onPress, animate: false });
}

beforeEach(() => {
  tick.mockClear();
  scrollTo.mockClear();
  for (const id of Object.keys(mockDraws)) delete mockDraws[id];
});

describe('carousel keeps the viewed card (VC-84 polish)', () => {
  it('follows the viewed card when an earlier card leaves (it started)', async () => {
    const { rerender } = await render(carousel([ev('a', 1), ev('b', 2), ev('c', 3), ev('d', 4)]));
    // The guest swipes to c (third card): one tick.
    await settleOn(2);
    expect(tick).toHaveBeenCalledTimes(1);
    scrollTo.mockClear();

    // a starts and moves to Live now: c is now the second card, so the
    // carousel jumps (no animation) one step left to stay on c.
    await rerender(carousel([ev('b', 2), ev('c', 3), ev('d', 4)]));
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: CAROUSEL_STEP, animated: false }),
    );

    // Coming to rest there again is the same card: no stray tick.
    await settleOn(1);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('a card joining earlier in the list keeps the viewed card too', async () => {
    const { rerender } = await render(carousel([ev('b', 2), ev('c', 3)]));
    await settleOn(1);
    scrollTo.mockClear();
    // A new card arrives in front: c moves from place 1 to place 2.
    await rerender(carousel([ev('a', 1), ev('b', 2), ev('c', 3)]));
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: 2 * CAROUSEL_STEP, animated: false }),
    );
  });

  it('when the viewed card itself leaves, stays at the same place with no tick', async () => {
    const { rerender } = await render(carousel([ev('a', 1), ev('b', 2), ev('c', 3)]));
    await settleOn(1);
    expect(tick).toHaveBeenCalledTimes(1);
    scrollTo.mockClear();
    // b (the viewed card) leaves: c slides into its place; nothing jumps.
    await rerender(carousel([ev('a', 1), ev('c', 3)]));
    expect(scrollTo).not.toHaveBeenCalled();
    // Resting there is "the same card" now (c), so no stray tick.
    await settleOn(1);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('a fresh carousel (VC-80 reload: new key) starts at the first card', async () => {
    const events = [ev('a', 1), ev('b', 2), ev('c', 3)];
    const { rerender } = await render(
      createElement(TonightCarousel, {
        key: 1,
        events,
        vibes: {},
        now: NOW,
        onPress,
        animate: false,
      }),
    );
    await settleOn(2);
    scrollTo.mockClear();
    tick.mockClear();
    await rerender(
      createElement(TonightCarousel, {
        key: 2,
        events,
        vibes: {},
        now: NOW,
        onPress,
        animate: false,
      }),
    );
    // Back at the first card, and the first swipe after it ticks once.
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0, animated: false }));
    await settleOn(1);
    expect(tick).toHaveBeenCalledTimes(1);
  });
});

describe('cards skip re-draws that change nothing (VC-84 polish)', () => {
  it('the hero re-draws only when what it shows changes', async () => {
    const event = ev('a', -1);
    /**
     * Draws the hero with these inputs.
     *
     * @param now - the moment.
     * @param vibe - its vibe.
     * @returns the hero element.
     */
    const hero = (now: Date, vibe: Vibe) =>
      createElement(HeroCard, { event, kind: 'live', vibe, now, onPress, animate: false });
    const { rerender } = await render(hero(NOW, live(7.2, 'Hot')));
    expect(mockDraws['hero-card']).toBe(1);
    // A poll a minute later: new now, a new vibe object, same values.
    await rerender(hero(NEXT_MINUTE, live(7.2, 'Hot')));
    expect(mockDraws['hero-card']).toBe(1);
    // The score changed: it re-draws.
    await rerender(hero(NEXT_MINUTE, live(8.4, 'Fire')));
    expect(mockDraws['hero-card']).toBe(2);
  });

  it('a "Next up" hero still re-draws when its countdown moves', async () => {
    // Starts in 30 minutes: "Starts in 30 min" -> "29 min" a minute later.
    const event = ev('n', 0.5);
    /**
     * Draws the Next up hero at a moment.
     *
     * @param now - the moment.
     * @returns the hero element.
     */
    const hero = (now: Date) =>
      createElement(HeroCard, { event, kind: 'next', now, onPress, animate: false });
    const { rerender } = await render(hero(NOW));
    await rerender(hero(NEXT_MINUTE));
    expect(mockDraws['hero-card']).toBe(2);
  });

  it('a list card re-draws only when what it shows changes', async () => {
    const event = ev('a', -1);
    /**
     * Draws the list card with these inputs.
     *
     * @param now - the moment.
     * @param vibe - its vibe.
     * @returns the card element.
     */
    const card = (now: Date, vibe: Vibe) => createElement(EventCard, { event, vibe, now, onPress });
    const { rerender } = await render(card(NOW, live(7.2, 'Hot')));
    expect(mockDraws['event-card']).toBe(1);
    await rerender(card(NEXT_MINUTE, live(7.2, 'Hot')));
    expect(mockDraws['event-card']).toBe(1);
    await rerender(card(NEXT_MINUTE, live(8.4, 'Fire')));
    expect(mockDraws['event-card']).toBe(2);
    // A feature (special night) change re-draws it too.
    await rerender(
      createElement(EventCard, {
        event,
        vibe: live(8.4, 'Fire'),
        now: NEXT_MINUTE,
        onPress,
        feature: 'Halloween',
      }),
    );
    expect(mockDraws['event-card-feature']).toBe(1);
  });
});
