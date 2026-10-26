/**
 * A one-line message under a field or button: an error ("That code didn't
 * work...") or a confirmation ("New code sent.").
 *
 * Why one shared component: the spec (section 3, fix 3) says an error is
 * never shown by colour alone. It is always an icon PLUS a sentence, and it
 * is read aloud by screen readers when it appears. Keeping that in one place
 * means every screen gets it right.
 *
 * The icons are drawn with a small circle and a character ("!" or a tick),
 * so we don't need an icon package.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme';

/** What a FormMessage needs. */
export interface FormMessageProps {
  /** The sentence to show. */
  message: string;
  /** 'error' (default, coral with "!") or 'success' (green with a tick). */
  tone?: 'error' | 'success';
}

/**
 * Renders the icon and the sentence.
 *
 * @returns the message view.
 */
export function FormMessage({ message, tone = 'error' }: FormMessageProps) {
  const color = tone === 'error' ? colors.error : colors.success;
  return (
    <View style={styles.row}>
      {/* The icon is decoration for sighted people; screen readers skip it
          (the sentence already says everything). */}
      <View
        style={[styles.icon, { borderColor: color }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={[styles.iconGlyph, { color }]} allowFontScaling={false}>
          {tone === 'error' ? '!' : '✓'}
        </Text>
      </View>
      {/* role "alert" makes iPhone read the message aloud as soon as it
          appears; accessibilityLiveRegion does the same on Android. */}
      <Text
        style={[styles.text, { color }]}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
      >
        {message}
      </Text>
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  // A 16 px ring, nudged down 2 px to line up with the first line of text.
  icon: {
    width: 16,
    height: 16,
    marginTop: 2,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: { fontSize: 10, lineHeight: 12, fontWeight: '700' },
  text: { ...typography.bodySm, flex: 1 },
});
