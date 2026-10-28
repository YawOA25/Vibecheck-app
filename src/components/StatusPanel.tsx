/**
 * A centred "status" block for whole-screen states (Q6, polish audit):
 * an icon in a 56 px circle, an optional heading, a sentence, and an
 * optional button underneath.
 *
 * Used for:
 *   - errors (a page failed to load): the coral "alert" icon. The sentence
 *     is read aloud as soon as it appears (role "alert" plus a polite live
 *     region), the same rule FormMessage follows: an error is never colour
 *     alone, it is always an icon PLUS a sentence;
 *   - "not found" (the event was removed or the link is wrong): the quiet
 *     moon, matching the home list's empty card.
 *
 * The icon is decoration only; screen readers skip it (Icon.tsx).
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/Icon';
import { colors, iconSize, radius, spacing, typography } from '@/theme';

/** What a StatusPanel needs. */
export interface StatusPanelProps {
  /** 'error' (alert icon, coral sentence, read aloud) or 'quiet' (moon, muted). */
  tone: 'error' | 'quiet';
  /** The sentence under the icon (and heading). */
  message: string;
  /** A short heading above the sentence (e.g. "Event not found"). */
  title?: string;
  /** What goes under the sentence, e.g. a "Try again" button. */
  children?: ReactNode;
}

/** Which icon and colour each tone uses. */
const TONES: Record<StatusPanelProps['tone'], { icon: IconName; color: string }> = {
  error: { icon: 'alert', color: colors.error },
  quiet: { icon: 'moon', color: colors.muted },
};

/**
 * Renders the panel.
 *
 * @returns a centred column: icon circle, heading, sentence, children.
 */
export function StatusPanel({ tone, message, title, children }: StatusPanelProps) {
  const { icon, color } = TONES[tone];
  const isError = tone === 'error';
  return (
    <View style={styles.centre}>
      <View style={styles.circle} testID={`status-icon-${icon}`}>
        <Icon name={icon} size={iconSize.lg} color={color} />
      </View>
      {title ? (
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <Text
        style={[styles.message, isError && styles.error]}
        // Errors are read out as soon as they appear (iPhone: role alert;
        // Android: the live region). Quiet notes are read in normal order.
        accessibilityRole={isError ? 'alert' : undefined}
        accessibilityLiveRegion={isError ? 'polite' : undefined}
      >
        {message}
      </Text>
      {children ? <View style={styles.action}>{children}</View> : null}
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  centre: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  // The 56 px "feature" circle for a 28 px icon (theme iconSize notes).
  circle: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: { ...typography.cardTitle, color: colors.text, textAlign: 'center' },
  message: { ...typography.bodySm, color: colors.muted, textAlign: 'center' },
  error: { color: colors.error },
  action: { paddingTop: spacing.sm },
});
