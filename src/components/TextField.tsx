/**
 * A labelled text box in the v3 style (spec section 2, "Field anatomy").
 *
 * Layout: a small capitals label above, an 8 px gap, then the box (dark
 * surface, 1 px grey edge, rounded corners). Optional helper text or an
 * error message sits under the box.
 *
 * States:
 *   - focused (being typed in): the edge turns gold and 2 px thick;
 *   - error: the edge turns coral and 2 px thick, and an icon plus a sentence
 *     appear under the box (read aloud by screen readers).
 *
 * Disabled (editable={false}, e.g. Area before a state is picked): the
 * whole field is greyed to half strength, can't be focused, and screen
 * readers hear "disabled".
 *
 * Why one shared component: the label is linked to the box for screen
 * readers (they read "Email, text field"), and every form looks the same.
 */
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';

import { FormMessage } from '@/components/FormMessage';
import { colors, fieldHeight, radius, spacing, typography } from '@/theme';

/** What a TextField needs: a label, plus any normal TextInput setting. */
export interface TextFieldProps extends TextInputProps {
  /** Shown above the box (in capitals) and read out by screen readers. */
  label: string;
  /** A small note under the box, for example "Month, day, then year." */
  helper?: string;
  /** An error sentence. When set, the box gets a coral edge and the sentence shows under it. */
  error?: string | null;
}

/**
 * Renders a label, a text box and an optional note or error.
 *
 * @returns the field view. Every extra setting (value, onChangeText,
 *   keyboardType, ...) is passed straight to the text box.
 */
export function TextField({
  label,
  helper,
  error,
  style,
  onFocus,
  onBlur,
  accessibilityHint,
  ...inputProps
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  // A box that can't be typed in is shown as disabled (greyed, skipped by focus).
  const disabled = inputProps.editable === false;

  return (
    <View style={[styles.wrapper, disabled && styles.disabled]}>
      {/* The visible label. Screen readers skip it because the box itself
          carries the same words as its accessibilityLabel (no double reading). */}
      <Text
        style={styles.label}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        // The error is also given as a hint, so it is read when the box is reached.
        accessibilityHint={error ?? accessibilityHint}
        accessibilityState={disabled ? { disabled: true } : undefined}
        focusable={disabled ? false : undefined}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        style={[
          styles.input,
          focused && styles.inputFocused,
          error ? styles.inputError : null,
          style,
        ]}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        {...inputProps}
      />
      {error ? <FormMessage message={error} /> : null}
      {!error && helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  // Same half-strength look as other disabled controls.
  disabled: { opacity: 0.5 },
  // Capitals are made by the style, so screen readers still read "Email", not "E-M-A-I-L".
  label: { ...typography.label, color: colors.muted, textTransform: 'uppercase' },
  input: {
    ...typography.input,
    minHeight: fieldHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  // 2 px edges: padding drops by 1 px so the text doesn't jump.
  inputFocused: {
    borderWidth: 2,
    borderColor: colors.accent,
    paddingHorizontal: spacing.md - 1,
    paddingVertical: 13,
  },
  inputError: {
    borderWidth: 2,
    borderColor: colors.error,
    paddingHorizontal: spacing.md - 1,
    paddingVertical: 13,
  },
  helper: { ...typography.caption, color: colors.muted },
});
