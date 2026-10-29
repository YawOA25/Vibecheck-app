/**
 * A small two-option pill switch (VC-54), first used for "Live / All night"
 * on the vibe card. Built to be reused for any later two-way toggle.
 *
 * Look (design spec, section 4): a pill with a 1 px field-border edge; the
 * picked option is a light pill with dark bold text, the other is plain
 * grey text. Each option is 36 tall, with extra touch area to reach 44.
 *
 * Screen readers: the pill is a "tab list" and each option a "tab" that says
 * whether it's picked, with its own spoken name (e.g. "Live score").
 *
 * Sliding thumb (VC-76, design/vc76-motion-spec.md 3b): the light pill
 * behind the picked option is ONE shape (the "thumb") that slides across
 * to the other option over 200 ms instead of jumping. Its position and
 * width come from measuring the two options once they are laid out (until
 * then, and in tests, the picked option simply draws its own light
 * background, as before). The words change colour halfway through the
 * slide, when the thumb is about to reach them. Under Reduce Motion the
 * thumb jumps straight there and the words change at once.
 *
 * Why the slide doesn't use the native driver: the thumb's width changes
 * too ("Live" is narrower than "All night"), and React Native can only run
 * position, scale and opacity animations on the UI thread, not width. The
 * thumb is tiny, so the JavaScript-side animation is still smooth.
 *
 * The thumb keeps the existing light colour (`colors.text`), not the
 * spec's gold, so the switch looks exactly as it did; only the movement is
 * new (flagged to the founder as an open question).
 */
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

import { motionAllowed, reduceMotionNow } from '@/lib/reduce-motion';
import { colors, fonts, motion } from '@/theme';

/** One option of the switch. */
export interface SwitchOption<K extends string> {
  /** The value it stands for. */
  key: K;
  /** The words on screen, e.g. "Live". */
  label: string;
  /** What a screen reader says, e.g. "Live score". */
  spoken: string;
}

/** What a TwoWaySwitch needs. */
export interface TwoWaySwitchProps<K extends string> {
  /** The two options, left then right. */
  options: readonly [SwitchOption<K>, SwitchOption<K>];
  /** The picked option's key. */
  value: K;
  /** Called with the new key when the other option is tapped. */
  onChange: (key: K) => void;
}

/** Where one option sits inside the pill (from its layout). */
interface Slot {
  x: number;
  width: number;
}

/**
 * Renders the switch.
 *
 * @returns the pill with its two options.
 */
export function TwoWaySwitch<K extends string>({ options, value, onChange }: TwoWaySwitchProps<K>) {
  // The two options' measured places (null until laid out).
  const [slots, setSlots] = useState<[Slot | null, Slot | null]>([null, null]);
  // Thumb position: 0 = on the left option, 1 = on the right one.
  const pickedIndex = options[1].key === value ? 1 : 0;
  const [pos] = useState(() => new Animated.Value(pickedIndex));
  // Which option's words are drawn as "picked". It follows `value`, but
  // halfway through the slide (VC-76), so the colour change meets the thumb.
  const [litKey, setLitKey] = useState<K>(value);

  useEffect(() => {
    const moving = motionAllowed(reduceMotionNow());
    // State is only set inside the timer, never straight in the effect.
    const timer = setTimeout(() => setLitKey(value), moving ? motion.base.duration / 2 : 0);
    if (!moving) {
      pos.setValue(pickedIndex);
      return () => clearTimeout(timer);
    }
    const slide = Animated.timing(pos, {
      toValue: pickedIndex,
      duration: motion.base.duration,
      easing: motion.base.easing,
      // Width can't run on the UI thread (see the file comment).
      useNativeDriver: false,
    });
    slide.start();
    return () => {
      clearTimeout(timer);
      slide.stop();
    };
  }, [value, pickedIndex, pos]);

  /**
   * Remembers where an option was laid out, for the thumb.
   *
   * @param index - 0 for the left option, 1 for the right one.
   * @param event - the layout event with the option's x and width.
   */
  function measure(index: 0 | 1, event: LayoutChangeEvent) {
    const { x, width } = event.nativeEvent.layout;
    setSlots((current) => {
      const next: [Slot | null, Slot | null] = [current[0], current[1]];
      next[index] = { x, width };
      return next;
    });
  }

  const [left, right] = slots;
  const measured = left !== null && right !== null;

  return (
    <View style={styles.pill} accessibilityRole="tablist">
      {measured ? (
        // The sliding thumb, drawn behind the words; decoration only.
        <Animated.View
          testID="switch-thumb"
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              left: pos.interpolate({ inputRange: [0, 1], outputRange: [left.x, right.x] }),
              width: pos.interpolate({
                inputRange: [0, 1],
                outputRange: [left.width, right.width],
              }),
            },
          ]}
        />
      ) : null}
      {options.map((option, index) => {
        const selected = option.key === value;
        const lit = option.key === litKey;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.spoken}
            // 36 tall + 4 above and below = a 44 tall touch area.
            hitSlop={{ top: 4, bottom: 4 }}
            onLayout={(event) => measure(index === 0 ? 0 : 1, event)}
            onPress={() => {
              if (!selected) onChange(option.key);
            }}
            style={({ pressed }) => [
              styles.segment,
              // Before measuring (first frame, tests): the old static look.
              !measured && selected && styles.segmentSelected,
              // VC-76: a lighter background under a finger on the other option.
              pressed && !selected && styles.segmentPressed,
            ]}
          >
            <Text style={[styles.text, lit && styles.textSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    padding: 2,
  },
  segment: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    justifyContent: 'center',
  },
  segmentSelected: { backgroundColor: colors.text },
  segmentPressed: { backgroundColor: colors.surfaceRaised },
  // The sliding light pill: same height and roundness as an option.
  thumb: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    borderRadius: 999,
    backgroundColor: colors.text,
  },
  text: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18, color: colors.muted },
  textSelected: { fontFamily: fonts.bodyBold, color: colors.bg },
});
