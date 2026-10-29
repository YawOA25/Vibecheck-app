/**
 * The gold "LIVE" dot and pill (VC-80, home redesign Concept A).
 *
 * What it is:
 *   - LiveDot: a small gold dot that gently "breathes" (fades between full
 *     and 35% strength, 1.2 s per breath) to say "this is happening now";
 *   - LivePill: the dot plus the word LIVE in a dark pill, placed over the
 *     generated art on the hero and carousel cards, so it stays readable on
 *     any art.
 *
 * Reduce Motion (spec "Rules both concepts keep"): no pulse, the dot is a
 * plain static dot. The screen passes `animate` (it reads the setting once
 * for the whole list), so 20 dots don't each ask the phone.
 *
 * It is decoration: the card's spoken summary already says "On now", so the
 * pill is hidden from screen readers.
 *
 * How the pulse runs: one Animated loop on the opacity, on the phone's UI
 * thread (native driver), so it keeps breathing smoothly even while the
 * list is busy. The loop stops when the dot leaves the screen.
 */
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { colors, radius, typography } from '@/theme';

/** One breath (out and back in), in milliseconds. */
export const LIVE_PULSE_MS = 1200;
/** The faintest the dot gets mid-breath (35% strength). */
export const LIVE_PULSE_MIN = 0.35;
/** The word in the pill (exported for tests). */
export const LIVE_WORD = 'LIVE';

/** What a LiveDot needs. */
export interface LiveDotProps {
  /** true to pulse; false (Reduce Motion, or not known yet) for a still dot. */
  animate: boolean;
  /** The dot's size in pixels (default 6, as on the list cards). */
  size?: number;
  /** Optional id for tests. */
  testID?: string;
}

/**
 * Renders the dot.
 *
 * @returns a round gold view, breathing when `animate` is true.
 */
export function LiveDot({ animate, size = 6, testID }: LiveDotProps) {
  // The dot's strength (1 = full). Kept in state so it is made once.
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (!animate) {
      // Reduce Motion: a plain, full-strength dot.
      opacity.setValue(1);
      return undefined;
    }
    // Half a breath out, half a breath back in, forever.
    const half = LIVE_PULSE_MS / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: LIVE_PULSE_MIN,
          duration: half,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, { toValue: 1, duration: half, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      opacity.setValue(1);
    };
  }, [animate, opacity]);

  return (
    <Animated.View
      testID={testID}
      style={[
        styles.dot,
        { width: size, height: size, borderRadius: size / 2, opacity: animate ? opacity : 1 },
      ]}
    />
  );
}

/**
 * Renders the LIVE pill: the dot and the word on a dark pill.
 *
 * @param props.animate - passed on to the dot (pulse or not).
 * @returns the pill, hidden from screen readers (decoration).
 */
export function LivePill({ animate }: { animate: boolean }) {
  return (
    <View
      style={styles.pill}
      testID="live-pill"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <LiveDot animate={animate} testID="live-pill-dot" />
      <Text style={styles.word}>{LIVE_WORD}</Text>
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  dot: { backgroundColor: colors.accent },
  // A dark pill (the page background), so the word reads on any art.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.bg,
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  word: { ...typography.label, fontSize: 11, lineHeight: 14, color: colors.text },
});
