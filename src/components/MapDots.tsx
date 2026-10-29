/**
 * The two small map markers of VC-83 map v2 Batch 2
 * (design/vc83-map-v2-spec.md §5), used when the map is zoomed out:
 *
 *   - MapDot: a 14 px heat dot for a spot whose full tag doesn't fit (far
 *     zoom, or past the 8 tags of middle zoom). Same colours as a tag's
 *     dot: the band's gold, grey before the start, a dashed ring for "Too
 *     early". Tapping it opens the card, like a tag;
 *   - MapCluster: a round COUNT BUBBLE for events close together on screen
 *     at far zoom ("5"). Its edge is tinted by the hottest PUBLISHED band
 *     inside (cto review point 1). It shows a count of EVENTS only: never a
 *     score, an average, "3 hot" or a count of raters. Tapping it zooms in.
 *
 * Both sit exactly at a point the app already has (a spot's point, or the
 * plain average of a cluster's points) and are never nudged apart.
 *
 * Map speed: like tags, they redraw only for a moment after their look
 * changes (useBriefRedraw in MapTag.tsx).
 *
 * VC-85 step 1 ("sleek", design/vc85-map-brand-spec.md): the bubble is
 * smaller (34 px, was 44) and made of the map's glass, with a 1 px edge in
 * the hottest band's gold at 55%, a faint 5 px gold halo round it, and a
 * gold number. The halo fills the full 44 px, so the touch area is
 * unchanged.
 */
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';

import { rgba } from '@/components/AreaHeat';
import { glass } from '@/components/MapGlass';
import { dotFill, useBriefRedraw } from '@/components/MapTag';
import type { TagDot } from '@/components/MapTag';
import { wordColour } from '@/components/VibeMeter';
import type { VibeLabel } from '@/lib/rating';
import { colors, fonts, minTapTarget } from '@/theme';

/** A heat dot's size at far zoom, in px (spec §5). */
export const FAR_DOT_SIZE = 14;

/** A count bubble's size, in px (VC-85: 34, was 44). */
export const BUBBLE_SIZE = 34;

/**
 * The bubble's edge colour: the hottest band's gold at 55% (VC-85), or the
 * plain glass hairline when nothing inside has a published score.
 *
 * @param band - the hottest published band inside, or null.
 * @returns an rgba() colour.
 */
export function bubbleEdge(band: VibeLabel | null): string {
  return band ? rgba(wordColour(band), 0.55) : colors.borderStrong;
}

/** What a MapDot needs. */
export interface MapDotProps {
  /** Where it sits: exactly the spot's point. */
  coordinate: { latitude: number; longitude: number };
  /** How the dot looks (same as the tag it stands in for). */
  dot: TagDot;
  /** true while its card is open (a gold ring around it). */
  picked: boolean;
  /** Opens its card. */
  onPress: () => void;
  /** What a screen reader (or switch control) says: the same words as its tag. */
  spoken: string;
  testID?: string;
}

/**
 * Renders a heat dot as a map marker.
 *
 * @returns a Marker holding a 14 px dot inside a 44 px touch area.
 */
export function MapDot({ coordinate, dot, picked, onPress, spoken, testID }: MapDotProps) {
  const look = `${dot.kind}|${dot.kind === 'band' ? dot.band : ''}|${picked}`;
  const redrawing = useBriefRedraw(look);
  return (
    <Marker
      coordinate={coordinate}
      onPress={onPress}
      tracksViewChanges={redrawing}
      accessibilityLabel={spoken}
      testID={testID}
    >
      <View style={styles.dotTouch}>
        <View
          style={[
            styles.dot,
            dot.kind === 'dashed' ? styles.dotDashed : { backgroundColor: dotFill(dot, false) },
            picked && styles.dotPicked,
          ]}
        />
      </View>
    </Marker>
  );
}

/** What a MapCluster needs. */
export interface MapClusterProps {
  /** Where it sits: the plain average of its events' points (cto rule). */
  coordinate: { latitude: number; longitude: number };
  /** How many events it holds (the number in the bubble). */
  count: number;
  /** The hottest published band inside, or null when none has a score. */
  band: VibeLabel | null;
  /** "parties" when every event is a house party, otherwise "events". */
  noun: 'parties' | 'events';
  /** Zooms the map in to show what's inside. */
  onPress: () => void;
  testID?: string;
}

/**
 * The spoken label of a count bubble.
 *
 * @param count - the number of events inside.
 * @param noun - "parties" or "events".
 * @param band - the hottest published band inside, or null.
 * @returns e.g. "5 parties close together, hottest vibe Fire. Zooms in."
 *   A band WORD only: never a score number, and no count but the events.
 */
export function clusterSpoken(count: number, noun: string, band: VibeLabel | null): string {
  return `${count} ${noun} close together${band ? `, hottest vibe ${band}` : ''}. Zooms in.`;
}

/**
 * Renders a count bubble as a map marker.
 *
 * @returns a Marker holding a 34 px round glass bubble with the count,
 *   inside its 44 px halo.
 */
export function MapCluster({ coordinate, count, band, noun, onPress, testID }: MapClusterProps) {
  const redrawing = useBriefRedraw(`${count}|${band ?? ''}`);
  return (
    <Marker
      coordinate={coordinate}
      onPress={onPress}
      tracksViewChanges={redrawing}
      accessibilityLabel={clusterSpoken(count, noun, band)}
      testID={testID}
    >
      {/* The faint gold halo: 5 px round the 34 px bubble, which also makes
          the touch area 44 px. */}
      <View style={styles.halo}>
        <View
          testID={testID ? `${testID}-bubble` : undefined}
          // The edge carries the band (grey when nothing inside has a score).
          style={[styles.bubble, { borderColor: bubbleEdge(band) }]}
        >
          <Text style={styles.count} maxFontSizeMultiplier={1.3}>
            {count}
          </Text>
        </View>
      </View>
    </Marker>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  dotTouch: {
    width: minTapTarget,
    height: minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: FAR_DOT_SIZE, height: FAR_DOT_SIZE, borderRadius: FAR_DOT_SIZE / 2 },
  dotDashed: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.muted },
  dotPicked: { borderWidth: 2, borderColor: colors.accent },
  halo: {
    width: minTapTarget,
    height: minTapTarget,
    borderRadius: minTapTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: rgba(colors.accent, 0.1),
  },
  bubble: {
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: glass.fill,
    borderWidth: 1,
  },
  count: { fontFamily: fonts.display, fontSize: 14, lineHeight: 18, color: colors.accent },
});
