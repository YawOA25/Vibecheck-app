/**
 * One event in the map's bottom card (VC-79, restyled for VC-83 map v2:
 * design/vc83-map-v2-spec.md §6).
 *
 * What it shows, left to right:
 *   - the event's generated art (84 px square; worked out from the id only);
 *   - the name (Bricolage 22), where ("Somewhere in Shaw, DC" for an area
 *     circle: the map never says more than the area; the area label for a
 *     venue pin), and when ("On now · until 2 AM");
 *   - ONLY once the event has started: the mini gauge with the published
 *     score and word ("8.4 Hot"), or "Too early" when there's no published
 *     score yet. "Nobody rated" and "1-4 raters" read the same "Too early"
 *     on purpose (cto), so the card can't hint at how many people rated.
 *     Before the start there is nothing about ratings (VC-61);
 *   - a LIVE dot while it's on, and "TEST" / "Staff pick" chips.
 * No rater count and no headcount, ever (they don't even reach the map).
 *
 * The whole card is one button that opens the event page.
 */
import { StyleSheet, Text, View } from 'react-native';

import { GeneratedArt } from '@/components/GeneratedArt';
import { PressableScale } from '@/components/PressableScale';
import { Tag } from '@/components/Tag';
import { VibeMeter } from '@/components/VibeMeter';
import { TOO_EARLY, tagState } from '@/lib/map-read';
import type { MapPoint, TagState } from '@/lib/map-read';
import { whenLine } from '@/lib/tonight';
import type { Vibe } from '@/lib/vibe';
import { colors, minTapTarget, motion, radius, spacing, typography } from '@/theme';

/** The art's size in the card, in pixels (spec §6). */
export const CARD_ART_SIZE = 84;

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
 * Builds what the shared mini gauge needs from a map score.
 *
 * @param state - a 'score' tag state.
 * @returns a Vibe holding only the score, its word and live/stale. The
 *   gauge draws just the arc, the number and the word; the count fields are
 *   required by the type but are zero here because the map never receives
 *   them (and the mini gauge never shows them).
 */
function gaugeVibe(state: Extract<TagState, { kind: 'score' }>): Vibe {
  return {
    state: state.stale ? 'stale' : 'live',
    raters: 0,
    here: 0,
    score: state.score,
    label: state.band,
    nightAverage: null,
    minutesSinceLast: null,
    reactions: [],
    breakdown: null,
    night: null,
  };
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
        <Text style={styles.meta}>{where}</Text>
        <Text style={styles.meta}>{when}</Text>
        {state.kind !== 'before' ? (
          <View style={styles.vibeRow}>
            {state.kind === 'score' ? (
              <View testID="map-mini-card-gauge">
                <VibeMeter vibe={gaugeVibe(state)} size="mini" />
              </View>
            ) : (
              <Text testID="map-mini-card-early" style={styles.early}>
                {TOO_EARLY}
              </Text>
            )}
            {point.is_live ? (
              <View style={styles.liveRow} testID="map-mini-card-live">
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {staffPick || point.is_test ? (
          <View style={styles.tags}>
            {point.is_test ? <Tag label="TEST" tone="gold" /> : null}
            {staffPick ? <Tag label="Staff pick" tone="gold" /> : null}
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

/** Styles built only from theme tokens (spec §6). */
const styles = StyleSheet.create({
  card: {
    minHeight: minTapTarget,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.gap12,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  art: {
    width: CARD_ART_SIZE,
    height: CARD_ART_SIZE,
    borderRadius: 14,
    overflow: 'hidden',
  },
  info: { flex: 1, flexShrink: 1, gap: 3 },
  title: { ...typography.cardTitle, color: colors.text },
  meta: { ...typography.caption, color: colors.muted },
  vibeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.gap12, marginTop: 2 },
  early: { ...typography.caption, color: colors.muted },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  liveText: { ...typography.label, color: colors.text },
});
