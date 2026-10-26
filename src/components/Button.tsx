/**
 * The app's button, in two looks:
 *   - 'primary': a filled accent-colored button for the main action on a screen
 *   - 'text'   : a plain text link for smaller actions ("Sign out")
 *
 * Why one shared component: every screen gets the same size (at least 48 px
 * tall, easy to hit with a thumb), the same colors and the same screen-reader
 * behavior, without repeating styles.
 */
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors, minTapTarget, radius, spacing, typography } from '@/theme';

/** What a Button needs. */
export interface ButtonProps {
  /** The words on the button (also read out by screen readers). */
  label: string;
  /** What happens on tap. */
  onPress: () => void;
  /** 'primary' (default) or 'text'. */
  variant?: 'primary' | 'text';
  /** Greys the button out and ignores taps. */
  disabled?: boolean;
  /** Shows a spinner instead of the label and ignores taps (while waiting on the server). */
  busy?: boolean;
}

/**
 * Renders a tappable button.
 *
 * @returns the button view.
 */
export function Button({ label, onPress, variant = 'primary', disabled, busy }: ButtonProps) {
  const inactive = Boolean(disabled || busy);
  const primary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      // Screen readers announce this as a button, with its label and state.
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: Boolean(busy) }}
      style={({ pressed }) => [
        styles.base,
        primary ? styles.primary : styles.text,
        inactive && styles.inactive,
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? colors.onAccent : colors.text} />
      ) : (
        <Text style={primary ? styles.primaryLabel : styles.textLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  base: {
    minHeight: minTapTarget,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.card,
  },
  primary: { backgroundColor: colors.accent },
  text: { backgroundColor: 'transparent' },
  inactive: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  primaryLabel: { ...typography.body, fontWeight: '600', color: colors.onAccent },
  textLabel: { ...typography.body, color: colors.muted, textDecorationLine: 'underline' },
});
