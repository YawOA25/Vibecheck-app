/**
 * One tappable choice chip, used on the rating screen (task VC-B08) for the
 * Crowd / Music / Energy options, the reactions and the heads-up tags, and
 * on the event page for heads-up "+1"s (VC-43).
 *
 * Look (design/v3/Rate.dc.html): picked chips are gold-filled ('block') or
 * gold-edged ('pill'); unpicked ones are dark with a grey edge.
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
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, minTapTarget, radius, spacing, typography } from '@/theme';

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
}: ChoiceChipProps) {
  // The 2 px gold focus ring for keyboard and switch users (spec section 3, fix 6).
  const [focused, setFocused] = useState(false);
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
        selected && (shape === 'block' ? styles.blockSelected : styles.pillSelected),
        pressed && !selected && styles.pressed,
        focused && styles.focused,
      ]}
    >
      <Text
        style={[
          shape === 'block' ? styles.blockText : styles.pillText,
          selected && (shape === 'block' ? styles.blockTextSelected : styles.pillTextSelected),
        ]}
      >
        {/* The check mark makes "picked" visible without relying on colour. */}
        {selected ? `✓ ${label}` : label}
      </Text>
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
  blockSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  // Pills grow with their words; 44 px is the minimum tap height.
  pill: {
    minHeight: minTapTarget,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: 'transparent',
  },
  // v3: a dark gold-tinted fill with a gold edge for picked pills.
  pillSelected: { backgroundColor: '#1D1A14', borderColor: colors.accent },
  pressed: { backgroundColor: colors.surfaceRaised },
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
