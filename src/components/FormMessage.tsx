/**
 * A one-line message under a field or button: an error ("That code didn't
 * work...") or a confirmation ("New code sent.").
 *
 * Why one shared component: the spec (section 3, fix 3) says an error is
 * never shown by colour alone. It is always an icon PLUS a sentence, and it
 * is read aloud by screen readers when it appears. Keeping that in one place
 * means every screen gets it right.
 *
 * The icons are line icons from src/components/Icon.tsx (Q4): "alert" (a
 * ring with "!") for errors and "check" (a tick) for confirmations.
 */
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { colors, iconSize, spacing, typography } from '@/theme';

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
      <View style={styles.icon}>
        <Icon name={tone === 'error' ? 'alert' : 'check'} size={iconSize.sm} color={color} />
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
  // The 16 px icon, nudged down 2 px to line up with the first line of text.
  icon: { marginTop: 2 },
  text: { ...typography.bodySm, flex: 1 },
});
