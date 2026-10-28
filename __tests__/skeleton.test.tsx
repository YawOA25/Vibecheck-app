/**
 * Tests for the Q6 loading and status pieces:
 *   - the skeletons (src/components/Skeleton.tsx): three card blocks on the
 *     home list, heading lines plus card blocks on the event page, all in
 *     surfaceRaised with radius 6 (lines) or 20 (cards), read out as one
 *     "Loading ..." item;
 *   - the pulse: a 1.2 s opacity loop (two 600 ms halves down to 50%) when
 *     motion is allowed, and none under Reduce Motion or before the phone
 *     answers; turning Reduce Motion on later stops it;
 *   - motionAllowed (src/lib/reduce-motion.ts): only a clear "off" allows motion;
 *   - StatusPanel: the alert icon with an announced sentence for errors,
 *     and the moon with a heading for quiet states.
 */
import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';

import { EventSkeleton, LINE_RADIUS, ListSkeleton, PULSE_MS } from '@/components/Skeleton';
import { StatusPanel } from '@/components/StatusPanel';
import { motionAllowed } from '@/lib/reduce-motion';
import { colors, radius } from '@/theme';

// The fake loop the skeleton starts, so we can see start and stop calls.
const loopStart = jest.fn();
const loopStop = jest.fn();
let loopSpy: jest.SpyInstance;
let timingSpy: jest.SpyInstance;
// The phone's "Reduce Motion changed" listener, captured from the spy.
let motionListener: ((on: boolean) => void) | null = null;

/**
 * Makes the phone answer the Reduce Motion question.
 *
 * @param on - true when Reduce Motion is on.
 */
function setReduceMotion(on: boolean) {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(on);
}

beforeEach(() => {
  motionListener = null;
  loopStart.mockClear();
  loopStop.mockClear();
  loopSpy = jest
    .spyOn(Animated, 'loop')
    .mockReturnValue({ start: loopStart, stop: loopStop, reset: jest.fn() });
  timingSpy = jest.spyOn(Animated, 'timing');
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
    _name: string,
    handler: (on: boolean) => void,
  ) => {
    motionListener = handler;
    return { remove: jest.fn() };
  }) as unknown as typeof AccessibilityInfo.addEventListener);
});

afterEach(() => jest.restoreAllMocks());

/**
 * Reads one block's flattened style.
 *
 * @param index - which block (in drawing order).
 * @returns the style object.
 */
function blockStyle(index: number) {
  return StyleSheet.flatten(screen.getAllByTestId('skeleton-block')[index].props.style);
}

describe('ListSkeleton', () => {
  it('draws three card-shaped blocks in surfaceRaised, radius 20, read as one item', async () => {
    setReduceMotion(true);
    await render(<ListSkeleton label="Loading events" />);
    expect(screen.getByLabelText('Loading events')).toBeOnTheScreen();
    expect(screen.getAllByTestId('skeleton-block')).toHaveLength(3);
    for (const i of [0, 1, 2]) {
      expect(blockStyle(i).backgroundColor).toBe(colors.surfaceRaised);
      expect(blockStyle(i).borderRadius).toBe(radius.card);
    }
  });

  it('pulses over 1.2 s (two 600 ms halves, down to 50%) when motion is allowed', async () => {
    setReduceMotion(false);
    await render(<ListSkeleton label="Loading events" />);
    expect(loopSpy).toHaveBeenCalledTimes(1);
    expect(loopStart).toHaveBeenCalledTimes(1);
    const halves = timingSpy.mock.calls.map((call) => call[1]);
    expect(halves).toEqual([
      expect.objectContaining({ toValue: 0.5, duration: PULSE_MS / 2 }),
      expect.objectContaining({ toValue: 1, duration: PULSE_MS / 2 }),
    ]);
  });

  it('stays still under Reduce Motion', async () => {
    setReduceMotion(true);
    await render(<ListSkeleton label="Loading events" />);
    expect(loopSpy).not.toHaveBeenCalled();
    expect(StyleSheet.flatten(screen.getByTestId('list-skeleton').props.style).opacity).toBe(1);
  });

  it('stops pulsing when Reduce Motion is turned on while it shows', async () => {
    setReduceMotion(false);
    await render(<ListSkeleton label="Loading events" />);
    expect(loopStart).toHaveBeenCalledTimes(1);
    await act(async () => motionListener?.(true));
    expect(loopStop).toHaveBeenCalled();
    // No new loop starts after the switch.
    expect(loopStart).toHaveBeenCalledTimes(1);
  });
});

describe('EventSkeleton', () => {
  it('draws heading lines (radius 6) and card blocks (radius 20)', async () => {
    setReduceMotion(true);
    await render(<EventSkeleton label="Loading the event" />);
    expect(screen.getByLabelText('Loading the event')).toBeOnTheScreen();
    const radii = screen
      .getAllByTestId('skeleton-block')
      .map((b) => StyleSheet.flatten(b.props.style).borderRadius);
    expect(radii).toEqual([LINE_RADIUS, LINE_RADIUS, LINE_RADIUS, radius.card, radius.card]);
    expect(LINE_RADIUS).toBe(6);
  });
});

describe('motionAllowed', () => {
  it('allows motion only when Reduce Motion is known to be off', () => {
    expect(motionAllowed(false)).toBe(true);
    expect(motionAllowed(true)).toBe(false);
    expect(motionAllowed(null)).toBe(false);
  });
});

describe('StatusPanel', () => {
  it('error: the alert icon and the sentence, read out as an alert', async () => {
    await render(<StatusPanel tone="error" message="We couldn't load events." />);
    expect(screen.getByTestId('status-icon-alert')).toBeOnTheScreen();
    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load events.");
  });

  it('quiet: the moon, a heading and a plain sentence (not an alert)', async () => {
    await render(<StatusPanel tone="quiet" title="Event not found" message="It may be gone." />);
    expect(screen.getByTestId('status-icon-moon')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Event not found' })).toBeOnTheScreen();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
