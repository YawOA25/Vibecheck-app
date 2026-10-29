/**
 * One event in the map's tap card (VC-79, design/vc79-map-spec.md §3),
 * styled like the Tonight list's EventCard: the name and a "where · when"
 * line on the left, LIVE and the vibe word on the right.
 *
 * What it shows:
 *   - the title;
 *   - where: "Somewhere in Shaw, DC" for an area circle (the map never says
 *     more than the area), or the area label for a venue pin;
 *   - when: the same "Today · 10 PM" / "On now · until 2 AM" line as the list;
 *   - "TEST" and "Staff pick" chips where they apply;
 *   - ONLY once the event has started: a LIVE dot while it's on, and the
 *     published vibe word ("Hot", "Fire", "Early"), or "No vibe yet" when
 *     nobody has rated. Before the start there is nothing about ratings
 *     (VC-61), whatever the server sent.
 *
 * The whole card is one button that opens the event page.
 */
import { StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/PressableScale';
import { Tag } from '@/components/Tag';
import { wordColour } from '@/components/VibeMeter';
import type { MapPoint } from '@/lib/map-read';
import type { VibeLabel } from '@/lib/rating';
import { whenLine } from '@/lib/tonight';
import { colors, fonts, minTapTarget, motion, radius, spacing, typography } from '@/theme';

/** The words for a started event nobody has rated yet (exported for tests). */
export const MAP_NO_VIBE = 'No vibe yet';

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
 * The vibe word the card shows.
 *
 * @param point - the map row.
 * @returns null before the start; otherwise the published word, or "No vibe
 *   yet" when there isn't one.
 */
export function cardWord(point: Pick<MapPoint, 'has_started' | 'vibe_word'>): string | null {
  if (!point.has_started) return null;
  return point.vibe_word ?? MAP_NO_VIBE;
}

/**
 * The colour of a vibe word, matching the gauge (Quiet grey ... Fire bright
 * gold). "Early" and "No vibe yet" are grey.
 *
 * @param word - the word shown.
 * @returns a colour.
 */
function colourFor(word: string): string {
  const known: string[] = ['Quiet', 'Good', 'Hot', 'Fire'];
  return known.includes(word) ? wordColour(word as VibeLabel) : colors.muted;
}

/**
 * Renders the mini card.
 *
 * @returns a pressable card. Screen readers hear one summary, e.g. "Shaw
 *   kickback, Somewhere in Shaw, DC, On now · until 2 AM, Hot".
 */
export function MapMiniCard({ point, now, onPress, animatePress = false }: MapMiniCardProps) {
  const when = whenLine(point, now);
  const where = whereText(point);
  const word = cardWord(point);
  const staffPick = point.source === 'staff_pick';
  const spoken = [
    point.title,
    point.is_test ? 'Test event' : null,
    where,
    when,
    staffPick ? 'Staff pick' : null,
    word ? `vibe ${word}` : null,
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
      <View style={styles.left}>
        <Text style={styles.title} numberOfLines={2}>
          {point.title}
        </Text>
        <Text style={styles.meta}>
          {where} · {when}
        </Text>
        {staffPick || point.is_test ? (
          <View style={styles.tags}>
            {point.is_test ? <Tag label="TEST" tone="gold" /> : null}
            {staffPick ? <Tag label="Staff pick" tone="gold" /> : null}
          </View>
        ) : null}
      </View>
      {word ? (
        <View style={styles.right}>
          {point.is_live ? (
            <View style={styles.liveRow} testID="map-mini-card-live">
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          ) : null}
          <Text testID="map-mini-card-word" style={[styles.word, { color: colourFor(word) }]}>
            {word}
          </Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

/** Styles built only from theme tokens (the EventCard look). */
const styles = StyleSheet.create({
  card: {
    minHeight: minTapTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.gap12,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  left: { flex: 1, flexShrink: 1, gap: 5 },
  title: { ...typography.cardTitle, color: colors.text },
  meta: { ...typography.caption, color: colors.muted },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: spacing.xs },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  liveText: { ...typography.label, color: colors.text },
  word: { fontFamily: fonts.displaySemi, fontSize: 15, lineHeight: 20 },
});
