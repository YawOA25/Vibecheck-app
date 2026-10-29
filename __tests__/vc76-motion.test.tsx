/**
 * Tests for VC-76 "smooth transitions" (design/vc76-motion-spec.md), the
 * shared motion parts and the screens' reserved space.
 *
 * We check:
 *   - FadeIn: fades in over 200 ms on first appearance, again only when its
 *     fadeKey changes (not on ordinary re-draws), and in 100 ms under
 *     Reduce Motion (fades stay allowed, just shorter);
 *   - useDelayedFlag: a spinner flag turns on only after 300 ms, and off at once;
 *   - PressableScale: shrinks while pressed and springs back; never under
 *     Reduce Motion or before the phone answers;
 *   - ChoiceChip: the picked layer fades (120 ms, 100 ms under Reduce
 *     Motion) and pops from 0.96 when picked; no pop under Reduce Motion,
 *     and nothing moves on first appearance;
 *   - TwoWaySwitch: once measured, one thumb slides to the picked option;
 *     under Reduce Motion it jumps;
 *   - the gauge waits for the page's slide-in (sweepReady) before its first
 *     sweep, showing 0.0 meanwhile, and counts up at most every 50 ms;
 *   - reserved heights: the vibe card holds two lines and the tile row while
 *     loading, the heads-up card shows chip blocks and keeps its one-row
 *     height, and the event skeleton uses the real text and card heights;
 *   - the rating sheet's swipe-to-close rule.
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, StyleSheet, Text } from 'react-native';

import { CHIP_POP_SCALE, ChoiceChip } from '@/components/ChoiceChip';
import { FadeIn } from '@/components/FadeIn';
import { HeadsUpCard } from '@/components/HeadsUpCard';
import { LiveVibeCard } from '@/components/LiveVibeCard';
import { PressableScale } from '@/components/PressableScale';
import { EventSkeleton, GAUGE_CARD_HEIGHT, HEADS_UP_CARD_HEIGHT } from '@/components/Skeleton';
import { TILE_HEIGHT } from '@/components/BreakdownTiles';
import { TwoWaySwitch } from '@/components/TwoWaySwitch';
import { COUNT_UP_STEP_MS, FIRST_SWEEP_MS, VibeMeter } from '@/components/VibeMeter';
import { rateSwipeAllowed } from '../app/rate/[id]';
import { EMPTY_DRAFT, HEADS_UP_TAGS } from '@/lib/rating';
import { getEventHeadsUps } from '@/lib/ratings-api';
import { resetReduceMotionForTests } from '@/lib/reduce-motion';
import { useDelayedFlag } from '@/lib/use-delayed-flag';
import type { Vibe } from '@/lib/vibe';
import { getEventVibe } from '@/lib/vibe-api';
import { colors, minTapTarget, motion, radius, typography } from '@/theme';

jest.mock('@/lib/vibe-api', () => ({ getEventVibe: jest.fn() }));
jest.mock('@/lib/ratings-api', () => ({ getEventHeadsUps: jest.fn(), addHeadsUp: jest.fn() }));
jest.mock('@/lib/moderation-api', () => ({ reportHeadsUpTag: jest.fn() }));
// The rate screen module (for its swipe rule) pulls these in; never called here.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  // Outside a real navigator the card's page is "in view" once.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(effect, [effect]);
  },
}));

/** Includes parts hidden from screen readers (skeletons are hidden). */
const HIDDEN = { includeHiddenElements: true };

let timingSpy: jest.SpyInstance;
let springSpy: jest.SpyInstance;

/**
 * The settings of every Animated.timing call so far.
 *
 * @returns e.g. [{ toValue: 1, duration: 200, ... }].
 */
function timings() {
  return timingSpy.mock.calls.map((call) => call[1]);
}

/**
 * Makes a live vibe.
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

beforeEach(() => {
  jest.clearAllMocks();
  timingSpy = jest.spyOn(Animated, 'timing');
  springSpy = jest.spyOn(Animated, 'spring');
});

afterEach(() => {
  jest.restoreAllMocks();
  resetReduceMotionForTests();
});

describe('FadeIn', () => {
  it('fades in over 200 ms when motion is allowed, using the native driver', async () => {
    resetReduceMotionForTests(false);
    await render(
      <FadeIn testID="fade">
        <Text>Hello</Text>
      </FadeIn>,
    );
    expect(timings()).toEqual([
      expect.objectContaining({ toValue: 1, duration: 200, useNativeDriver: true }),
    ]);
  });

  it('fades again only when fadeKey changes, not on an ordinary re-draw', async () => {
    resetReduceMotionForTests(false);
    const view = await render(
      <FadeIn fadeKey="a">
        <Text>One</Text>
      </FadeIn>,
    );
    await view.rerender(
      <FadeIn fadeKey="a">
        <Text>One, refreshed</Text>
      </FadeIn>,
    );
    expect(timings()).toHaveLength(1);
    await view.rerender(
      <FadeIn fadeKey="b">
        <Text>Two</Text>
      </FadeIn>,
    );
    expect(timings()).toHaveLength(2);
  });

  it('Reduce Motion (or no answer yet): still fades, but in 100 ms', async () => {
    resetReduceMotionForTests(true);
    const view = await render(
      <FadeIn>
        <Text>Hi</Text>
      </FadeIn>,
    );
    expect(timings()[0]).toEqual(expect.objectContaining({ duration: motion.reducedFade }));
    await view.unmount();
    resetReduceMotionForTests(null);
    // A fresh question to the (fake) phone that never answers in time.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(new Promise(() => {}));
    await render(
      <FadeIn>
        <Text>Hi</Text>
      </FadeIn>,
    );
    expect(timings()[1]).toEqual(expect.objectContaining({ duration: 100 }));
  });
});

describe('useDelayedFlag (delayed spinners)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('turns on only after 300 ms, and off straight away', async () => {
    const hook = await renderHook(({ on }: { on: boolean }) => useDelayedFlag(on), {
      initialProps: { on: true },
    });
    expect(hook.result.current).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(299);
    });
    expect(hook.result.current).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(hook.result.current).toBe(true);
    await hook.rerender({ on: false });
    expect(hook.result.current).toBe(false);
    // A fast load (under 300 ms) never shows the spinner at all.
    await hook.rerender({ on: true });
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    await hook.rerender({ on: false });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(hook.result.current).toBe(false);
  });
});

describe('PressableScale', () => {
  /** Renders a pressable row and returns its button. */
  async function renderRow(animate?: boolean) {
    await render(
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Row"
        scaleTo={0.97}
        animate={animate}
        onPress={() => {}}
      >
        <Text>Row</Text>
      </PressableScale>,
    );
    return screen.getByRole('button', { name: 'Row' });
  }

  it('shrinks over 120 ms on press and springs back (speed 40, no bounce)', async () => {
    resetReduceMotionForTests(false);
    const row = await renderRow();
    await fireEvent(row, 'pressIn');
    expect(timings()).toEqual([
      expect.objectContaining({ toValue: 0.97, duration: 120, useNativeDriver: true }),
    ]);
    await fireEvent(row, 'pressOut');
    expect(springSpy.mock.calls[0][1]).toEqual(
      expect.objectContaining({ toValue: 1, speed: 40, bounciness: 0, useNativeDriver: true }),
    );
  });

  it('never shrinks under Reduce Motion, before the phone answers, or when told not to', async () => {
    for (const answer of [true, null] as const) {
      resetReduceMotionForTests(answer);
      if (answer === null) {
        jest
          .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
          .mockReturnValue(new Promise(() => {}));
      }
      const row = await renderRow();
      await fireEvent(row, 'pressIn');
      await fireEvent(row, 'pressOut');
      await screen.unmount();
    }
    resetReduceMotionForTests(false);
    const row = await renderRow(false);
    await fireEvent(row, 'pressIn');
    expect(timings()).toEqual([]);
    expect(springSpy).not.toHaveBeenCalled();
  });
});

describe('ChoiceChip selection motion', () => {
  /** The picked layer's style. */
  function layerStyle() {
    return StyleSheet.flatten(screen.getByTestId('chip-selected-layer').props.style);
  }

  it('nothing moves on first appearance; the layer starts at the pick', async () => {
    resetReduceMotionForTests(false);
    await render(<ChoiceChip label="Packed" selected onPress={() => {}} />);
    expect(layerStyle().opacity).toBe(1);
    expect(layerStyle().backgroundColor).toBe(colors.accent);
    expect(timings()).toEqual([]);
  });

  it('picking fades the layer in over 120 ms and pops from 0.96', async () => {
    resetReduceMotionForTests(false);
    const view = await render(<ChoiceChip label="Packed" selected={false} onPress={() => {}} />);
    await view.rerender(<ChoiceChip label="Packed" selected onPress={() => {}} />);
    expect(timings()).toEqual([
      expect.objectContaining({ toValue: 1, duration: 120, useNativeDriver: true }),
      expect.objectContaining({ toValue: 1, duration: 120 }),
    ]);
    expect(CHIP_POP_SCALE).toBe(0.96);
  });

  it('Reduce Motion: the fade stays (100 ms), the pop is gone', async () => {
    resetReduceMotionForTests(true);
    const view = await render(<ChoiceChip label="Packed" selected={false} onPress={() => {}} />);
    await view.rerender(<ChoiceChip label="Packed" selected onPress={() => {}} />);
    expect(timings()).toEqual([expect.objectContaining({ toValue: 1, duration: 100 })]);
  });
});

describe('TwoWaySwitch sliding thumb', () => {
  const OPTIONS = [
    { key: 'live', label: 'Live', spoken: 'Live score' },
    { key: 'night', label: 'All night', spoken: 'All night score' },
  ] as const;

  /** Lays out the two options as a phone would (40 and 70 points wide). */
  async function measure() {
    const tabs = screen.getAllByRole('tab');
    await fireEvent(tabs[0], 'layout', { nativeEvent: { layout: { x: 2, width: 40 } } });
    await fireEvent(tabs[1], 'layout', { nativeEvent: { layout: { x: 42, width: 70 } } });
  }

  it('slides one thumb over 200 ms to the picked option', async () => {
    resetReduceMotionForTests(false);
    const view = await render(<TwoWaySwitch options={OPTIONS} value="live" onChange={() => {}} />);
    await measure();
    expect(screen.getByTestId('switch-thumb')).toBeTruthy();
    timingSpy.mockClear();
    await view.rerender(<TwoWaySwitch options={OPTIONS} value="night" onChange={() => {}} />);
    expect(timings()).toEqual([expect.objectContaining({ toValue: 1, duration: 200 })]);
    // The picked state is announced straight away.
    expect(screen.getByRole('tab', { name: 'All night score' }).props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('Reduce Motion: the thumb jumps (no slide)', async () => {
    resetReduceMotionForTests(true);
    const view = await render(<TwoWaySwitch options={OPTIONS} value="live" onChange={() => {}} />);
    await measure();
    await view.rerender(<TwoWaySwitch options={OPTIONS} value="night" onChange={() => {}} />);
    expect(timings()).toEqual([]);
  });
});

describe('the gauge waits for the slide-in (VC-76, 2f)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  });
  afterEach(() => jest.useRealTimers());

  /** The first sweep's timing calls (700 ms). */
  function sweeps() {
    return timings().filter((t) => t.duration === FIRST_SWEEP_MS);
  }

  it('holds the first sweep at 0.0 until sweepReady, then sweeps', async () => {
    const view = await render(<VibeMeter vibe={makeVibe()} sweepReady={false} />);
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(sweeps()).toHaveLength(0);
    expect(screen.getByText('0.0')).toBeOnTheScreen();
    await view.rerender(<VibeMeter vibe={makeVibe()} sweepReady />);
    expect(sweeps()).toHaveLength(1);
    await act(async () => {
      jest.advanceTimersByTime(FIRST_SWEEP_MS * 2);
    });
    expect(screen.getByText('8.0')).toBeOnTheScreen();
  });

  it('counts up at most every 50 ms during the sweep', async () => {
    const setStates: number[] = [];
    await render(<VibeMeter vibe={makeVibe()} />);
    // Sample the number every 10 ms through the sweep and count the changes.
    let last = screen.queryByText(/^\d\.\d$/)?.props.children;
    for (let t = 0; t < FIRST_SWEEP_MS; t += 10) {
      await act(async () => {
        jest.advanceTimersByTime(10);
      });
      const now = screen.queryByText(/^\d\.\d$/)?.props.children;
      if (now !== last) setStates.push(t);
      last = now;
    }
    // 700 ms at one change per 50 ms is at most about 15 changes.
    expect(setStates.length).toBeLessThanOrEqual(FIRST_SWEEP_MS / COUNT_UP_STEP_MS + 1);
    expect(COUNT_UP_STEP_MS).toBe(50);
  });

  it('Reduce Motion: no sweep and no hold, the score shows at once', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await render(<VibeMeter vibe={makeVibe()} sweepReady={false} />);
    await act(async () => {
      jest.advanceTimersByTime(10);
    });
    expect(screen.getByText('8.0')).toBeOnTheScreen();
    expect(sweeps()).toHaveLength(0);
  });
});

describe('reserved heights (VC-76, 2c)', () => {
  it('the vibe card holds two text lines and a row of three tiles while loading', async () => {
    (getEventVibe as jest.Mock).mockReturnValue(new Promise(() => {}));
    await render(<LiveVibeCard eventId="e1" ended={false} refreshKey={1} />);
    const blocks = screen
      .getAllByTestId('skeleton-block', HIDDEN)
      .map((b) => StyleSheet.flatten(b.props.style));
    expect(screen.getByTestId('live-vibe-skeleton', HIDDEN)).toBeTruthy();
    expect(blocks.slice(0, 2)).toEqual([
      expect.objectContaining({ height: 14, width: '70%' }),
      expect.objectContaining({ height: 14, width: '50%' }),
    ]);
    expect(blocks.slice(2).map((b) => b.height)).toEqual([TILE_HEIGHT, TILE_HEIGHT, TILE_HEIGHT]);
    expect(TILE_HEIGHT).toBe(60);
  });

  it('the vibe card swaps the space holder for the lines once loaded', async () => {
    (getEventVibe as jest.Mock).mockResolvedValue({ ok: true, vibe: makeVibe() });
    await render(<LiveVibeCard eventId="e1" ended={false} refreshKey={1} />);
    expect(await screen.findByTestId('live-vibe-lines')).toBeTruthy();
    expect(screen.queryByTestId('live-vibe-skeleton', HIDDEN)).toBeNull();
  });

  it('the heads-up card shows three chip blocks while loading and keeps its one-row height', async () => {
    (getEventHeadsUps as jest.Mock).mockReturnValue(new Promise(() => {}));
    await render(<HeadsUpCard eventId="e1" refreshKey={1} canVote />);
    expect(screen.getByLabelText('Loading heads-ups')).toBeOnTheScreen();
    const chips = screen
      .getAllByTestId('skeleton-block', HIDDEN)
      .map((b) => StyleSheet.flatten(b.props.style));
    expect(chips).toHaveLength(3);
    for (const chip of chips) {
      expect(chip).toMatchObject({ height: minTapTarget, borderRadius: radius.pill });
    }
    const card = screen.getByTestId('heads-up-card');
    expect(StyleSheet.flatten(card.props.style).minHeight).toBe(HEADS_UP_CARD_HEIGHT);
  });

  it('the event skeleton uses the real text heights and card heights', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await render(<EventSkeleton label="Loading the event" />);
    const heights = screen
      .getAllByTestId('skeleton-block')
      .map((b) => StyleSheet.flatten(b.props.style).height);
    expect(heights).toEqual([
      typography.label.lineHeight,
      typography.title.lineHeight,
      typography.bodySm.lineHeight,
      GAUGE_CARD_HEIGHT,
      HEADS_UP_CARD_HEIGHT,
    ]);
  });
});

describe('rating sheet swipe-to-close (VC-76)', () => {
  it('allows the swipe only before any tap and never while saving', () => {
    expect(rateSwipeAllowed(false, EMPTY_DRAFT)).toBe(true);
    expect(rateSwipeAllowed(true, EMPTY_DRAFT)).toBe(false);
    // One tap in any row, or a tag, is enough to block it.
    expect(rateSwipeAllowed(false, { ...EMPTY_DRAFT, crowd: 2 })).toBe(false);
    expect(rateSwipeAllowed(false, { ...EMPTY_DRAFT, tags: [HEADS_UP_TAGS[0].key] })).toBe(false);
  });
});
