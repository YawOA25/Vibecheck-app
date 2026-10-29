/**
 * A round 44 px icon button from the v3 design: a dark circle with a thin
 * edge and one line icon in the middle (Q5: the event page's Back and Share,
 * the Rate screen's Close; the Back button has used this look since Q4).
 *
 * Why its own component: Back, Share and Close must look and behave the
 * same way: the same 44 px tap size (easy to hit with a thumb), the same
 * edge, and a spoken label, because the icon itself says nothing to a
 * screen reader.
 *
 * The edge uses `fieldBorder` (the designer's accessibility fix: 3.7 on the
 * background) instead of v3's fainter #2B2B31, so the circle is visible to
 * people with low vision. The fill is the screen background (v3's "dark
 * circle"), which matters when the button sits over something lighter.
 *
 * Press feel (VC-76, spec 3a): besides the lighter fill, the circle shrinks
 * to 96% while pressed and springs back (not under Reduce Motion; see
 * src/components/PressableScale.tsx).
 */
import { StyleSheet } from 'react-native';

import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { colors, iconSize, minTapTarget, motion } from '@/theme';

/** What a CircleIconButton needs. */
export interface CircleIconButtonProps {
  /** Which line icon to draw, e.g. 'share'. */
  icon: IconName;
  /** What screen readers say, e.g. "Share". Required: the icon alone means nothing to them. */
  label: string;
  /** What happens on tap. */
  onPress: () => void;
  /** Ignores taps while true (for example while the server is busy). */
  disabled?: boolean;
  /** Icon size in pixels. Default 20 (`iconSize.md`); v3's Close uses 16. */
  iconPx?: number;
  /** Optional id for tests. */
  testID?: string;
}

/**
 * Renders the round icon button.
 *
 * @returns the button view, read by screen readers as e.g. "Share, button".
 */
export function CircleIconButton({
  icon,
  label,
  onPress,
  disabled,
  iconPx = iconSize.md,
  testID,
}: CircleIconButtonProps) {
  return (
    <PressableScale
      scaleTo={motion.pressScale.circle}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      testID={testID}
      style={({ pressed }) => [styles.circle, pressed && styles.pressed]}
    >
      {/* Decoration only; the label above is what screen readers say. Icons
          don't grow with text size, so it always fits the circle. */}
      <Icon name={icon} size={iconPx} color={colors.text} />
    </PressableScale>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  circle: {
    width: minTapTarget,
    height: minTapTarget,
    borderRadius: minTapTarget / 2,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A finger on the button lightens the fill one step, as on cards.
  pressed: { backgroundColor: colors.surface },
});
