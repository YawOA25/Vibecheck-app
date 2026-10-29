/**
 * FadeIn: shows its content by fading it in from see-through (VC-76, spec 2a).
 *
 * Why it exists: before VC-76, most screens swapped a skeleton or spinner
 * for the real content in one frame, at full strength, which feels like a
 * jolt. Wrapping a screen's "ready" content in FadeIn makes that swap a soft
 * 200 ms fade. The skeleton disappears in the same frame the content starts
 * fading in, so together it reads as a cross-fade.
 *
 * When it fades:
 *   - when it first appears (mount);
 *   - again whenever `fadeKey` changes (e.g. the home list after a filter
 *     change). Leave `fadeKey` out to fade only once.
 * It does NOT fade on ordinary re-renders, so a refresh that swaps the data
 * in place never blinks.
 *
 * Reduce Motion: a fade moves nothing, so it is allowed, but it is cut to
 * 100 ms (spec section 4). The answer comes from reduceMotionNow(); while
 * the phone hasn't answered, the short fade is used.
 *
 * It uses a layout effect (runs before the first frame is drawn), so the
 * content never shows at full strength for one frame before the fade starts.
 */
import { useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { reduceMotionNow } from '@/lib/reduce-motion';
import { motion } from '@/theme';

/** What a FadeIn needs. */
export interface FadeInProps {
  /** The content to fade in. */
  children: ReactNode;
  /** Changing this value fades the content in again (optional). */
  fadeKey?: string | number;
  /** Style for the wrapper (e.g. `{ flex: 1 }` to fill the screen). */
  style?: StyleProp<ViewStyle>;
  /** Optional id for tests. */
  testID?: string;
}

/**
 * How long a fade-in takes right now.
 *
 * @returns 200 ms when motion is known to be allowed, 100 ms under Reduce
 *   Motion or while the phone hasn't answered yet.
 */
export function fadeInDuration(): number {
  return reduceMotionNow() === false ? motion.base.duration : motion.reducedFade;
}

/**
 * Renders the fading wrapper.
 *
 * @returns an Animated.View around the children.
 */
export function FadeIn({ children, fadeKey, style, testID }: FadeInProps) {
  // The wrapper's opacity (0 = invisible, 1 = fully shown). It starts at 0
  // so the very first frame is already see-through. Kept in state so it is
  // made once (lesson: useRef().current in render fails the lint rules).
  const [opacity] = useState(() => new Animated.Value(0));

  useLayoutEffect(() => {
    opacity.setValue(0);
    const fade = Animated.timing(opacity, {
      toValue: 1,
      duration: fadeInDuration(),
      easing: motion.base.easing,
      // Opacity can run on the phone's UI thread, so it stays smooth even
      // while JavaScript is busy drawing the new content.
      useNativeDriver: true,
    });
    fade.start();
    // If the content changes again mid-fade, finish at full strength; the
    // next run starts its own fade.
    return () => {
      fade.stop();
      opacity.setValue(1);
    };
  }, [fadeKey, opacity]);

  return (
    <Animated.View style={[style, { opacity }]} testID={testID}>
      {children}
    </Animated.View>
  );
}
