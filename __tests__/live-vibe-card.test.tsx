/**
 * Tests for the event page's "Live vibe" card (src/components/LiveVibeCard.tsx),
 * task VC-B09 with the VC-42 headcount, plus the VC-52 gauge, VC-53 tiles
 * and VC-54 "Live / All night" switch as the card uses them.
 *
 * The vibe call is replaced with a fake, and expo-router's "page in view"
 * hook runs like a normal effect. "Reduce Motion" is on in these tests so
 * the gauge draws its final state at once (the movement itself is tested in
 * vibe-meter.test.tsx). We check:
 *   - each state: none ("No vibe yet. Be the first."), early ("Early
 *     reading: 4 people so far", no number, no tiles), live (number, word,
 *     arc filled to the score, "updated" line, tiles, reactions), stale
 *     (header "LAST VIBE", "Quiet for 2 hrs", grey "Last reading" tiles);
 *   - the switch: hidden without a score; Live first; "All night" swaps the
 *     header, gauge, line and tiles (headcount and tally stay) and announces
 *     the new reading; the night is WORDS ONLY (its word in the arc, no
 *     number, no fill); a withheld night word shows "No vibe yet"; after
 *     5 AM the switch hides and the night shows alone ("LAST NIGHT'S VIBE"),
 *     unless the night has no score;
 *   - what screen readers hear; "74 here" / "74 were here";
 *   - it asks again every 20 seconds, keeps the last good reading if a
 *     refresh fails, and stops asking once the card is gone;
 *   - loading and a failed first load.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { LiveVibeCard } from '@/components/LiveVibeCard';
import { dashOffset } from '@/components/VibeMeter';
import type { NightVibe, Vibe } from '@/lib/vibe';
import { NIGHT_WITHHELD_BODY, VIBE_REFRESH_MS } from '@/lib/vibe';
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
 * Makes an "All night" view for the fake answer.
 *
 * @param overrides - fields to change from a Hot night of 112 ratings (words only).
 * @returns a NightVibe.
 */
function makeNight(overrides: Partial<NightVibe> = {}): NightVibe {
  return {
    label: 'Hot',
    raters: 112,
    breakdown: { crowd: 'good', music: 'fire', energy: 'good' },
    over: false,
    ...overrides,
  };
}

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
    breakdown: null,
    night: null,
    ...overrides,
  };
}

/**
 * Draws the card for event e1.
 *
 * @param ended - whether the event is over.
 */
async function renderCard(ended = false) {
  return render(<LiveVibeCard eventId="e1" ended={ended} refreshKey={1} />);
}

/**
 * The arc is hidden from screen readers, and the query helpers skip hidden
 * parts unless asked, so arc queries pass this option.
 */
const HIDDEN = { includeHiddenElements: true };

let announce: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  // Reduce Motion on: the gauge shows its final state straight away.
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('LiveVibeCard states', () => {
  it('loading: the bare gauge with a spinner, read as "Loading the vibe"', async () => {
    fetchVibe.mockReturnValue(new Promise(() => {}));
    await renderCard();
    expect(screen.getByLabelText('Loading the vibe')).toBeOnTheScreen();
    expect(screen.queryByTestId('vibe-meter-fill', HIDDEN)).toBeNull();
  });

  it('none: no number, "Be the first", no switch', async () => {
    fetchVibe.mockResolvedValue({
      ok: true,
      vibe: makeVibe({ state: 'none', raters: 0, here: 0, score: null, label: null }),
    });
    await renderCard();
    expect(await screen.findByText('No vibe yet. Be the first.')).toBeOnTheScreen();
    expect(screen.getByLabelText('No vibe yet')).toBeOnTheScreen();
    expect(screen.getByText('LIVE VIBE')).toBeOnTheScreen();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByTestId('vibe-meter-fill', HIDDEN)).toBeNull();
    // Nobody checked in: no headcount line at all.
    expect(screen.queryByText(/ here$/)).toBeNull();
  });

  it('early (4 ratings): a count but no number, no tiles, no switch', async () => {
    fetchVibe.mockResolvedValue({
      ok: true,
      vibe: makeVibe({ state: 'early', raters: 4, here: 9, score: null, label: null }),
    });
    await renderCard();
    expect(await screen.findByText('Early reading: 4 people so far')).toBeOnTheScreen();
    expect(screen.getByLabelText('Early reading, no score yet')).toBeOnTheScreen();
    expect(screen.getByText('9 here')).toBeOnTheScreen();
    expect(screen.queryByText(/^\d+\.\d$/)).toBeNull();
    expect(screen.queryByTestId('breakdown-tiles')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('live (5 ratings): the number, its word, the filled arc, tiles and reactions', async () => {
    fetchVibe.mockResolvedValue({
      ok: true,
      vibe: makeVibe({
        reactions: [
          { reaction: 'fire', count: 3 },
          { reaction: 'dancing', count: 1 },
        ],
        breakdown: { crowd: 'packed', music: 'fire', energy: 'good' },
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
    expect(screen.getByTestId('vibe-meter-fill', HIDDEN).props.strokeDashoffset).toBeCloseTo(
      dashOffset(8),
    );

    // The tiles: words only, read as one sentence.
    expect(screen.getByLabelText('Crowd Packed, Music Fire, Energy Good')).toBeOnTheScreen();
    expect(screen.getByText('CROWD')).toBeOnTheScreen();
    expect(screen.getByText('Packed')).toBeOnTheScreen();
  });

  it('stale: "LAST VIBE", the last score, how long it has been quiet, grey tiles', async () => {
    fetchVibe.mockResolvedValue({
      ok: true,
      vibe: makeVibe({
        state: 'stale',
        minutesSinceLast: 130,
        breakdown: { crowd: 'quiet', music: 'meh', energy: 'low' },
      }),
    });
    await renderCard();
    // The night average no longer sits on this line: it is the All night view now.
    expect(await screen.findByText('Quiet for 2 hrs')).toBeOnTheScreen();
    expect(screen.getByText('LAST VIBE')).toBeOnTheScreen();
    expect(screen.getByLabelText('Last vibe 8.0 out of 10, Hot')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Last reading: Crowd Quiet, Music Meh, Energy Low'),
    ).toBeOnTheScreen();
  });

  it('says "were here" once the event is over', async () => {
    fetchVibe.mockResolvedValue({ ok: true, vibe: makeVibe() });
    await renderCard(true);
    expect(await screen.findByText('74 were here')).toBeOnTheScreen();
  });

  it('says so when the first load fails (the bare gauge, no "No vibe yet")', async () => {
    fetchVibe.mockResolvedValue({ ok: false, message: "We couldn't load the vibe." });
    await renderCard();
    expect(await screen.findByText("We couldn't load the vibe.")).toBeOnTheScreen();
    expect(screen.queryByText('No vibe yet')).toBeNull();
  });
});

describe('LiveVibeCard Live / All night switch', () => {
  it('starts on Live, and All night swaps the gauge, line and tiles (headcount and tally stay)', async () => {
    fetchVibe.mockResolvedValue({
      ok: true,
      vibe: makeVibe({
        reactions: [{ reaction: 'fire', count: 3 }],
        breakdown: { crowd: 'packed', music: 'fire', energy: 'fire' },
        night: makeNight(),
      }),
    });
    await renderCard();
    expect(await screen.findByText('8.0')).toBeOnTheScreen();
    // The pill itself isn't a focusable element, so look for its two tabs.
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByLabelText('Live score')).toBeSelected();
    expect(screen.getByLabelText('All night score')).not.toBeSelected();

    await fireEvent.press(screen.getByLabelText('All night score'));
    expect(screen.getByText("TONIGHT'S VIBE")).toBeOnTheScreen();
    // Words only: the night's word in the arc, no number, no fill level.
    expect(screen.getByTestId('vibe-meter-word')).toHaveTextContent('Hot');
    expect(screen.queryByText(/^\d+\.\d$/)).toBeNull();
    expect(screen.queryByTestId('vibe-meter-fill', HIDDEN)).toBeNull();
    expect(screen.getByText('112 ratings tonight')).toBeOnTheScreen();
    expect(screen.getByLabelText('Crowd Good, Music Fire, Energy Good')).toBeOnTheScreen();
    expect(screen.getByTestId('vibe-meter').props.accessibilityLabel).toBe('All night vibe: Hot');
    // No number means no "progress bar" either.
    expect(screen.getByTestId('vibe-meter').props.accessibilityRole).toBeUndefined();
    expect(screen.getByLabelText('All night score')).toBeSelected();
    // "N here" and the tally don't change with the view.
    expect(screen.getByText('74 here')).toBeOnTheScreen();
    expect(screen.getByLabelText('Reactions: Fire 3')).toBeOnTheScreen();
    // Screen readers hear the new reading.
    expect(announce).toHaveBeenCalledWith('All night vibe: Hot');

    await fireEvent.press(screen.getByLabelText('Live score'));
    expect(screen.getByText('LIVE VIBE')).toBeOnTheScreen();
    expect(screen.getByText('8.0')).toBeOnTheScreen();
    expect(announce).toHaveBeenLastCalledWith('Vibe 8.0 out of 10, Hot');
  });

  it('a withheld night word shows "No vibe yet" in that view and keeps the switch', async () => {
    fetchVibe.mockResolvedValue({
      ok: true,
      vibe: makeVibe({ night: makeNight({ label: null, breakdown: null }) }),
    });
    await renderCard();
    await fireEvent.press(await screen.findByLabelText('All night score'));
    expect(screen.getByText('No vibe yet')).toBeOnTheScreen();
    expect(screen.getByText(NIGHT_WITHHELD_BODY)).toBeOnTheScreen();
    expect(screen.queryByTestId('breakdown-tiles')).toBeNull();
    // The pill itself isn't a focusable element, so look for its two tabs.
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('after 5 AM: no switch, the night alone as "LAST NIGHT\'S VIBE"', async () => {
    fetchVibe.mockResolvedValue({
      ok: true,
      vibe: makeVibe({ state: 'stale', minutesSinceLast: 300, night: makeNight({ over: true }) }),
    });
    await renderCard();
    expect(await screen.findByText("LAST NIGHT'S VIBE")).toBeOnTheScreen();
    expect(screen.getByTestId('vibe-meter-word')).toHaveTextContent('Hot');
    expect(screen.queryByText(/^\d+\.\d$/)).toBeNull();
    expect(screen.getByText('112 ratings tonight')).toBeOnTheScreen();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('after 5 AM with no night word: the last live score, no switch', async () => {
    fetchVibe.mockResolvedValue({
      ok: true,
      vibe: makeVibe({
        state: 'stale',
        minutesSinceLast: 300,
        night: makeNight({ over: true, label: null, breakdown: null }),
      }),
    });
    await renderCard();
    expect(await screen.findByText('LAST VIBE')).toBeOnTheScreen();
    expect(screen.getByText('8.0')).toBeOnTheScreen();
    expect(screen.queryByRole('tab')).toBeNull();
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

  it('keeps the chosen view across a poll', async () => {
    fetchVibe.mockResolvedValue({ ok: true, vibe: makeVibe({ night: makeNight() }) });
    await renderCard();
    await fireEvent.press(await screen.findByLabelText('All night score'));
    await act(async () => {
      jest.advanceTimersByTime(VIBE_REFRESH_MS);
    });
    expect(fetchVibe).toHaveBeenCalledTimes(2);
    expect(screen.getByText("TONIGHT'S VIBE")).toBeOnTheScreen();
  });
});
