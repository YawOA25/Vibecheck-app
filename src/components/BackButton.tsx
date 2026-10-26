/**
 * The round "Back" button from the v3 design: a 44 px circle with a thin grey
 * edge and a left-pointing arrow (spec section 1, "Shape and space").
 *
 * Why its own component: it will be reused on later screens, and it keeps
 * the 44 px tap size and the "Back" screen-reader label in one place.
 */
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, minTapTarget } from '@/theme';

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
      {/* "‹" drawn as text: no icon package needed. allowFontScaling is off
          so the arrow can't outgrow its fixed-size circle. */}
      <Text style={styles.arrow} allowFontScaling={false}>
        {'‹'}
      </Text>
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
  // Nudged up 2 px: the glyph sits low in its line box.
  arrow: { color: colors.text, fontSize: 28, lineHeight: 30, marginTop: -2 },
});
