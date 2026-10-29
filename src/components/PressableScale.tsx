/**
 * PressableScale: a Pressable that shrinks a little while a finger is on it
 * (VC-76, spec 3a "Press feedback on every tappable item").
 *
 * Why it exists: a tap should feel answered. Cards, rows and the main gold
 * button now all shrink by the same small amount (0.97 to 0.98, the
 * `motion.pressScale` tokens) over 120 ms, then spring back on release.
 * Before VC-76 only the home list's event card did this, with its own copy
 * of the code; this is that code, shared.
 *
 * How it works: the Pressable sits inside an Animated.View. Only the outer
 * view's size animates, on the phone's UI thread (native driver), so it
 * stays smooth. The Pressable keeps everything else: its own pressed
 * colours, its screen-reader role and label, and its tap handlers.
 *
 * Reduce Motion: no shrinking at all. The pressed colours still show. The
 * screen can pass `animate` (true or false) when it already knows the
 * answer (e.g. the home list reads it once for 100 cards); otherwise the
 * shared answer from reduceMotionNow() is used at the moment of the press.
 */
import { useState } from 'react';
import { Animated, Pressable } from 'react-native';
import type { GestureResponderEvent, PressableProps, StyleProp, ViewStyle } from 'react-native';

import { motionAllowed, reduceMotionNow } from '@/lib/reduce-motion';
import { motion } from '@/theme';

/** What a PressableScale needs: everything a Pressable takes, plus these. */
export interface PressableScaleProps extends PressableProps {
  /** How small it gets while pressed (default 0.97, `motion.pressScale.row`). 1 = never. */
  scaleTo?: number;
  /**
   * true or false to force the shrink on or off (the screen already knows
   * the Reduce Motion answer). Leave it out to ask reduceMotionNow().
   */
  animate?: boolean;
  /** Style for the outer (shrinking) view, e.g. `{ flex: 1 }` inside a row. */
  outerStyle?: StyleProp<ViewStyle>;
  /** Test id for the outer (shrinking) view. */
  outerTestID?: string;
}

/**
 * Renders the shrinking wrapper and the Pressable inside it.
 *
 * @returns an Animated.View holding a Pressable.
 */
export function PressableScale({
  scaleTo = motion.pressScale.row,
  animate,
  outerStyle,
  outerTestID,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  // The current size (1 = normal). Kept in state so it is made once.
  const [scale] = useState(() => new Animated.Value(1));

  /**
   * Whether this press may shrink the view.
   *
   * @returns false under Reduce Motion (or while the phone hasn't answered),
   *   and when scaleTo is 1 (nothing to do).
   */
  function mayMove(): boolean {
    if (scaleTo === 1) return false;
    return animate ?? motionAllowed(reduceMotionNow());
  }

  /**
   * Finger down: shrink over 120 ms (motion.fast).
   *
   * @param event - the touch, passed on to the caller's own onPressIn.
   */
  function handlePressIn(event: GestureResponderEvent) {
    if (mayMove()) {
      Animated.timing(scale, {
        toValue: scaleTo,
        duration: motion.fast.duration,
        easing: motion.fast.easing,
        useNativeDriver: true,
      }).start();
    } else {
      // Motion off: never shrink (and undo any shrink left from before).
      scale.setValue(1);
    }
    onPressIn?.(event);
  }

  /**
   * Finger up: spring back to full size, quickly and with no wobble.
   *
   * @param event - the touch, passed on to the caller's own onPressOut.
   */
  function handlePressOut(event: GestureResponderEvent) {
    if (mayMove()) {
      Animated.spring(scale, {
        toValue: 1,
        speed: motion.releaseSpring.speed,
        bounciness: motion.releaseSpring.bounciness,
        useNativeDriver: true,
      }).start();
    } else {
      scale.setValue(1);
    }
    onPressOut?.(event);
  }

  return (
    // The shrinking wrapper is not a button itself, so screen readers still
    // meet exactly one button (the Pressable) here.
    <Animated.View style={[outerStyle, { transform: [{ scale }] }]} testID={outerTestID}>
      <Pressable {...rest} onPressIn={handlePressIn} onPressOut={handlePressOut} />
    </Animated.View>
  );
}
