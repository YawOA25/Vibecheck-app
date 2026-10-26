/**
 * A labelled text box, styled for the dark theme.
 *
 * Why one shared component: the label sits above the box and is linked to it
 * for screen readers (they read "Email, text field"), and every form in the
 * app looks the same.
 */
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';

import { colors, minTapTarget, radius, spacing, typography } from '@/theme';

/** What a TextField needs: a label, plus any normal TextInput setting. */
export interface TextFieldProps extends TextInputProps {
  /** Shown above the box and read out by screen readers. */
  label: string;
}

/**
 * Renders a label and a text box.
 *
 * @returns the field view. Every extra setting (value, onChangeText,
 *   keyboardType, ...) is passed straight to the text box.
 */
export function TextField({ label, style, ...inputProps }: TextFieldProps) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[styles.input, style]}
        {...inputProps}
      />
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  label: { ...typography.caption, color: colors.muted },
  input: {
    ...typography.body,
    minHeight: minTapTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.chip,
    backgroundColor: colors.surface,
    color: colors.text,
  },
});
