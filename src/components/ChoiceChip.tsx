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
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { colors, iconSize, minTapTarget, radius, spacing, typography } from '@/theme';

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
  return (
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
        selected && (solid ? styles.blockSelected : styles.pillSelected),
        pressed && !selected && styles.pressed,
        focused && styles.focused,
      ]}
    >
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
  },
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
