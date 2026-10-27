/**
 * Tests for the event page's "Live vibe" card and its meter
 * (src/components/LiveVibeCard.tsx and VibeMeter.tsx), task VC-B09, with the
 * VC-42 headcount.
 *
 * The vibe call is replaced with a fake, and expo-router's "page in view"
 * hook runs like a normal effect. We check:
 *   - each state: none ("No vibe yet. Be the first."), early ("Early
 *     reading: 4 people so far", no number), live (the number, its word, the
 *     bar filled to the score, "updated" line, reactions), stale (last score,
 *     "Quiet for 2 hrs", night average);
 *   - what screen readers hear for the meter;
 *   - "74 here", or "74 were here" after the event;
 *   - it asks again every 20 seconds, keeps the last good reading if a
 *     refresh fails, and stops asking once the card is gone;
 *   - a first load that fails says so.
 */
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { LiveVibeCard } from '@/components/LiveVibeCard';
import type { Vibe } from '@/lib/vibe';
import { VIBE_REFRESH_MS } from '@/lib/vibe';
import { getEventVibe } from '@/lib/vibe-api';

jest.mock('@/lib/vibe-api', () => ({ getEventVibe: jest.fn() }));
jest.mock('expo-router', () => ({
  // Outside a real navigator the card's page is "in view" once.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(effect, [effect]);
  },
}));
const fetchVibe = getEventVibe as jest.Mock;

/**
 * Makes a vibe for the fake server answer.
 *
 * @param overrides - fields to change from a live 8.0 Hot vibe.
 * @returns a Vibe.
 */
function makeVibe(overrides: Partial<Vibe> = {}): Vibe {
  return {
    state: 'live',
    raters: 5,
    here: 74,
    score: 8,
    label: 'Hot',
    nightAverage: null,
    minutesSinceLast: 4,
    reactions: [],
    ...overrides,
  };
}

/**
 * Draws the card for event e1 and waits for the first answer.
 *
 * @param ended - whether the event is over.
 */
async function renderCard(ended = false) {
  return render(<LiveVibeCard eventId="e1" ended={ended} refreshKey={1} />);
}

beforeEach(() => jest.clearAllMocks());

describe('LiveVibeCard states', () => {
  it('none: no number, "Be the first"', async () => {
    fetchVibe.mockResolvedValue({
      ok: true,
      vibe: makeVibe({ state: 'none', raters: 0, here: 0, score: null, label: null }),
    });
    await renderCard();
    expect(await screen.findByText('No vibe yet. Be the first.')).toBeOnTheScreen();
    expect(screen.getByLabelText('No vibe yet')).toBeOnTheScreen();
    // Nobody checked in: no headcount line at all.
    expect(screen.queryByText(/ here$/)).toBeNull();
  });

  it('early (4 ratings): a count but no number, and the headcount', async () => {
    fetchVibe.mockResolvedValue({
      ok: true,
      vibe: makeVibe({ state: 'early', raters: 4, here: 9, score: null, label: null }),
    });
    await renderCard();
    expect(await screen.findByText('Early reading: 4 people so far')).toBeOnTheScreen();
    expect(screen.getByLabelText('Early reading, no score yet')).toBeOnTheScreen();
    expect(screen.getByText('9 here')).toBeOnTheScreen();
    expect(screen.queryByText(/^\d+\.\d$/)).toBeNull();
  });

  it('live (5 ratings): the number, its word, a filled bar and the reactions', async () => {
    fetchVibe.mockResolvedValue({
      ok: true,
      vibe: makeVibe({
        reactions: [
          { reaction: 'fire', count: 3 },
          { reaction: 'dancing', count: 1 },
        ],
      }),
    });
    await renderCard();
    expect(await screen.findByText('8.0')).toBeOnTheScreen();
    expect(screen.getByText('Hot')).toBeOnTheScreen();
    expect(screen.getByText('5 people · updated 4 min ago')).toBeOnTheScreen();
    expect(screen.getByText('74 here')).toBeOnTheScreen();
    expect(screen.getByLabelText('Reactions: Fire 3, Dancing 1')).toBeOnTheScreen();

    const meter = screen.getByTestId('vibe-meter');
    expect(meter.props.accessibilityLabel).toBe('Vibe 8.0 out of 10, Hot');
    expect(meter.props.accessibilityValue).toEqual({ min: 0, max: 10, now: 8 });
    expect(StyleSheet.flatten(screen.getByTestId('vibe-meter-fill').props.style).width).toBe('80%');
  });

  it('stale: the last score, how long it has been quiet, and the night average', async () => {
    fetchVibe.mockResolvedValue({
      ok: true,
      vibe: makeVibe({ state: 'stale', minutesSinceLast: 130, nightAverage: 7.4 }),
    });
    await renderCard();
    expect(await screen.findByText('Quiet for 2 hrs · night average 7.4')).toBeOnTheScreen();
    expect(screen.getByLabelText('Last vibe 8.0 out of 10, Hot')).toBeOnTheScreen();
  });

  it('says "were here" once the event is over', async () => {
    fetchVibe.mockResolvedValue({ ok: true, vibe: makeVibe() });
    await renderCard(true);
    expect(await screen.findByText('74 were here')).toBeOnTheScreen();
  });

  it('says so when the first load fails', async () => {
    fetchVibe.mockResolvedValue({ ok: false, message: "We couldn't load the vibe." });
    await renderCard();
    expect(await screen.findByText("We couldn't load the vibe.")).toBeOnTheScreen();
  });
});

describe('LiveVibeCard refresh', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('asks again every 20 s, keeps the last reading on a failed refresh, and stops when gone', async () => {
    fetchVibe.mockResolvedValueOnce({ ok: true, vibe: makeVibe() });
    const view = await renderCard();
    expect(await screen.findByText('8.0')).toBeOnTheScreen();
    expect(fetchVibe).toHaveBeenCalledTimes(1);

    // 20 s later: a new rating arrived, the score moves.
    fetchVibe.mockResolvedValueOnce({ ok: true, vibe: makeVibe({ score: 8.6, label: 'Fire' }) });
    await act(async () => {
      jest.advanceTimersByTime(VIBE_REFRESH_MS);
    });
    expect(fetchVibe).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('8.6')).toBeOnTheScreen();

    // Another 20 s: the refresh fails, the last reading stays.
    fetchVibe.mockResolvedValueOnce({ ok: false, message: "We couldn't load the vibe." });
    await act(async () => {
      jest.advanceTimersByTime(VIBE_REFRESH_MS);
    });
    expect(fetchVibe).toHaveBeenCalledTimes(3);
    expect(screen.getByText('8.6')).toBeOnTheScreen();
    expect(screen.queryByText("We couldn't load the vibe.")).toBeNull();

    // Gone: no more calls.
    await view.unmount();
    await act(async () => {
      jest.advanceTimersByTime(VIBE_REFRESH_MS * 3);
    });
    expect(fetchVibe).toHaveBeenCalledTimes(3);
  });
});
