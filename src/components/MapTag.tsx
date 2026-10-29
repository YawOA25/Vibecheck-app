/**
 * A tag on the map (VC-83 map v2, design/vc83-map-v2-spec.md §2). It
 * replaces VC-79's "Shaw · 2" pill.
 *
 * What it looks like: a 32 px pill with, left to right, a 10 px heat dot,
 * the name, and then one of:
 *   - the published score ("8.4") in its band's gold, once started;
 *   - the start time ("10 PM") in grey, before the start (no dot colour);
 *   - "Too early" in grey, with a dashed ring for a dot, once started but
 *     without a published score.
 * A Fire tag gets a gold edge. A picked tag turns gold (dark text) and
 * grows to 1.08 in 160 ms (instantly under Reduce Motion).
 *
 * For an area with 2+ events the tag reads "Shaw" + "2 parties", with its
 * dot in the hottest published band (worked out by the caller).
 *
 * Where it sits: always exactly at the point the server sent (an area's
 * fixed centre, or a venue once that switch is on). Its position never
 * depends on the score or anything else (cto rule).
 *
 * Map speed: custom map markers are redrawn by the map only while
 * `tracksViewChanges` is on, and keeping it on for many tags makes the map
 * stutter. So it is on for a short moment after the first draw and after
 * any change of text, band or picked state, and off the rest of the time
 * (Android would otherwise keep showing the old picture; cto debt note).
 */
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';

import { wordColour } from '@/components/VibeMeter';
import type { VibeLabel } from '@/lib/rating';
import { colors, fonts } from '@/theme';

/** How long a tag keeps redrawing after a change, in ms (enough for one draw). */
export const TAG_REDRAW_MS = 300;

/** How the tag's dot looks. */
export type TagDot =
  /** filled in the band's colour (a published score) */
  | { kind: 'band'; band: VibeLabel }
  /** filled grey (not started yet) */
  | { kind: 'muted' }
  /** a dashed grey ring ("Too early") */
  | { kind: 'dashed' };

/** What a MapTag needs. */
export interface MapTagProps {
  /** Where the tag sits: exactly the point the server sent. */
  coordinate: { latitude: number; longitude: number };
  /** The (already shortened) name, or the area's short name for a group. */
  name: string;
  /** The text after the name: "8.4", "10 PM", "Too early" or "2 parties". */
  trailing: string;
  /** true when `trailing` is a score (big gold number); false for grey words. */
  trailingIsScore: boolean;
  /** The dot. */
  dot: TagDot;
  /** true while this tag's card is open. */
  picked: boolean;
  /** Opens its card. */
  onPress: () => void;
  /** What a screen reader (or switch control) says for it. */
  spoken: string;
  /** false under Reduce Motion: no grow animation. */
  animate: boolean;
  testID?: string;
}

/**
 * Renders the tag as a map marker.
 *
 * @returns a Marker with the pill inside.
 */
export function MapTag({
  coordinate,
  name,
  trailing,
  trailingIsScore,
  dot,
  picked,
  onPress,
  spoken,
  animate,
  testID,
}: MapTagProps) {
  const band = dot.kind === 'band' ? dot.band : null;
  // Everything that changes how the tag looks, as one piece of text.
  const look = `${name}|${trailing}|${dot.kind}|${band ?? ''}|${picked}`;

  // Redraw for a moment after the first draw and after every change of look
  // (React's "adjust state when a prop changes" pattern: no effect needed
  // to notice the change).
  const [seenLook, setSeenLook] = useState(look);
  const [redrawing, setRedrawing] = useState(true);
  if (seenLook !== look) {
    setSeenLook(look);
    setRedrawing(true);
  }
  useEffect(() => {
    if (!redrawing) return;
    // Turned off inside a timer (not straight in the effect), so the map
    // has had time to draw the new picture.
    const timer = setTimeout(() => setRedrawing(false), TAG_REDRAW_MS);
    return () => clearTimeout(timer);
  }, [redrawing, look]);

  // The picked tag grows a little (spec: 1.08 in 160 ms).
  const [scale] = useState(() => new Animated.Value(picked ? 1.08 : 1));
  useEffect(() => {
    Animated.timing(scale, {
      toValue: picked ? 1.08 : 1,
      duration: animate ? 160 : 0,
      useNativeDriver: true,
    }).start();
  }, [picked, animate, scale]);

  const fire = band === 'Fire';
  const scoreColour = picked ? colors.onAccent : wordColour(band);

  return (
    <Marker
      coordinate={coordinate}
      onPress={onPress}
      tracksViewChanges={redrawing}
      accessibilityLabel={spoken}
      testID={testID}
    >
      {/* Clear padding around the 32 px pill makes the touch area 44 tall. */}
      <View style={styles.touch}>
        <Animated.View
          style={[
            styles.pill,
            fire && styles.pillFire,
            picked && styles.pillPicked,
            { transform: [{ scale }] },
          ]}
        >
          <View
            testID={testID ? `${testID}-dot` : undefined}
            style={[
              styles.dot,
              dot.kind === 'band' && {
                backgroundColor: picked ? colors.onAccent : wordColour(dot.band),
              },
              dot.kind === 'muted' && { backgroundColor: picked ? colors.onAccent : colors.muted },
              dot.kind === 'dashed' && [
                styles.dotDashed,
                picked && { borderColor: colors.onAccent },
              ],
            ]}
          />
          <Text style={[styles.name, picked && styles.textPicked]} maxFontSizeMultiplier={1.3}>
            {name}
          </Text>
          <Text
            style={
              trailingIsScore
                ? [styles.score, { color: scoreColour }]
                : [styles.muted, picked && styles.textPicked]
            }
            maxFontSizeMultiplier={1.3}
          >
            {trailing}
          </Text>
        </Animated.View>
      </View>
    </Marker>
  );
}

/** Styles built only from theme tokens (spec §2). */
const styles = StyleSheet.create({
  touch: { paddingVertical: 6, paddingHorizontal: 2 },
  pill: {
    height: 32,
    minWidth: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 9,
    paddingRight: 12,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  pillFire: { borderColor: colors.accent },
  pillPicked: { backgroundColor: colors.accent, borderColor: colors.accent },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotDashed: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.muted },
  name: { fontFamily: fonts.bodyBold, fontSize: 13, lineHeight: 18, color: colors.text },
  score: { fontFamily: fonts.display, fontSize: 14, lineHeight: 18 },
  muted: { fontFamily: fonts.bodyMedium, fontSize: 12, lineHeight: 16, color: colors.muted },
  textPicked: { color: colors.onAccent },
});
