/**
 * The shared pieces of a search-first lookup box: the list under the box,
 * its tappable rows, and a plain (non-tappable) note line. Used by the Area
 * box (AreaPicker) and the State box (StatePicker) on the admin event form,
 * so both look and behave the same (VC-37 and its State follow-up).
 *
 * Why shared: the State spec asks for a box that "looks and behaves like
 * Area" without copying AreaPicker. One set of row styles means a later
 * change (row height, colours) happens once.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, minTapTarget, radius, typography } from '@/theme';

/** What a SuggestionList needs. */
export interface SuggestionListProps {
  /** What a screen reader calls the list, e.g. "State suggestions". */
  accessibilityLabel: string;
  /** The rows and notes inside it. */
  children: ReactNode;
}

/**
 * The bordered box holding the suggestions under a search field.
 *
 * @returns the list container. No animation (reduced-motion friendly).
 */
export function SuggestionList({ accessibilityLabel, children }: SuggestionListProps) {
  return (
    <View style={styles.list} accessibilityLabel={accessibilityLabel}>
      {children}
    </View>
  );
}

/** What a SuggestionRow needs. */
export interface SuggestionRowProps {
  /** The words on the row. */
  label: string;
  /** What a screen reader says (defaults to the label). */
  accessibilityLabel?: string;
  /** An extra spoken hint, e.g. what the "Use ..." row does. */
  accessibilityHint?: string;
  /** Called when the row is tapped. */
  onPress: () => void;
  /** True for the row the arrow keys are on (web), to show it lit. */
  highlighted?: boolean;
  /** True when this row is the current pick (announced as "selected"). */
  selected?: boolean;
  /** 'accent' draws the words in gold, like a link (the "Use ..." row). */
  tone?: 'normal' | 'accent';
}

/**
 * One tappable suggestion, at least 44 points high.
 *
 * @returns the row button.
 */
export function SuggestionRow({
  label,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  highlighted = false,
  selected = false,
  tone = 'normal',
}: SuggestionRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, (pressed || highlighted) && styles.rowLit]}
    >
      <Text style={tone === 'accent' ? styles.accentText : styles.rowText}>{label}</Text>
    </Pressable>
  );
}

/**
 * A plain line inside the list that can't be tapped, e.g. "Not here yet".
 * Screen readers read it as soon as it appears: role "alert" for iPhone,
 * a polite live region for Android (same pattern as FormMessage).
 *
 * @param props.text - the line's words.
 * @returns the note view.
 */
export function SuggestionNote({ text }: { text: string }) {
  return (
    <View style={styles.note}>
      <Text style={styles.noteText} accessibilityRole="alert" accessibilityLiveRegion="polite">
        {text}
      </Text>
    </View>
  );
}

/** Styles built only from theme tokens (moved here from AreaPicker). */
const styles = StyleSheet.create({
  list: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.field,
    overflow: 'hidden',
  },
  row: {
    minHeight: minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowLit: { backgroundColor: colors.surfaceRaised },
  rowText: { ...typography.body, color: colors.text },
  // Gold, like a text link, so it reads as a different kind of choice.
  accentText: { ...typography.body, color: colors.accent },
  note: {
    minHeight: minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  noteText: { ...typography.caption, color: colors.muted },
});
