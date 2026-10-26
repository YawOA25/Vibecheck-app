/**
 * The app's button, in three looks (v3 design, spec section 2):
 *   - 'primary': a gold pill for the main action on a screen ("Continue")
 *   - 'outline': a see-through pill with a grey edge ("Sign out")
 *   - 'text'   : a gold, underlined text link for small actions ("Resend code")
 * and two sizes: 'large' (54 px tall) and 'small' (44 px tall, only as wide
 * as its words; used in the Tonight header).
 *
 * Why one shared component: every screen gets the same height (never under
 * 44 px, easy to hit with a thumb), the same colours for pressed, busy and
 * disabled, and the same screen-reader behaviour, without repeating styles.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { buttonHeight, colors, minTapTarget, radius, spacing, typography } from '@/theme';

/** What a Button needs. */
export interface ButtonProps {
  /** The words on the button (also read out by screen readers). */
  label: string;
  /** What happens on tap. */
  onPress: () => void;
  /** 'primary' (default), 'outline' or 'text'. */
  variant?: 'primary' | 'outline' | 'text';
  /** 'large' (default) or 'small' (compact pill). */
  size?: 'large' | 'small';
  /** Greys the button out and ignores taps. */
  disabled?: boolean;
  /** Shows a spinner plus `busyLabel`, and ignores taps (while waiting on the server). */
  busy?: boolean;
  /** Words next to the spinner while busy, for example "Sending...". Defaults to `label`. */
  busyLabel?: string;
}

/**
 * Renders a tappable button.
 *
 * @returns the button view.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'large',
  disabled,
  busy,
  busyLabel,
}: ButtonProps) {
  // Shows a 2 px gold ring when a keyboard or switch-control user moves onto
  // the button (spec section 3, fix 6). Touch users never see it.
  const [focused, setFocused] = useState(false);
  const inactive = Boolean(disabled || busy);
  // The grey "disabled" look is only for a disabled button, not a busy one:
  // a busy button keeps its gold so the spinner reads as "working", not "off".
  const greyedOut = Boolean(disabled) && !busy;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      // Screen readers announce this as a button, with its label and state.
      // The label stays the same while busy; the "busy" state is announced instead.
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: Boolean(busy) }}
      style={({ pressed }) => [
        styles.base,
        size === 'small' ? styles.small : styles.large,
        variant === 'primary' && styles.primary,
        variant === 'primary' && pressed && styles.primaryPressed,
        variant === 'outline' && styles.outline,
        variant === 'outline' && pressed && styles.outlinePressed,
        greyedOut && variant !== 'text' && styles.disabled,
        focused && styles.focused,
      ]}
    >
      {({ pressed }) =>
        busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color={variant === 'primary' ? colors.onAccent : colors.text} />
            <Text style={labelStyle(variant, size, greyedOut, pressed)}>{busyLabel ?? label}</Text>
          </View>
        ) : (
          <Text style={labelStyle(variant, size, greyedOut, pressed)}>{label}</Text>
        )
      }
    </Pressable>
  );
}

/**
 * Picks the label's text style for a look, size and state.
 *
 * @param variant - the button's look.
 * @param size - 'large' or 'small'.
 * @param greyedOut - true when the button is disabled.
 * @param pressed - true while a finger is on it.
 * @returns a list of styles for the label.
 */
function labelStyle(
  variant: NonNullable<ButtonProps['variant']>,
  size: NonNullable<ButtonProps['size']>,
  greyedOut: boolean,
  pressed: boolean,
) {
  return [
    size === 'small' ? styles.labelSmall : styles.label,
    variant === 'primary' && styles.onGold,
    variant === 'outline' && styles.onDark,
    variant === 'text' && styles.linkLabel,
    variant === 'text' && pressed && styles.linkPressed,
    greyedOut && styles.labelDisabled,
  ];
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  base: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.pill,
    // A 2 px see-through edge leaves room for the focus ring, so the button
    // doesn't change size when the ring appears.
    borderWidth: 2,
    borderColor: 'transparent',
  },
  // Main button: 54 px tall.
  large: { minHeight: buttonHeight, paddingHorizontal: spacing.lg },
  // Compact pill: 44 px tall, padding 0 16 (spec 2.5).
  small: { minHeight: minTapTarget, paddingHorizontal: spacing.md },
  primary: { backgroundColor: colors.accent },
  primaryPressed: { backgroundColor: colors.accentPressed },
  // A 1 px grey edge plus 1 px margin takes the same space as the 2 px edge.
  outline: { borderWidth: 1, borderColor: colors.fieldBorder, margin: 1 },
  outlinePressed: { backgroundColor: colors.surface },
  disabled: { backgroundColor: colors.disabledBg, borderColor: colors.disabledBg },
  focused: { borderWidth: 2, borderColor: colors.accent, margin: 0 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { ...typography.button, textAlign: 'center' },
  labelSmall: { ...typography.button, fontSize: 14, textAlign: 'center' },
  onGold: { color: colors.onAccent },
  onDark: { color: colors.text },
  // Links are underlined so they don't rely on colour alone (spec section 3, fix 6).
  linkLabel: {
    ...typography.bodySm,
    fontFamily: typography.button.fontFamily,
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  linkPressed: { color: colors.accentPressed },
  labelDisabled: { color: colors.disabledText, textDecorationLine: 'none' },
});
