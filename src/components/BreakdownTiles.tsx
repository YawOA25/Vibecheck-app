/**
 * The Crowd / Music / Energy tiles under the vibe gauge (VC-53).
 *
 * What it shows: three equal tiles in a row, each a caps label and ONE word,
 * e.g. CROWD "Packed", MUSIC "Fire", ENERGY "Good". Never a number, an
 * average or a count: the server sends words only, worked out from exactly
 * the ratings behind the score on screen, so a tile can't reveal one
 * person's tap (design spec, section 3).
 *
 * When it shows: only when a score shows (the server sends no tiles in the
 * 'none' and 'early' states, and the card draws nothing then). Stale
 * readings show their words in grey.
 *
 * Screen readers hear the row as ONE item: "Crowd Packed, Music Fire, Energy
 * Good" ("Last reading: ..." when stale). The tiles aren't buttons, so they
 * don't look pressable. On large text the word wraps; it is never cut off.
 */
import { StyleSheet, Text, View } from 'react-native';

import { breakdownSpoken, breakdownTiles } from '@/lib/vibe';
import type { Breakdown } from '@/lib/vibe';
import { colors, fonts, typography } from '@/theme';

/** What BreakdownTiles needs. */
export interface BreakdownTilesProps {
  /** The three words from the server. */
  breakdown: Breakdown;
  /** true for an old (stale) reading: words in grey, spoken as "Last reading". */
  stale?: boolean;
}

/**
 * Renders the tile row.
 *
 * @returns three tiles, read out as one sentence.
 */
export function BreakdownTiles({ breakdown, stale = false }: BreakdownTilesProps) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={breakdownSpoken(breakdown, stale)}
      testID="breakdown-tiles"
    >
      {breakdownTiles(breakdown).map((tile) => (
        <View key={tile.label} style={styles.tile}>
          <Text style={styles.label}>{tile.label}</Text>
          <Text style={[styles.word, stale && styles.staleWord]}>{tile.word}</Text>
        </View>
      ))}
    </View>
  );
}

/** Styles built only from theme tokens (spec: gap 8, radius 12, padding 10). */
const styles = StyleSheet.create({
  row: { alignSelf: 'stretch', flexDirection: 'row', gap: 8, marginTop: 10 },
  tile: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    gap: 2,
  },
  // The caps label: 12/16 (v3's 10 px is too small to read).
  label: { ...typography.label, color: colors.muted },
  // The word: Manrope 600 15/20.
  word: { fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 20, color: colors.text },
  staleWord: { color: colors.muted },
});
