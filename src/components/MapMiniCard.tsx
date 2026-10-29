/**
 * One event in the map's bottom card (VC-79, restyled for VC-83 map v2:
 * design/vc83-map-v2-spec.md §6).
 *
 * What it shows, left to right:
 *   - the event's generated art (48 px square since VC-85; from the id only);
 *   - the name (Bricolage 18), where ("Somewhere in Shaw, DC" for an area
 *     circle: the map never says more than the area; the area label for a
 *     venue pin), and when ("On now · until 2 AM");
 *   - ONLY once the event has started: the published score and its word
 *     ("8.4 HOT"), or "Too early" when there's no published
 *     score yet. "Nobody rated" and "1-4 raters" read the same "Too early"
 *     on purpose (cto), so the card can't hint at how many people rated.
 *     Before the start there is nothing about ratings (VC-61);
 *   - a LIVE dot while it's on, and "TEST" / "Staff pick" chips.
 * No rater count and no headcount, ever (they don't even reach the map).
 *
 * The whole card is one button that opens the event page.
 *
 * VC-85 step 1 ("sleek", design/vc85-map-brand-spec.md "Event card"): a
 * calmer layout like the mock: smaller art (48 px), the name in Bricolage
 * 18, "where · when" on one muted line, and the published score as a big
 * gold number (Bricolage 28) on the right with its band word in small
 * capitals underneath (in place of the mini gauge). A stale score shows in
 * grey, as the gauge did. The card itself has no fill: it sits inside the
 * map's glass card.
 */
import { StyleSheet, Text, View } from 'react-native';

import { GeneratedArt } from '@/components/GeneratedArt';
import { PressableScale } from '@/components/PressableScale';
import { Tag } from '@/components/Tag';
import { TOO_EARLY, tagState } from '@/lib/map-read';
import type { MapPoint, TagState } from '@/lib/map-read';
import { whenLine } from '@/lib/tonight';
import { colors, fonts, minTapTarget, motion, radius, spacing, typography } from '@/theme';

/** The art's size in the card, in pixels (VC-85: 48, was 84). */
export const CARD_ART_SIZE = 48;

/** What a MapMiniCard needs. */
export interface MapMiniCardProps {
  point: MapPoint;
  /** The current moment, for the "when" line. */
  now: Date;
  /** Opens the event page; gets the event's id. */
  onPress: (id: string) => void;
  /** true to shrink a little while pressed (off under Reduce Motion). */
  animatePress?: boolean;
}

/**
 * Where the card says the event is.
 *
 * @param point - the map row.
 * @returns "Somewhere in <area>" for an area circle (the exact spot is
 *   hidden), or the area label for a venue.
 */
export function whereText(point: Pick<MapPoint, 'kind' | 'area_label'>): string {
  return point.kind === 'venue' ? point.area_label : `Somewhere in ${point.area_label}`;
}

/**
 * The vibe part of the card's spoken summary.
 *
 * @param state - from tagState.
 * @returns "vibe Hot, 8.4" ("vibe Hot, 8.4, stale" for an old score),
 *   "Too early", or null before the start.
 */
export function cardVibeSpoken(state: TagState): string | null {
  if (state.kind === 'score') {
    // VC-83 Batch 2: an old score is spoken as "stale", as on the tag.
    return `vibe ${state.band}, ${state.score.toFixed(1)}${state.stale ? ', stale' : ''}`;
  }
  if (state.kind === 'early') return TOO_EARLY;
  return null;
}

/**
 * Renders the card.
 *
 * @returns a pressable card. Screen readers hear one summary, e.g. "Shaw
 *   kickback, Somewhere in Shaw, DC, On now · until 2 AM, vibe Hot, 8.4".
 */
export function MapMiniCard({ point, now, onPress, animatePress = false }: MapMiniCardProps) {
  const when = whenLine(point, now);
  const where = whereText(point);
  const state = tagState(point);
  const staffPick = point.source === 'staff_pick';
  const spoken = [
    point.title,
    point.is_test ? 'Test event' : null,
    where,
    when,
    staffPick ? 'Staff pick' : null,
    cardVibeSpoken(state),
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <PressableScale
      scaleTo={motion.pressScale.card}
      animate={animatePress}
      onPress={() => onPress(point.event_id)}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the event"
      testID="map-mini-card"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.art}>
        <GeneratedArt seed={point.event_id} height={CARD_ART_SIZE} />
      </View>
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {point.title}
        </Text>
        {/* One muted line, "where · when" (VC-85). Each part is its own
            piece of text inside it, so either can be found on its own. */}
        <Text style={styles.meta}>
          <Text>{where}</Text>
          {' · '}
          <Text>{when}</Text>
        </Text>
        {point.is_live && state.kind !== 'before' ? (
          <View style={styles.liveRow} testID="map-mini-card-live">
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        ) : null}
        {staffPick || point.is_test ? (
          <View style={styles.tags}>
            {point.is_test ? <Tag label="TEST" tone="gold" /> : null}
            {staffPick ? <Tag label="Staff pick" tone="gold" /> : null}
          </View>
        ) : null}
      </View>
      {/* Right: the published score, only once the event has started. */}
      {state.kind === 'score' ? (
        <View style={styles.big} testID="map-mini-card-score">
          <Text
            style={[styles.bigScore, state.stale && styles.staleText]}
            maxFontSizeMultiplier={1.3}
          >
            {state.score.toFixed(1)}
          </Text>
          <Text
            style={[styles.bigWord, state.stale && styles.staleText]}
            maxFontSizeMultiplier={1.3}
          >
            {state.band}
          </Text>
        </View>
      ) : state.kind === 'early' ? (
        <View style={styles.big}>
          <Text testID="map-mini-card-early" style={styles.early} maxFontSizeMultiplier={1.3}>
            {TOO_EARLY}
          </Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

/** Styles built only from theme tokens (spec §6). */
const styles = StyleSheet.create({
  card: {
    minHeight: minTapTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gap12,
    borderRadius: radius.chip,
  },
  // A finger on the card lightens it a little (it has no fill of its own).
  pressed: { backgroundColor: colors.surfaceRaised },
  art: {
    width: CARD_ART_SIZE,
    height: CARD_ART_SIZE,
    borderRadius: 12,
    overflow: 'hidden',
  },
  info: { flex: 1, flexShrink: 1, gap: 3 },
  // Bricolage 600 18 (VC-85, was the 22 px card title).
  title: {
    fontFamily: fonts.displaySemi,
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: -0.4,
    color: colors.text,
  },
  meta: { ...typography.caption, color: colors.muted },
  // The score column on the right.
  big: { alignItems: 'flex-end', justifyContent: 'center' },
  bigScore: { fontFamily: fonts.display, fontSize: 28, lineHeight: 30, color: colors.accent },
  bigWord: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.accentHover,
  },
  // An old (stale) score: grey number and word, as the gauge showed it.
  staleText: { color: colors.muted },
  early: { ...typography.caption, color: colors.muted },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  liveText: { ...typography.label, color: colors.text },
});
