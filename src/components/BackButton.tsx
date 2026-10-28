/**
 * The round "Back" button from the v3 design: a 44 px circle with a thin grey
 * edge and a left-pointing chevron line icon (spec section 1, "Shape and
 * space"; the icon replaced a "‹" text character in Q4).
 *
 * Why its own component: it will be reused on later screens, and it keeps
 * the 44 px tap size and the "Back" screen-reader label in one place.
 */
import { Pressable, StyleSheet } from 'react-native';

import { Icon } from '@/components/Icon';
import { colors, iconSize, minTapTarget } from '@/theme';

/** What a BackButton needs. */
export interface BackButtonProps {
  /** What happens on tap. */
  onPress: () => void;
  /** Ignores taps while true (for example while the server is busy). */
  disabled?: boolean;
}

/**
 * Renders the back button.
 *
 * @returns the button view, read by screen readers as "Back, button".
 */
export function BackButton({ onPress, disabled }: BackButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Back"
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [styles.circle, pressed && styles.pressed]}
    >
      {/* The chevron is decoration; the "Back" label above is what screen
          readers say. Icons don't grow with text size, so it always fits. */}
      <Icon name="chevron-left" size={iconSize.md} color={colors.text} />
    </Pressable>
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.surface },
});
