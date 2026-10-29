/**
 * Tests for one map tag's motion and large-text layout (VC-83 map v2
 * Batch 2, src/components/MapTag.tsx), drawn on its own inside the fake
 * react-native-maps (__mocks__/react-native-maps.js).
 *
 * We check:
 *   - the live pulse: 'moving' starts a looping ring after the event's own
 *     delay, on the native driver, 2.4 s per ring; 'still' shows a still
 *     ring and never starts a loop (Reduce Motion / screen not in view);
 *     'off' draws no ring;
 *   - the band cross-fade: when the band changes, the old dot stays on top
 *     and fades out over 400 ms, then goes; under Reduce Motion the change
 *     is instant (no fading dot at all);
 *   - large text: from a 1.3x text size the score sits under the name.
 *
 * Native-driver opacity never moves in Jest, so we check the animation
 * calls rather than the opacity itself (lesson VC-76).
 */
import { act, render, screen } from '@testing-library/react-native';
import { Animated, StyleSheet } from 'react-native';

import { BAND_FADE_MS, MapTag } from '@/components/MapTag';
import type { MapTagProps } from '@/components/MapTag';
import { PULSE_MS } from '@/lib/map-cluster';

// The phone's text size, changed per test (1 = normal).
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));
// map-cluster imports map-read, which imports the server client.
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

/**
 * A tag with sensible defaults.
 *
 * @param overrides - props to change from a Hot 7.4 tag.
 * @returns the element.
 */
function tag(overrides: Partial<MapTagProps> = {}) {
  return (
    <MapTag
      coordinate={{ latitude: 38.9, longitude: -77 }}
      name="Shaw kickback"
      trailing="7.4"
      trailingIsScore
      dot={{ kind: 'band', band: 'Hot' }}
      picked={false}
      onPress={() => undefined}
      spoken="Shaw kickback, house party, area only, Shaw, Hot, 7.4"
      animate
      testID="t"
      {...overrides}
    />
  );
}

/** Fakes Animated.loop so tests can see when a pulse starts and stops. */
function spyLoop() {
  const start = jest.fn();
  const stop = jest.fn();
  const loop = jest.spyOn(Animated, 'loop').mockReturnValue({ start, stop, reset: jest.fn() });
  return { loop, start, stop };
}

afterEach(() => {
  mockFontScale = 1;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('MapTag pulse', () => {
  it('starts a slow looping ring after its own delay', async () => {
    jest.useFakeTimers();
    const timing = jest.spyOn(Animated, 'timing');
    const { loop, start } = spyLoop();
    await render(tag({ pulse: 'moving', pulseDelay: 700 }));
    expect(screen.getByTestId('t-pulse', { includeHiddenElements: true })).toBeTruthy();
    expect(loop).toHaveBeenCalledTimes(1);
    // One ring every 2.4 s, on the native driver.
    expect(timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: PULSE_MS, useNativeDriver: true }),
    );
    // Not before this tag's delay, so tags don't pulse in step.
    expect(start).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTimeAsync(700));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('stops the ring when the tag no longer pulses', async () => {
    jest.useFakeTimers();
    const { stop } = spyLoop();
    const view = await render(tag({ pulse: 'moving' }));
    await view.rerender(tag({ pulse: 'still' }));
    expect(stop).toHaveBeenCalled();
  });

  it('shows a still ring and never moves under Reduce Motion', async () => {
    const { loop } = spyLoop();
    await render(tag({ pulse: 'still', animate: false }));
    const ring = screen.getByTestId('t-pulse', { includeHiddenElements: true });
    expect(StyleSheet.flatten(ring.props.style).opacity).toBe(0.5);
    expect(loop).not.toHaveBeenCalled();
  });

  it('draws no ring when off', async () => {
    await render(tag());
    expect(screen.queryByTestId('t-pulse', { includeHiddenElements: true })).toBeNull();
  });
});

describe('MapTag band cross-fade', () => {
  it('fades the old band out over 400 ms when the band changes', async () => {
    jest.useFakeTimers();
    const timing = jest.spyOn(Animated, 'timing');
    const view = await render(tag());
    expect(screen.queryByTestId('t-ghost')).toBeNull();
    timing.mockClear();
    await view.rerender(tag({ dot: { kind: 'band', band: 'Fire' }, trailing: '9.1' }));
    // The old (Hot) dot is still there, on top, fading.
    expect(screen.getByTestId('t-ghost')).toBeOnTheScreen();
    expect(timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: 0, duration: BAND_FADE_MS, useNativeDriver: true }),
    );
    // Once the fade is over, only the new dot is left.
    await act(() => jest.advanceTimersByTimeAsync(BAND_FADE_MS + 50));
    expect(screen.queryByTestId('t-ghost')).toBeNull();
  });

  it('does not fade when only the score changes within the band', async () => {
    const view = await render(tag());
    await view.rerender(tag({ trailing: '7.9' }));
    expect(screen.queryByTestId('t-ghost')).toBeNull();
  });

  it('changes at once under Reduce Motion', async () => {
    const view = await render(tag({ animate: false }));
    await view.rerender(tag({ animate: false, dot: { kind: 'band', band: 'Fire' } }));
    expect(screen.queryByTestId('t-ghost')).toBeNull();
  });
});

describe('MapTag large text', () => {
  it('keeps name and score on one line at normal sizes', async () => {
    await render(tag());
    expect(screen.queryByTestId('t-stacked')).toBeNull();
  });

  it('drops the score under the name from 1.3x text', async () => {
    mockFontScale = 1.5;
    await render(tag());
    expect(screen.getByTestId('t-stacked')).toHaveTextContent('Shaw kickback7.4');
  });
});
