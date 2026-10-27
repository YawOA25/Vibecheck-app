/**
 * A row of joined buttons where exactly one can be chosen (a "segmented
 * control"), in the v3 look. First used for the State choice (DC /
 * Maryland / Virginia) on the admin event form (proposal VC-37).
 *
 * Look: one rounded outline split into equal parts; the chosen part is
 * filled gold with dark text, the others are plain. Each part is at least
 * 44 px tall so it's easy to hit.
 *
 * Screen readers: the row is a "radio group" with the label, and each part
 * is a "radio" that says whether it's selected.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormMessage } from '@/components/FormMessage';
import { colors, minTapTarget, radius, spacing, typography } from '@/theme';

/** One choice: its value and the words on it. */
export interface Segment<T extends string> {
  value: T;
  label: string;
}

/** What a SegmentedControl needs. */
export interface SegmentedControlProps<T extends string> {
  /** The small capitals label above, e.g. "State". */
  label: string;
  /** The choices, left to right. */
  options: readonly Segment<T>[];
  /** The chosen value, or null for none yet. */
  value: T | null;
  /** Called with the tapped choice's value. */
  onChange: (value: T) => void;
  /** An error sentence shown underneath, if any. */
  error?: string;
  /** A short note underneath (hidden while there's an error). */
  helper?: string;
}

/**
 * Renders the label, the joined buttons and an optional note or error.
 *
 * @returns the control view.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
  helper,
}: SegmentedControlProps<T>) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label} accessibilityElementsHidden importantForAccessibility="no">
        {label}
      </Text>
      <View
        style={[styles.row, error ? styles.rowError : null]}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected, checked: selected }}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.segment,
                // A thin line between parts (not before the first one).
                index > 0 && styles.divider,
                selected && styles.selected,
                pressed && !selected && styles.pressed,
              ]}
            >
              <Text style={[styles.text, selected && styles.selectedText]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <FormMessage message={error} /> : null}
      {!error && helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  label: { ...typography.label, color: colors.muted, textTransform: 'uppercase' },
  row: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    borderRadius: radius.field,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  rowError: { borderColor: colors.error, borderWidth: 2 },
  segment: {
    flex: 1,
    minHeight: minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  divider: { borderLeftWidth: 1, borderLeftColor: colors.fieldBorder },
  selected: { backgroundColor: colors.accent },
  pressed: { backgroundColor: colors.surfaceRaised },
  text: { ...typography.body, color: colors.text },
  selectedText: { color: colors.onAccent },
  helper: { ...typography.caption, color: colors.muted },
});
