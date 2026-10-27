/**
 * The one-box-per-digit code entry from the v3 design (spec section 2.2).
 * The design shows 6 boxes; the screen passes the real code length (8 for
 * our hosted project), so the number of boxes always matches the email.
 * The party-code screen (VC-B07) uses it too, with `characters="letters"`
 * for the 6-character party code (capital letters and digits).
 *
 * How it works: there is ONE real text box, made invisible and laid over the
 * digit boxes. The boxes only *show* the digits typed into it. One real box
 * (rather than six) is what lets the phone's "fill in code from email" and
 * paste work, and lets a screen reader treat it as a single "N-digit code"
 * field.
 *
 * Looks: each box is dark with a 1 px grey edge; the box where the next digit
 * goes gets a 2 px gold edge while typing; on an error every box gets a 2 px
 * coral edge and the error sentence shows underneath.
 */
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { FormMessage } from '@/components/FormMessage';
import { colors, headlineMaxScale, radius, spacing, typography } from '@/theme';

/** What a CodeInput needs. */
export interface CodeInputProps {
  /** The digits typed so far. */
  value: string;
  /** Called with the new text whenever it changes (the screen cleans it to digits). */
  onChangeText: (text: string) => void;
  /** How many boxes to show: the number of digits in the emailed code. */
  length: number;
  /** An error sentence; turns the boxes coral. */
  error?: string | null;
  /** True while the code is being checked: typing is locked. */
  locked?: boolean;
  /**
   * What goes in the boxes: 'digits' (default, the emailed sign-in code) or
   * 'letters' (the party code, VC-B07: capital letters and digits, typed on
   * the normal keyboard, with no "fill in from email").
   */
  characters?: 'digits' | 'letters';
  /** The label above the boxes and for screen readers (default "N-digit code"). */
  label?: string;
}

/**
 * Renders the label, the digit boxes and an optional error.
 *
 * @returns the code entry view.
 */
export function CodeInput({
  value,
  onChangeText,
  length,
  error,
  locked,
  characters = 'digits',
  label,
}: CodeInputProps) {
  const [focused, setFocused] = useState(false);
  const fieldLabel = label ?? `${length}-digit code`;
  // Party codes use the letter keyboard in capitals, with autocorrect and
  // autofill off (a party code is never in an email or text message).
  const keyboard =
    characters === 'letters'
      ? ({
          keyboardType: 'default',
          autoCapitalize: 'characters',
          autoCorrect: false,
          spellCheck: false,
          textContentType: 'none',
          autoComplete: 'off',
        } as const)
      : ({
          keyboardType: 'number-pad',
          // Lets iPhone and Android offer the code from the email.
          textContentType: 'oneTimeCode',
          autoComplete: 'one-time-code',
        } as const);
  // One entry per box: the digit typed there, or '' if not typed yet.
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  return (
    <View style={styles.wrapper}>
      <Text
        style={styles.label}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {fieldLabel}
      </Text>
      {/* More than 6 boxes get a smaller gap so each box stays wide enough
          for its digit on a small phone. */}
      <View style={[styles.row, length > 6 && styles.rowTight]}>
        {/* The boxes are pictures of the typed digits; screen readers
            skip them and use the real (invisible) text box instead. */}
        {digits.map((digit, i) => (
          <View
            key={i}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.box,
              // Gold edge on the box where the next digit will go.
              focused && !error && i === Math.min(value.length, length - 1) && styles.boxActive,
              error ? styles.boxError : null,
            ]}
          >
            {/* Capped growth with the phone's text size so a digit can't overflow its box. */}
            <Text style={styles.digit} maxFontSizeMultiplier={headlineMaxScale}>
              {digit}
            </Text>
          </View>
        ))}
        <TextInput
          accessibilityLabel={fieldLabel}
          accessibilityHint={error ?? undefined}
          value={value}
          onChangeText={onChangeText}
          editable={!locked}
          maxLength={length}
          {...keyboard}
          autoFocus
          caretHidden
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          // Invisible, but covering all the boxes so a tap anywhere opens the keyboard.
          style={styles.hiddenInput}
        />
      </View>
      {error ? <FormMessage message={error} /> : null}
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  label: { ...typography.label, color: colors.muted, textTransform: 'uppercase' },
  row: { flexDirection: 'row', gap: spacing.sm },
  rowTight: { gap: spacing.xs },
  box: {
    flex: 1,
    height: 56,
    borderRadius: radius.codeBox,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: { borderWidth: 2, borderColor: colors.accent },
  boxError: { borderWidth: 2, borderColor: colors.error },
  digit: { ...typography.codeDigit, color: colors.text },
  hiddenInput: {
    ...StyleSheet.absoluteFill,
    opacity: 0,
    color: 'transparent',
  },
});
