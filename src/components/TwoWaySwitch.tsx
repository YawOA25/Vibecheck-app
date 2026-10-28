/**
 * A small two-option pill switch (VC-54), first used for "Live / All night"
 * on the vibe card. Built to be reused for any later two-way toggle.
 *
 * Look (design spec, section 4): a pill with a 1 px field-border edge; the
 * picked option is a light pill with dark bold text, the other is plain
 * grey text. Each option is 36 tall, with extra touch area to reach 44.
 *
 * Screen readers: the pill is a "tab list" and each option a "tab" that says
 * whether it's picked, with its own spoken name (e.g. "Live score").
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/theme';

/** One option of the switch. */
export interface SwitchOption<K extends string> {
  /** The value it stands for. */
  key: K;
  /** The words on screen, e.g. "Live". */
  label: string;
  /** What a screen reader says, e.g. "Live score". */
  spoken: string;
}

/** What a TwoWaySwitch needs. */
export interface TwoWaySwitchProps<K extends string> {
  /** The two options, left then right. */
  options: readonly [SwitchOption<K>, SwitchOption<K>];
  /** The picked option's key. */
  value: K;
  /** Called with the new key when the other option is tapped. */
  onChange: (key: K) => void;
}

/**
 * Renders the switch.
 *
 * @returns the pill with its two options.
 */
export function TwoWaySwitch<K extends string>({ options, value, onChange }: TwoWaySwitchProps<K>) {
  return (
    <View style={styles.pill} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.spoken}
            // 36 tall + 4 above and below = a 44 tall touch area.
            hitSlop={{ top: 4, bottom: 4 }}
            onPress={() => {
              if (!selected) onChange(option.key);
            }}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Text style={[styles.text, selected && styles.textSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    padding: 2,
  },
  segment: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    justifyContent: 'center',
  },
  segmentSelected: { backgroundColor: colors.text },
  text: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18, color: colors.muted },
  textSelected: { fontFamily: fonts.bodyBold, color: colors.bg },
});
