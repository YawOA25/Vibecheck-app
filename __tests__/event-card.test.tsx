/**
 * Tests for the event card on the Tonight list (src/components/EventCard.tsx),
 * Q5 fix #6.
 *
 * We check:
 *   - the vibe word on a card takes the same colour as on the gauge (Quiet
 *     grey, Good darker gold, Hot gold, Fire bright gold), and a stale word
 *     stays grey;
 *   - the small gold LIVE dot shows only once the event has started (and
 *     not after it ended), never before, whatever vibe was passed in;
 *   - the LIVE dot doesn't change what screen readers hear (the "On now"
 *     line already says it).
 */
import { render, screen } from '@testing-library/react-native';

import { LIVE_LABEL, EventCard } from '@/components/EventCard';
import { wordColour } from '@/components/VibeMeter';
import type { VibeLabel } from '@/lib/rating';
import type { PublicEvent } from '@/lib/tonight';
import type { Vibe } from '@/lib/vibe';
import { colors } from '@/theme';

const HOUR = 60 * 60 * 1000;
/** A fixed "now" for every test, so start times are exact. */
const NOW = new Date('2026-10-30T23:00:00Z');

/**
 * Makes a test event that lasts 4 hours.
 *
 * @param startsInMs - when it starts, from NOW (negative: already started).
 * @returns a PublicEvent.
 */
function makeEvent(startsInMs: number): PublicEvent {
  const starts = new Date(NOW.getTime() + startsInMs);
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
  };
}

/**
 * Makes a vibe for the card.
 *
 * @param overrides - fields to change from a live 8.0 Hot vibe.
 * @returns a Vibe.
 */
function makeVibe(overrides: Partial<Vibe> = {}): Vibe {
  return {
    state: 'live',
    raters: 6,
    here: 12,
    score: 8,
    label: 'Hot',
    nightAverage: null,
    minutesSinceLast: 4,
    reactions: [],
    breakdown: null,
    night: null,
    ...overrides,
  };
}

/** A sample score for each word, so the number and the word agree. */
const SCORES: Record<VibeLabel, number> = { Quiet: 2.5, Good: 6, Hot: 8, Fire: 9.2 };

describe('EventCard vibe word colour (Q5 fix #6)', () => {
  it.each(Object.keys(SCORES) as VibeLabel[])('draws "%s" in its gauge colour', async (label) => {
    await render(
      <EventCard
        event={makeEvent(-HOUR)}
        now={NOW}
        onPress={jest.fn()}
        vibe={makeVibe({ score: SCORES[label], label })}
      />,
    );
    const word = screen.getByTestId('event-card-word', { includeHiddenElements: true });
    expect(word).toHaveTextContent(label);
    expect(word).toHaveStyle({ color: wordColour(label) });
  });

  it('keeps the ramp in step with the gauge (Fire brightest, Quiet grey)', () => {
    expect(wordColour('Quiet')).toBe(colors.muted);
    expect(wordColour('Good')).toBe(colors.accentPressed);
    expect(wordColour('Hot')).toBe(colors.accent);
    expect(wordColour('Fire')).toBe(colors.accentHover);
  });

  it('draws a stale word in grey, whatever the word', async () => {
    await render(
      <EventCard
        event={makeEvent(-HOUR)}
        now={NOW}
        onPress={jest.fn()}
        vibe={makeVibe({ state: 'stale', score: 9.2, label: 'Fire' })}
      />,
    );
    expect(screen.getByTestId('event-card-word', { includeHiddenElements: true })).toHaveStyle({
      color: colors.muted,
    });
  });
});

describe('EventCard LIVE dot (Q5 fix #6)', () => {
  /** The LIVE row, or null (the whole card is one button, so its parts are "hidden"). */
  const liveRow = () => screen.queryByTestId('event-card-live', { includeHiddenElements: true });

  it('shows a gold dot and LIVE once the event has started', async () => {
    await render(
      <EventCard event={makeEvent(-HOUR)} now={NOW} onPress={jest.fn()} vibe={makeVibe()} />,
    );
    expect(liveRow()).not.toBeNull();
    expect(screen.getByText(LIVE_LABEL, { includeHiddenElements: true })).toBeTruthy();
    // The dot is a 6 px gold circle, as in v3.
    expect(screen.getByTestId('event-card-live-dot', { includeHiddenElements: true })).toHaveStyle({
      width: 6,
      height: 6,
      backgroundColor: colors.accent,
    });
  });

  it('shows LIVE for a started event even before its vibe has loaded', async () => {
    await render(<EventCard event={makeEvent(-HOUR)} now={NOW} onPress={jest.fn()} />);
    expect(liveRow()).not.toBeNull();
  });

  it('shows no LIVE dot before the start, even with a vibe passed in', async () => {
    await render(
      <EventCard event={makeEvent(HOUR)} now={NOW} onPress={jest.fn()} vibe={makeVibe()} />,
    );
    expect(liveRow()).toBeNull();
    expect(screen.queryByText(LIVE_LABEL, { includeHiddenElements: true })).toBeNull();
  });

  it('shows LIVE at the exact start time, but not after the end', async () => {
    await render(<EventCard event={makeEvent(0)} now={NOW} onPress={jest.fn()} />);
    expect(liveRow()).not.toBeNull();
    await screen.unmount();
    await render(<EventCard event={makeEvent(-5 * HOUR)} now={NOW} onPress={jest.fn()} />);
    expect(liveRow()).toBeNull();
  });

  it("doesn't change what screen readers hear", async () => {
    await render(
      <EventCard event={makeEvent(-HOUR)} now={NOW} onPress={jest.fn()} vibe={makeVibe()} />,
    );
    const card = screen.getByRole('button');
    expect(card.props.accessibilityLabel).not.toMatch(/live/i);
    expect(card.props.accessibilityLabel).toMatch(/On now/);
  });
});
