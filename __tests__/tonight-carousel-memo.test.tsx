/**
 * Tests that the tonight carousel (src/components/TonightCards.tsx) only
 * re-draws the cards whose look really changed (VC-80 polish, cto review).
 *
 * The home screen hands the carousel a new "now" every minute and brand new
 * vibe objects on every vibe refresh, even when nothing changed. Before the
 * fix that re-drew every card each time. We count how often each card's
 * art is drawn (the art is a fake that just counts) and check:
 *   - a minute tick with the same scores re-draws only the card whose
 *     countdown moved ("Starts in 59 min" -> "58 min");
 *   - a vibe refresh where one score changed re-draws only that card.
 */
import { render } from '@testing-library/react-native';

import { TonightCarousel } from '@/components/TonightCards';
import type { PublicEvent } from '@/lib/tonight';
import type { Vibe } from '@/lib/vibe';

// How many times each card's art was drawn, by event id (the art's seed).
const mockArtDraws: Record<string, number> = {};
jest.mock('@/components/GeneratedArt', () => ({
  /**
   * A stand-in for the generated art that only counts its draws.
   *
   * @param props.seed - the event id the art is made from.
   * @returns nothing visible.
   */
  GeneratedArt: ({ seed }: { seed: string }) => {
    mockArtDraws[seed] = (mockArtDraws[seed] ?? 0) + 1;
    return null;
  },
}));
jest.mock('@/lib/haptics', () => ({ tapSelection: jest.fn() }));

const HOUR = 60 * 60 * 1000;
/** Saturday 17 Oct 2026, 8 PM New York (EDT). */
const NOW = new Date('2026-10-18T00:00:00Z');
/** One minute later (the next vibe refresh). */
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

// a and b are on now; c starts in an hour (it shows a countdown).
const EVENTS = [ev('a', -1), ev('b', -1), ev('c', 1)];
const onPress = jest.fn();

/** Forgets the draw counts, so the next step counts from zero. */
function resetDraws() {
  for (const id of Object.keys(mockArtDraws)) delete mockArtDraws[id];
}

describe('carousel re-draws', () => {
  it('re-draws only the cards whose look changed', async () => {
    const { rerender } = await render(
      <TonightCarousel
        events={EVENTS}
        vibes={{ a: live(7.2, 'Hot'), b: live(5.1, 'Good') }}
        now={NOW}
        onPress={onPress}
        animate
      />,
    );
    // First draw: every card once.
    expect(mockArtDraws).toEqual({ a: 1, b: 1, c: 1 });

    // A minute later, same scores (but new objects): only c's countdown moved.
    resetDraws();
    await rerender(
      <TonightCarousel
        events={EVENTS}
        vibes={{ a: live(7.2, 'Hot'), b: live(5.1, 'Good') }}
        now={NEXT_MINUTE}
        onPress={onPress}
        animate
      />,
    );
    expect(mockArtDraws).toEqual({ c: 1 });

    // Same moment, b's score changed: only b re-draws.
    resetDraws();
    await rerender(
      <TonightCarousel
        events={EVENTS}
        vibes={{ a: live(7.2, 'Hot'), b: live(8.4, 'Fire') }}
        now={NEXT_MINUTE}
        onPress={onPress}
        animate
      />,
    );
    expect(mockArtDraws).toEqual({ b: 1 });
  });
});
