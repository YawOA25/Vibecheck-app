/**
 * An on/off switch with a label and an optional note, in the v3 look (used
 * on the admin "New event" screen, task VC-B04).
 *
 * Why its own component: the whole row (not just the small switch) is the
 * tap target, so it is easy to hit (at least 44 px tall), and screen readers
 * read it as one "switch" with its label and on/off state.
 */
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { colors, minTapTarget, spacing, typography } from '@/theme';

/** What a ToggleRow needs. */
export interface ToggleRowProps {
  /** The words next to the switch, for example "Test event". */
  label: string;
  /** A short explanation under the label. */
  helper?: string;
  /** Whether the switch is on. */
  value: boolean;
  /** Called with the new value when tapped. */
  onValueChange: (value: boolean) => void;
}

/**
 * Renders the label, the note and the switch on one row.
 *
 * @returns the row view.
 */
export function ToggleRow({ label, helper, value, onValueChange }: ToggleRowProps) {
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={helper}
      accessibilityState={{ checked: value }}
      style={styles.row}
    >
      <View style={styles.texts}>
        <Text style={styles.label}>{label}</Text>
        {helper ? <Text style={styles.helper}>{helper}</Text> : null}
      </View>
      {/* The switch itself is hidden from screen readers: the row speaks for it. */}
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.disabledBg, true: colors.accent }}
        thumbColor={colors.text}
        ios_backgroundColor={colors.disabledBg}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </Pressable>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  row: {
    minHeight: minTapTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gap12,
  },
  // flex 1 lets long labels wrap instead of pushing the switch off screen.
  texts: { flex: 1, gap: 2 },
  label: { ...typography.body, fontFamily: typography.button.fontFamily, color: colors.text },
  helper: { ...typography.caption, color: colors.muted },
});
