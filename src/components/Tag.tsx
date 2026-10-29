/**
 * A small rounded label ("chip") such as "Staff pick", "21+" or "Early"
 * (v3 design: 12 px text in a pill with a thin edge).
 *
 * Why its own component: the Tonight cards and the event page use the same
 * chips, so they should look identical. The text is 12 px (not v3's 10 to
 * 11 px) and grows with the phone's text size (spec section 3, fix 2).
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, typography } from '@/theme';

/** What a Tag needs. */
export interface TagProps {
  /** The words on the chip. */
  label: string;
  /**
   * 'plain' (default): grey edge, off-white text, for facts like "21+".
   * 'gold': gold edge and text, for "Staff pick" so it stands out (VC-14
   * says staff content must be clearly labelled).
   * 'muted': filled grey, for the "Early" vibe state (no score yet).
   * 'feature': filled gold with dark text, for a special night's name such
   * as "HALLOWEEN" (VC-84), so the night stands out from a staff pick.
   */
  tone?: 'plain' | 'gold' | 'muted' | 'feature';
}

/**
 * Renders the chip.
 *
 * @returns the chip view. Screen readers read its words as plain text.
 */
export function Tag({ label, tone = 'plain' }: TagProps) {
  return (
    <View
      style={[
        styles.chip,
        tone === 'gold' && styles.gold,
        tone === 'muted' && styles.muted,
        tone === 'feature' && styles.feature,
      ]}
    >
      <Text
        style={[
          styles.text,
          tone === 'gold' && styles.goldText,
          tone === 'feature' && styles.featureText,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  gold: { borderColor: colors.goldBorder },
  muted: { backgroundColor: colors.surfaceRaised, borderColor: colors.surfaceRaised },
  text: { ...typography.caption, fontSize: 12, lineHeight: 16, color: colors.text },
  // Gold text on the dark background reads at 10.4:1.
  goldText: { color: colors.accent, fontFamily: typography.label.fontFamily },
  // VC-84: dark text on solid gold reads at 9.8:1.
  feature: { backgroundColor: colors.accent, borderColor: colors.accent },
  featureText: { color: colors.onAccent, fontFamily: typography.label.fontFamily },
});
