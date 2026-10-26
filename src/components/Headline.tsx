/**
 * A big two-part headline whose second part sits in a gold pill, the v3
 * "gold highlight" (spec section 1, "Gold highlight headline").
 * Example: "Know the vibe" / [before you pull up.]
 *
 * Why it is built from a View and two Texts: in React Native, a coloured
 * background on text *inside* other text ignores rounded corners on iPhone
 * and breaks badly across lines. So the gold part is its own box (a View with
 * rounded corners) holding its own Text.
 *
 * Screen readers: the whole thing is ONE heading with one combined label
 * ("Know the vibe before you pull up."), not two separate pieces.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors, headlineMaxScale, spacing, typography } from '@/theme';

/** What a Headline needs. */
export interface HeadlineProps {
  /** The plain first part, for example "Know the vibe". */
  lead: string;
  /** The part in the gold pill, for example "before you pull up.". Keep it short. */
  highlight?: string;
  /** 'hero' (38 px, sign-in) or 'h1' (36 px, other screens). Default 'h1'. */
  size?: 'hero' | 'h1';
}

/**
 * Renders the headline.
 *
 * @returns the headline view, announced as a heading.
 */
export function Headline({ lead, highlight, size = 'h1' }: HeadlineProps) {
  const textStyle = size === 'hero' ? styles.hero : styles.h1;
  const fullText = highlight ? `${lead} ${highlight}` : lead;
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={fullText}
      style={styles.wrapper}
    >
      {/* maxFontSizeMultiplier: the headline grows with the phone's text
          size, but at most 1.3 times, so it still fits on screen. */}
      <Text style={textStyle} maxFontSizeMultiplier={headlineMaxScale}>
        {lead}
      </Text>
      {highlight ? (
        <View style={styles.pill}>
          <Text style={[textStyle, styles.onGold]} maxFontSizeMultiplier={headlineMaxScale}>
            {highlight}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  wrapper: { alignItems: 'flex-start', gap: spacing.xs },
  hero: { ...typography.hero, color: colors.text },
  h1: { ...typography.h1, color: colors.text },
  // Gold pill: shrinks to fit its words (alignSelf), radius 14, 10 px side padding.
  pill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingHorizontal: 10,
  },
  onGold: { color: colors.onAccent },
});
