/**
 * One tappable choice chip, used on the rating screen (task VC-B08) for the
 * Crowd / Music / Energy options, the reactions and the heads-up tags, and
 * on the event page for heads-up "+1"s (VC-43).
 *
 * Look (design/v3/Rate.dc.html): picked chips are gold-filled ('block') or
 * gold-edged ('pill'); unpicked ones are dark with a grey edge.
 *
 * Pill fills (Q6, polish audit note): v3 uses two picked-pill looks.
 *   - 'tint' (default): a dark gold-tinted fill with a gold edge. v3's
 *     multi-select look (several can be on), e.g. heads-up tags.
 *   - 'solid': a solid gold fill with dark (onAccent) text. v3's
 *     single-select look, e.g. the Tonight date filter (only one is on).
 *
 * Accessibility (v3 spec section 3, fix 9): being picked is never shown by
 * colour alone. A picked chip also shows a check mark, and screen readers
 * hear "selected" (or "checked" for a radio). Every chip is at least 44 px
 * tall (fix 4).
 *
 * Two roles (proposal VC-49, cto debt from B08):
 *   - 'button' (default): a chip you switch on and off on its own, such as
 *     a heads-up tag or the optional reaction;
 *   - 'radio': one of a set where exactly one is picked, such as the three
 *     Crowd choices. Screen readers then say "radio button, 2 of 3" and
 *     "checked". Put radio chips inside a View with
 *     accessibilityRole="radiogroup" so they are read as one group.
 *
 * Selection motion (VC-76, design/vc76-motion-spec.md 3b): the picked
 * colour is a separate layer inside the chip (`chip-selected-layer`) whose
 * opacity fades in or out over 120 ms, on the phone's UI thread (a
 * background colour itself can't be animated there). Becoming picked also
 * gives a small one-time "pop" (96% back to full size). Under Reduce
 * Motion the fade stays but takes 100 ms, and there is no pop. Nothing
 * animates when the chip first appears, only when its pick changes.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { motionAllowed, reduceMotionNow } from '@/lib/reduce-motion';
import { colors, iconSize, minTapTarget, motion, radius, spacing, typography } from '@/theme';

/** The size a chip "pops" from when it becomes picked (VC-76). */
export const CHIP_POP_SCALE = 0.96;

/** What a ChoiceChip needs. */
export interface ChoiceChipProps {
  /** The words on the chip. */
  label: string;
  /** true when this chip is picked. */
  selected: boolean;
  /** What a tap does. */
  onPress: () => void;
  /**
   * 'block' (default): the 48 px rounded box used in the three rating rows
   * (three side by side, sharing the width).
   * 'pill': a rounded pill sized to its words, for reactions and tags.
   */
  shape?: 'block' | 'pill';
  /** What screen readers say instead of the label (e.g. without the emoji). */
  accessibilityLabel?: string;
  /** An extra hint for screen readers (e.g. "Tap to +1"). */
  accessibilityHint?: string;
  /** true to make it untappable (e.g. while saving). */
  disabled?: boolean;
  /**
   * What screen readers call it: 'button' (default) for an on/off chip, or
   * 'radio' for one choice in a pick-one row (see the file comment).
   */
  role?: 'button' | 'radio';
  /**
   * How a picked PILL is filled: 'tint' (default, multi-select look) or
   * 'solid' (gold fill, single-select look). Blocks are always solid gold.
   */
  pickedFill?: 'tint' | 'solid';
}

/**
 * Renders the chip.
 *
 * @returns the chip view. Screen readers hear it as a button with a
 *   "selected" state, or (role 'radio') as a radio button with a "checked"
 *   state.
 */
export function ChoiceChip({
  label,
  selected,
  onPress,
  shape = 'block',
  accessibilityLabel,
  accessibilityHint,
  disabled,
  role = 'button',
  pickedFill = 'tint',
}: ChoiceChipProps) {
  // The 2 px gold focus ring for keyboard and switch users (spec section 3, fix 6).
  const [focused, setFocused] = useState(false);
  // A picked chip with a solid gold fill: every picked block, and pills
  // that ask for the single-select look. Their check and words go dark.
  const solid = shape === 'block' || pickedFill === 'solid';

  // VC-76: the picked layer's opacity (1 = picked colour fully shown) and
  // the chip's size for the pop. Kept in state so they are made once.
  const [layer] = useState(() => new Animated.Value(selected ? 1 : 0));
  const [pop] = useState(() => new Animated.Value(1));
  // The pick as of the last run, so the first appearance doesn't animate.
  const lastSelected = useRef(selected);
  useEffect(() => {
    if (lastSelected.current === selected) return undefined;
    lastSelected.current = selected;
    const moving = motionAllowed(reduceMotionNow());
    const fade = Animated.timing(layer, {
      toValue: selected ? 1 : 0,
      // Fades are fine under Reduce Motion, just shorter (100 ms).
      duration: moving ? motion.fast.duration : motion.reducedFade,
      easing: motion.fast.easing,
      useNativeDriver: true,
    });
    fade.start();
    if (selected && moving) {
      // The one-time pop: start a touch small, settle at full size.
      pop.setValue(CHIP_POP_SCALE);
      Animated.timing(pop, {
        toValue: 1,
        duration: motion.fast.duration,
        easing: motion.fast.easing,
        useNativeDriver: true,
      }).start();
    }
    return () => fade.stop();
  }, [selected, layer, pop]);

  return (
    // The popping wrapper. Blocks share a row's width, so it takes their flex.
    <Animated.View
      style={[shape === 'block' && styles.blockOuter, { transform: [{ scale: pop }] }]}
      testID="chip-pop"
    >
      <Pressable
        onPress={onPress}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityRole={role}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        // A radio says "checked" / "not checked"; a button says "selected".
        accessibilityState={
          role === 'radio'
            ? { checked: selected, disabled: Boolean(disabled) }
            : { selected, disabled: Boolean(disabled) }
        }
        style={({ pressed }) => [
          styles.base,
          shape === 'block' ? styles.block : styles.pill,
          // The picked EDGE changes at once; the picked FILL is the layer below.
          selected && (solid ? styles.blockSelectedEdge : styles.pillSelectedEdge),
          pressed && !selected && styles.pressed,
          focused && styles.focused,
        ]}
      >
        {/* VC-76: the picked fill, fading in and out. Decoration only. */}
        <Animated.View
          testID="chip-selected-layer"
          pointerEvents="none"
          style={[
            styles.layer,
            solid ? styles.blockSelected : styles.pillSelected,
            { opacity: layer },
          ]}
        />
        <View style={styles.content}>
          {/* The check mark (a line icon since Q4) makes "picked" visible
            without relying on colour. It matches the label's colour: dark
            on a gold block, gold on a pill. Screen readers skip it and
            hear "selected" instead. */}
          {selected ? (
            <Icon name="check" size={iconSize.sm} color={solid ? colors.onAccent : colors.accent} />
          ) : null}
          <Text
            style={[
              styles.label,
              shape === 'block' ? styles.blockText : styles.pillText,
              selected && (solid ? styles.blockTextSelected : styles.pillTextSelected),
            ]}
          >
            {label}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** Styles built from theme tokens and the v3 Rate screen's sizes. */
const styles = StyleSheet.create({
  base: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    backgroundColor: colors.surface,
    // Keeps the picked layer inside the rounded corners.
    overflow: 'hidden',
  },
  // A block's wrapper takes the block's share of the row (VC-76).
  blockOuter: { flex: 1 },
  // The picked fill layer covers the whole chip, behind the words.
  layer: { ...StyleSheet.absoluteFill },
  blockSelectedEdge: { borderColor: colors.accent },
  pillSelectedEdge: { borderColor: colors.accent },
  // v3: 48 px tall, radius 14, three to a row.
  block: { flex: 1, minHeight: 48, borderRadius: radius.field, paddingHorizontal: spacing.xs },
  // Solid gold: picked blocks, and picked pills with pickedFill 'solid'.
  blockSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  // Pills grow with their words; 44 px is the minimum tap height.
  pill: {
    minHeight: minTapTarget,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: 'transparent',
  },
  // v3: a dark gold-tinted fill with a gold edge for picked pills.
  pillSelected: { backgroundColor: colors.accentTint, borderColor: colors.accent },
  pressed: { backgroundColor: colors.surfaceRaised },
  // The check icon and the words side by side, centred in the chip.
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  // Lets long words wrap inside a narrow block instead of overflowing.
  label: { flexShrink: 1 },
  focused: { borderWidth: 2, borderColor: colors.accent },
  blockText: {
    ...typography.button,
    fontSize: 15,
    color: colors.text,
    textAlign: 'center',
  },
  // Dark text on gold reads at 9.8:1.
  blockTextSelected: { color: colors.onAccent },
  pillText: { ...typography.caption, fontFamily: typography.button.fontFamily, color: colors.text },
  // Gold text on the dark fill reads at about 9:1.
  pillTextSelected: { color: colors.accent },
});
