/**
 * The vibe meter (task VC-B09): the big score, its word, and a bar that
 * fills from 0 to 10.
 *
 * What it shows, by state:
 *   live   "8.0", "Hot" in gold, and a gold bar filled to 80%;
 *   stale  the last score and word in grey, with a grey bar (the party has
 *          been quiet for 90+ minutes, so the number is old news);
 *   early  "Early reading" and an empty bar (no number before 5 ratings);
 *   none   "No vibe yet" and an empty bar.
 *
 * The word is always shown next to the number (the plan's rule), so the
 * meaning never depends on colour or the bar alone. Screen readers hear one
 * sentence, e.g. "Vibe 8.0 out of 10, Hot".
 *
 * Why a straight bar and not the v3 arc: an arc needs a drawing library
 * (react-native-svg), a new dependency; the bar is plain views and says the
 * same thing. The arc can come later if the founder wants it.
 */
import { StyleSheet, Text, View } from 'react-native';

import { EARLY_TITLE, NO_VIBE_TITLE, formatScore, meterSpoken } from '@/lib/vibe';
import type { Vibe } from '@/lib/vibe';
import { colors, fonts, radius, spacing, typography } from '@/theme';

/** What a VibeMeter needs. */
export interface VibeMeterProps {
  vibe: Vibe;
}

/**
 * Renders the meter.
 *
 * @returns the meter view, read out as one item (a "progress bar" from 0 to
 *   10 when there is a score).
 */
export function VibeMeter({ vibe }: VibeMeterProps) {
  const hasScore = vibe.score !== null && vibe.label !== null;
  const stale = vibe.state === 'stale';
  // How full the bar is: the score out of 10, as a percentage of its width.
  const fill = hasScore ? `${Math.max(0, Math.min(10, vibe.score ?? 0)) * 10}%` : '0%';

  return (
    <View
      style={styles.meter}
      accessible
      accessibilityRole={hasScore ? 'progressbar' : undefined}
      accessibilityLabel={meterSpoken(vibe)}
      accessibilityValue={
        hasScore ? { min: 0, max: 10, now: Math.round(vibe.score ?? 0) } : undefined
      }
      testID="vibe-meter"
    >
      {hasScore ? (
        <>
          <Text style={[styles.score, stale && styles.staleText]}>
            {formatScore(vibe.score ?? 0)}
          </Text>
          <Text style={[styles.word, stale && styles.staleText]}>{vibe.label}</Text>
        </>
      ) : (
        <Text style={styles.title}>{vibe.state === 'early' ? EARLY_TITLE : NO_VIBE_TITLE}</Text>
      )}
      {/* The bar: a dark track with a coloured fill. Decoration for sighted
          people; the number and word above carry the meaning. */}
      <View style={styles.track}>
        <View
          style={[styles.fill, { width: fill as `${number}%` }, stale && styles.staleFill]}
          testID="vibe-meter-fill"
        />
      </View>
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  meter: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  // The big number: v3 uses 46 px Bricolage extra bold.
  score: { fontFamily: fonts.display, fontSize: 46, lineHeight: 52, color: colors.text },
  // The word under it, in gold (v3: 22 px Bricolage).
  word: { ...typography.cardTitle, color: colors.accent },
  staleText: { color: colors.muted },
  title: { ...typography.cardTitle, color: colors.text, textAlign: 'center' },
  track: {
    alignSelf: 'stretch',
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  fill: { height: 6, borderRadius: radius.pill, backgroundColor: colors.accent },
  staleFill: { backgroundColor: colors.muted },
});
