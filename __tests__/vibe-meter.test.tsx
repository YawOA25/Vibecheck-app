/**
 * Tests for the arc gauge (src/components/VibeMeter.tsx), VC-52.
 *
 * We check:
 *   - the maths: how far the fill's dash shifts for a score (0 empty, 10 full);
 *   - the colours: hotter words are brighter gold; stale is grey;
 *   - 0.0 draws no fill (its round end would show a dot);
 *   - screen readers: one element with the spoken sentence and a 0-10 value;
 *     early and none have no "progress bar" role; the arc is hidden;
 *   - movement: the first reading sweeps from empty to the score in 700 ms
 *     and the number counts up; a new score moves without counting; the
 *     colour swaps at the end of a move; with Reduce Motion on nothing
 *     moves at all;
 *   - the gold glow (VC-70): only behind a live Hot or Fire score, under
 *     15% strength, never moving; none for Quiet, Good, stale, early, none
 *     or the words-only All night view.
 */
import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, processColor } from 'react-native';

import {
  ARC_LENGTH,
  FIRST_SWEEP_MS,
  MOVE_MS,
  VibeMeter,
  GLOW_OPACITY,
  dashOffset,
  showsGlow,
  wordColour,
} from '@/components/VibeMeter';
import type { Vibe } from '@/lib/vibe';
import { colors } from '@/theme';

/**
 * Makes a vibe to draw.
 *
 * @param overrides - fields to change from a live 8.0 Hot vibe.
 * @returns a Vibe.
 */
function makeVibe(overrides: Partial<Vibe> = {}): Vibe {
  return {
    state: 'live',
    raters: 5,
    here: 0,
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
 * Sets the phone's Reduce Motion answer for the next render.
 *
 * @param on - whether Reduce Motion is on.
 */
function reduceMotion(on: boolean) {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(on);
}

/** The fill's current dash shift. */
function fillOffset(): number {
  return screen.getByTestId('vibe-meter-fill', HIDDEN).props.strokeDashoffset;
}

/**
 * The arc is hidden from screen readers, and the query helpers skip hidden
 * parts unless asked, so arc queries pass this option.
 */
const HIDDEN = { includeHiddenElements: true };

afterEach(() => jest.restoreAllMocks());

describe('gauge maths and colours', () => {
  it('shifts the dash by the empty part of the arc', () => {
    expect(ARC_LENGTH).toBeCloseTo(270.18, 1);
    expect(dashOffset(0)).toBeCloseTo(ARC_LENGTH);
    expect(dashOffset(10)).toBe(0);
    expect(dashOffset(8)).toBeCloseTo(ARC_LENGTH * 0.2);
    // Out-of-range values are clamped.
    expect(dashOffset(12)).toBe(0);
    expect(dashOffset(-1)).toBeCloseTo(ARC_LENGTH);
  });

  it('gives hotter words brighter gold', () => {
    expect(wordColour('Quiet')).toBe(colors.muted);
    expect(wordColour('Good')).toBe(colors.accentPressed);
    expect(wordColour('Hot')).toBe(colors.accent);
    expect(wordColour('Fire')).toBe(colors.accentHover);
  });
});

describe('gauge drawing (Reduce Motion on)', () => {
  beforeEach(() => reduceMotion(true));

  it('live: one element with the sentence, a 0-10 value, the fill at the score in its colour', async () => {
    await render(<VibeMeter vibe={makeVibe({ score: 9.1, label: 'Fire' })} />);
    const meter = screen.getByTestId('vibe-meter');
    expect(meter.props.accessibilityRole).toBe('progressbar');
    expect(meter.props.accessibilityLabel).toBe('Vibe 9.1 out of 10, Fire');
    expect(meter.props.accessibilityValue).toEqual({ min: 0, max: 10, now: 9 });
    expect(fillOffset()).toBeCloseTo(dashOffset(9.1));
    expect(screen.getByTestId('vibe-meter-fill', HIDDEN).props.stroke.payload).toBe(
      processColor(colors.accentHover),
    );
    expect(screen.getByText('9.1')).toBeOnTheScreen();
    expect(screen.getByText('Fire')).toBeOnTheScreen();
  });

  it('stale: the fill and the word turn grey', async () => {
    await render(<VibeMeter vibe={makeVibe({ state: 'stale' })} />);
    expect(screen.getByTestId('vibe-meter-fill', HIDDEN).props.stroke.payload).toBe(
      processColor(colors.fieldBorder),
    );
    expect(screen.getByLabelText('Last vibe 8.0 out of 10, Hot')).toBeOnTheScreen();
  });

  it('0.0: the number and word, but no fill at all', async () => {
    await render(<VibeMeter vibe={makeVibe({ score: 0, label: 'Quiet' })} />);
    expect(screen.getByText('0.0')).toBeOnTheScreen();
    expect(screen.queryByTestId('vibe-meter-fill', HIDDEN)).toBeNull();
    expect(screen.getByTestId('vibe-meter-track', HIDDEN)).toBeTruthy();
  });

  it('early and none: the track only, no progress-bar role', async () => {
    const view = await render(
      <VibeMeter vibe={makeVibe({ state: 'early', score: null, label: null })} />,
    );
    expect(screen.getByTestId('vibe-meter').props.accessibilityRole).toBeUndefined();
    expect(screen.getByLabelText('Early reading, no score yet')).toBeOnTheScreen();
    expect(screen.queryByTestId('vibe-meter-fill', HIDDEN)).toBeNull();
    await view.unmount();
    await render(<VibeMeter vibe={makeVibe({ state: 'none', score: null, label: null })} />);
    expect(screen.getByLabelText('No vibe yet')).toBeOnTheScreen();
  });

  it('a new score jumps straight there: no movement at all', async () => {
    const view = await render(<VibeMeter vibe={makeVibe()} />);
    expect(fillOffset()).toBeCloseTo(dashOffset(8));
    await view.rerender(<VibeMeter vibe={makeVibe({ score: 9, label: 'Fire' })} />);
    expect(fillOffset()).toBeCloseTo(dashOffset(9));
    expect(screen.getByText('9.0')).toBeOnTheScreen();
  });
});

describe('gauge movement (Reduce Motion off)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    reduceMotion(false);
  });
  afterEach(() => jest.useRealTimers());

  it('first reading sweeps up from empty in 700 ms, counting up', async () => {
    await render(<VibeMeter vibe={makeVibe()} />);
    // Part way: the arc is between empty and the score, and so is the number.
    await act(async () => {
      jest.advanceTimersByTime(FIRST_SWEEP_MS / 4);
    });
    const midway = fillOffset();
    expect(midway).toBeLessThan(ARC_LENGTH);
    expect(midway).toBeGreaterThan(dashOffset(8));
    expect(screen.queryByText('8.0')).toBeNull();
    // Done: the arc and the number are at the score.
    await act(async () => {
      jest.advanceTimersByTime(FIRST_SWEEP_MS);
    });
    expect(fillOffset()).toBeCloseTo(dashOffset(8));
    expect(screen.getByText('8.0')).toBeOnTheScreen();
  });

  it('a new score moves in 400 ms; the number swaps at once and the colour at the end', async () => {
    const view = await render(<VibeMeter vibe={makeVibe()} />);
    await act(async () => {
      jest.advanceTimersByTime(FIRST_SWEEP_MS * 2);
    });
    await view.rerender(<VibeMeter vibe={makeVibe({ score: 9, label: 'Fire' })} />);
    await act(async () => {
      jest.advanceTimersByTime(MOVE_MS / 4);
    });
    // The number already says 9.0; the arc is still on its way; the colour
    // is still Hot's.
    expect(screen.getByText('9.0')).toBeOnTheScreen();
    expect(fillOffset()).toBeGreaterThan(dashOffset(9));
    expect(screen.getByTestId('vibe-meter-fill', HIDDEN).props.stroke.payload).toBe(
      processColor(colors.accent),
    );
    await act(async () => {
      jest.advanceTimersByTime(MOVE_MS);
    });
    expect(fillOffset()).toBeCloseTo(dashOffset(9));
    expect(screen.getByTestId('vibe-meter-fill', HIDDEN).props.stroke.payload).toBe(
      processColor(colors.accentHover),
    );
  });

  it('the same score on a poll moves nothing', async () => {
    const view = await render(<VibeMeter vibe={makeVibe()} />);
    await act(async () => {
      jest.advanceTimersByTime(FIRST_SWEEP_MS * 2);
    });
    // A new answer object with the same score (what a 20 s poll brings).
    await view.rerender(<VibeMeter vibe={makeVibe({ minutesSinceLast: 5 })} />);
    expect(fillOffset()).toBeCloseTo(dashOffset(8));
    expect(screen.getByText('8.0')).toBeOnTheScreen();
  });
});

describe('All night view: words only (cto privacy fix)', () => {
  beforeEach(() => reduceMotion(true));

  it('shows the word in its colour over an empty track: no number, no fill, no progress bar', async () => {
    await render(<VibeMeter vibe={makeVibe({ score: null, label: 'Fire' })} view="night" />);
    const word = screen.getByTestId('vibe-meter-word');
    expect(word).toHaveTextContent('Fire');
    expect(word).toHaveStyle({ color: colors.accentHover });
    expect(screen.queryByText(/^\d+\.\d$/)).toBeNull();
    expect(screen.queryByTestId('vibe-meter-fill', HIDDEN)).toBeNull();
    expect(screen.getByTestId('vibe-meter-track', HIDDEN)).toBeTruthy();
    const meter = screen.getByTestId('vibe-meter');
    expect(meter.props.accessibilityRole).toBeUndefined();
    expect(meter.props.accessibilityValue).toBeUndefined();
    expect(meter.props.accessibilityLabel).toBe('All night vibe: Fire');
  });

  it('a withheld night word: "No vibe yet", nothing in the arc', async () => {
    await render(
      <VibeMeter vibe={makeVibe({ state: 'none', score: null, label: null })} view="night" />,
    );
    expect(screen.queryByTestId('vibe-meter-word')).toBeNull();
    expect(screen.getByText('No vibe yet')).toBeOnTheScreen();
  });
});

describe('gold glow behind the gauge (VC-70)', () => {
  /** The glow oval, or null when it isn't drawn (it is hidden from screen readers). */
  const glow = () => screen.queryByTestId('vibe-meter-glow', HIDDEN);

  /**
   * Reads the glow gradient's strength at its centre and at its edge.
   * react-native-svg packs each stop as [offset, colour]; the colour is one
   * number whose top byte is the opacity (0 to 255).
   *
   * @returns the [centre, edge] opacities, 0 to 1.
   */
  function glowOpacities(): [number, number] {
    const match = JSON.stringify(screen.toJSON()).match(/"gradient":\[0,(\d+),1,(\d+)\]/);
    if (!match) throw new Error('no glow gradient drawn');
    const alpha = (packed: string) => (Number(packed) >>> 24) / 255;
    return [alpha(match[1]), alpha(match[2])];
  }

  it('is drawn for a live Hot or Fire score, and stays under 15% strength', async () => {
    reduceMotion(true);
    await render(<VibeMeter vibe={makeVibe({ score: 8, label: 'Hot' })} />);
    expect(glow()).not.toBeNull();
    await screen.unmount();
    await render(<VibeMeter vibe={makeVibe({ score: 9.1, label: 'Fire' })} />);
    expect(glow()).not.toBeNull();
    expect(GLOW_OPACITY).toBeGreaterThan(0);
    expect(GLOW_OPACITY).toBeLessThan(0.15);
    // The gradient really is drawn that faint: about 14% gold in the middle,
    // fading to nothing at the edge.
    const [centre, edge] = glowOpacities();
    expect(centre).toBeCloseTo(GLOW_OPACITY, 2);
    expect(centre).toBeLessThan(0.15);
    expect(edge).toBe(0);
  });

  it('is not drawn for Quiet or Good', async () => {
    reduceMotion(true);
    await render(<VibeMeter vibe={makeVibe({ score: 3, label: 'Quiet' })} />);
    expect(glow()).toBeNull();
    await screen.unmount();
    await render(<VibeMeter vibe={makeVibe({ score: 6, label: 'Good' })} />);
    expect(glow()).toBeNull();
  });

  it('is not drawn for a stale score, early, none, loading or the All night view', async () => {
    reduceMotion(true);
    await render(<VibeMeter vibe={makeVibe({ state: 'stale', label: 'Fire', score: 9 })} />);
    expect(glow()).toBeNull();
    await screen.unmount();
    await render(<VibeMeter vibe={makeVibe({ state: 'early', score: null, label: null })} />);
    expect(glow()).toBeNull();
    await screen.unmount();
    await render(<VibeMeter vibe={makeVibe()} loading />);
    expect(glow()).toBeNull();
    await screen.unmount();
    // All night stays words only, exactly as before: no glow even for Fire.
    await render(<VibeMeter vibe={makeVibe({ score: null, label: 'Fire' })} view="night" />);
    expect(glow()).toBeNull();
    expect(showsGlow(makeVibe({ score: null, label: 'Fire' }), false)).toBe(false);
  });

  it('is there from the first frame with motion on, and never animates', async () => {
    reduceMotion(false);
    jest.useFakeTimers();
    try {
      await render(<VibeMeter vibe={makeVibe({ score: 9.1, label: 'Fire' })} />);
      // Mid-sweep, the glow is already fully drawn: it doesn't fade or grow.
      await act(async () => {
        jest.advanceTimersByTime(FIRST_SWEEP_MS / 2);
      });
      expect(glow()).not.toBeNull();
      expect(glowOpacities()[0]).toBeCloseTo(GLOW_OPACITY, 2);
    } finally {
      jest.useRealTimers();
    }
  });
});
