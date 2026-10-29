/**
 * A tag on the map (VC-83 map v2, design/vc83-map-v2-spec.md §2). It
 * replaces VC-79's "Shaw · 2" pill.
 *
 * What it looks like: a 26 px glass pill (32 before VC-85) with, left to
 * right, a 7 px heat dot,
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
 * VC-83 Batch 2 adds:
 *   - a band CROSS-FADE: when the dot's band changes (a new snapshot was
 *     published), the old dot fades out over the new one in 400 ms
 *     (instantly under Reduce Motion);
 *   - the live PULSE: a ring that grows from the dot and fades, every
 *     2.4 s, for at most 5 live Hot/Fire tags (the map picks which; see
 *     src/lib/map-cluster.ts). Under Reduce Motion, or while the screen is
 *     not in view, the ring stays still instead. Its speed is fixed: it
 *     never follows the score or the ratings (cto, timing side channel);
 *   - LARGE TEXT: when the phone's text size is 1.3x or more, the score
 *     drops under the name (spec §7) so the pill doesn't get too wide.
 *
 * VC-85 step 1 ("sleek", design/vc85-map-brand-spec.md "Tags"): the pill
 * is smaller and made of the map's glass (src/components/MapGlass.tsx):
 * 26 px tall with a light hairline edge, a 7 px dot, a 12 px name and a
 * 13 px score. Picking a tag now cross-fades the gold fill in (160 ms)
 * instead of switching it, and when a tag first appears (after a zoom) it
 * fades in over 200 ms, a little after the hotter tags (the map passes
 * `appearDelay`). Under Reduce Motion all of this is instant. The touch
 * area stays 44 px tall (clear padding round the pill).
 *
 * Where it sits: always exactly at the point the server sent (an area's
 * fixed centre, or a venue once that switch is on). Its position never
 * depends on the score or anything else (cto rule).
 *
 * Map speed: custom map markers are redrawn by the map only while
 * `tracksViewChanges` is on, and keeping it on for many tags makes the map
 * stutter. So it is on for a short moment after the first draw and after
 * any change of look, and off the rest of the time (Android would otherwise
 * keep showing the old picture; cto debt note). The pulse and the
 * cross-fade run on the native animation driver inside the marker; Apple
 * Maps (the only map today) shows marker views live, so they need no
 * extra redraws. Google Maps (Android, later) would need a rethink there.
 */
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Marker } from 'react-native-maps';

import { glass } from '@/components/MapGlass';
import { wordColour } from '@/components/VibeMeter';
import { PULSE_MS, TAG_HEIGHT } from '@/lib/map-cluster';
import type { VibeLabel } from '@/lib/rating';
import { colors, fonts, minTapTarget } from '@/theme';

/** How long a tag keeps redrawing after a change, in ms (enough for one draw). */
export const TAG_REDRAW_MS = 300;

/** How long a band change cross-fades, in ms (spec §3). */
export const BAND_FADE_MS = 400;

/** From this text size up, the score sits under the name (spec §7). */
export const STACK_FONT_SCALE = 1.3;

/** How long a new tag takes to fade in, in ms (VC-85 spec "Motion"). */
export const TAG_APPEAR_MS = 200;

/** How long the picked tag's grow and gold cross-fade take, in ms. */
export const TAG_PICK_MS = 160;

/** The dot's size (VC-85: 7, was 10). */
const DOT = 7;

/** How the tag's dot looks. */
export type TagDot =
  /** filled in the band's colour (a published score) */
  | { kind: 'band'; band: VibeLabel }
  /** filled grey (not started yet) */
  | { kind: 'muted' }
  /** a dashed grey ring ("Too early") */
  | { kind: 'dashed' };

/**
 * The live pulse on a tag:
 *   off    - none (most tags);
 *   moving - the slow growing ring;
 *   still  - a still ring instead (Reduce Motion, or the screen isn't in view).
 */
export type PulseMode = 'off' | 'moving' | 'still';

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
  /** false under Reduce Motion: no grow animation, no cross-fade. */
  animate: boolean;
  /** The live pulse (default none). */
  pulse?: PulseMode;
  /** How long the pulse waits before its first ring, in ms (so tags don't pulse in step). */
  pulseDelay?: number;
  /**
   * How long to wait before fading in when the tag first appears, in ms
   * (hotter tags first; see tagAppearDelays in src/lib/map-cluster.ts).
   * Ignored when `animate` is false: the tag is simply there.
   */
  appearDelay?: number;
  testID?: string;
}

/**
 * Keeps a marker's `tracksViewChanges` on for a short moment after its
 * first draw and after every change of its look, then off (see "Map speed"
 * above). Shared by tags, dots and cluster bubbles.
 *
 * @param look - everything that changes how the marker looks, as one text.
 * @param ms - how long to keep redrawing after a change.
 * @returns true while the marker should redraw.
 */
export function useBriefRedraw(look: string, ms: number = TAG_REDRAW_MS): boolean {
  // React's "adjust state when a prop changes" pattern: no effect needed to
  // notice the change.
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
    const timer = setTimeout(() => setRedrawing(false), ms);
    return () => clearTimeout(timer);
  }, [redrawing, look, ms]);
  return redrawing;
}

/**
 * The colour of a dot.
 *
 * @param dot - how the dot looks.
 * @param picked - true on a picked (gold) tag, where the dot turns dark.
 * @returns a fill colour, or undefined for the dashed ring (no fill).
 */
export function dotFill(dot: TagDot, picked: boolean): string | undefined {
  if (dot.kind === 'dashed') return undefined;
  if (picked) return colors.onAccent;
  return dot.kind === 'band' ? wordColour(dot.band) : colors.muted;
}

/**
 * A short text naming the dot's band, used to notice band changes.
 *
 * @param dot - how the dot looks.
 * @returns "Hot", "muted" or "dashed".
 */
function bandKey(dot: TagDot): string {
  return dot.kind === 'band' ? dot.band : dot.kind;
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
  pulse = 'off',
  pulseDelay = 0,
  appearDelay = 0,
  testID,
}: MapTagProps) {
  const band = dot.kind === 'band' ? dot.band : null;
  // Large text: the score goes under the name.
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= STACK_FONT_SCALE;

  // The band cross-fade: remember the band shown last; when it changes, keep
  // the OLD dot as a "ghost" on top and fade it out (adjust-state pattern).
  const [shownDot, setShownDot] = useState(dot);
  const [ghost, setGhost] = useState<TagDot | null>(null);
  if (bandKey(shownDot) !== bandKey(dot)) {
    setShownDot(dot);
    // No fade under Reduce Motion, nor on a picked tag (its dot is dark anyway).
    setGhost(animate && !picked ? shownDot : null);
  }
  const [ghostOpacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!ghost) return;
    ghostOpacity.setValue(1);
    const fade = Animated.timing(ghostOpacity, {
      toValue: 0,
      duration: BAND_FADE_MS,
      useNativeDriver: true,
    });
    // Remove the ghost once it has faded (state set only in the callback).
    fade.start(() => setGhost(null));
    return () => fade.stop();
  }, [ghost, ghostOpacity]);

  // Everything that changes how the tag looks, as one piece of text. A
  // band change redraws a little longer, to cover the cross-fade.
  const look = `${name}|${trailing}|${dot.kind}|${band ?? ''}|${picked}|${pulse}|${stacked}`;
  const redrawing = useBriefRedraw(look, ghost ? BAND_FADE_MS + 100 : TAG_REDRAW_MS);

  // The picked tag grows a little (spec: 1.08 in 160 ms) and its gold fill
  // cross-fades in at the same pace (VC-85). `gold` is the gold layer's
  // opacity: 0 = glass, 1 = gold.
  const [scale] = useState(() => new Animated.Value(picked ? 1.08 : 1));
  const [gold] = useState(() => new Animated.Value(picked ? 1 : 0));
  useEffect(() => {
    const duration = animate ? TAG_PICK_MS : 0;
    Animated.parallel([
      Animated.timing(scale, { toValue: picked ? 1.08 : 1, duration, useNativeDriver: true }),
      Animated.timing(gold, { toValue: picked ? 1 : 0, duration, useNativeDriver: true }),
    ]).start();
  }, [picked, animate, scale, gold]);

  // VC-85: a new tag fades in (200 ms, after its own short wait, so the
  // hottest tags arrive first). Only when it first appears: the starting
  // value is read once, so later changes of `animate` don't hide it again.
  const [appear] = useState(() => new Animated.Value(animate ? 0 : 1));
  useEffect(() => {
    // Nothing to do when it started fully shown (Reduce Motion).
    if (!animate) {
      appear.setValue(1);
      return;
    }
    const fadeIn = Animated.timing(appear, {
      toValue: 1,
      duration: TAG_APPEAR_MS,
      delay: appearDelay,
      useNativeDriver: true,
    });
    fadeIn.start();
    return () => fadeIn.stop();
    // Run once per tag: a fade-in is only for its first appearance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fire = band === 'Fire';
  const scoreColour = picked ? colors.onAccent : wordColour(band);

  const nameText = (
    <Text style={[styles.name, picked && styles.textPicked]} maxFontSizeMultiplier={1.3}>
      {name}
    </Text>
  );
  const trailingText = (
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
  );

  return (
    <Marker
      coordinate={coordinate}
      onPress={onPress}
      tracksViewChanges={redrawing}
      accessibilityLabel={spoken}
      testID={testID}
    >
      {/* Clear padding around the 26 px pill makes the touch area 44 tall. */}
      <Animated.View
        style={[styles.touch, { opacity: appear }]}
        testID={testID ? `${testID}-appear` : undefined}
      >
        <Animated.View
          style={[
            styles.pill,
            stacked && styles.pillStacked,
            fire && styles.pillFire,
            picked && styles.pillPicked,
            { transform: [{ scale }] },
          ]}
        >
          {/* The gold fill of a picked tag, faded in over the glass. */}
          <Animated.View
            pointerEvents="none"
            testID={testID ? `${testID}-gold` : undefined}
            style={[styles.goldLayer, { opacity: gold }]}
          />
          <View style={styles.dotBox}>
            {pulse !== 'off' ? (
              <PulseRing
                mode={pulse}
                delay={pulseDelay}
                colour={wordColour(band)}
                testID={testID ? `${testID}-pulse` : undefined}
              />
            ) : null}
            <View
              testID={testID ? `${testID}-dot` : undefined}
              style={[
                styles.dot,
                dot.kind === 'dashed'
                  ? [styles.dotDashed, picked && { borderColor: colors.onAccent }]
                  : { backgroundColor: dotFill(dot, picked) },
              ]}
            />
            {ghost ? (
              <Animated.View
                testID={testID ? `${testID}-ghost` : undefined}
                style={[
                  styles.dot,
                  styles.ghost,
                  ghost.kind === 'dashed'
                    ? styles.dotDashed
                    : { backgroundColor: dotFill(ghost, false) },
                  { opacity: ghostOpacity },
                ]}
              />
            ) : null}
          </View>
          {stacked ? (
            // Large text: the name on top, the score (or time) underneath.
            <View style={styles.stack} testID={testID ? `${testID}-stacked` : undefined}>
              {nameText}
              {trailingText}
            </View>
          ) : (
            <>
              {nameText}
              {trailingText}
            </>
          )}
        </Animated.View>
      </Animated.View>
    </Marker>
  );
}

/**
 * The live pulse ring around a tag's dot (spec §4).
 *
 * @param props.mode - 'moving' grows the ring from 1x to 1.5x the dot and
 *   fades it, every 2.4 s, on the native driver; 'still' shows a still ring
 *   (Reduce Motion, or the screen isn't in view).
 * @param props.delay - wait before the first ring, in ms (per event).
 * @param props.colour - the band's colour.
 * @param props.testID - for tests.
 * @returns the ring, drawn behind the dot (decoration: hidden from screen readers).
 */
function PulseRing({
  mode,
  delay,
  colour,
  testID,
}: {
  mode: Exclude<PulseMode, 'off'>;
  delay: number;
  colour: string;
  testID?: string;
}) {
  // 0 = ring at the dot's size and visible, 1 = grown and gone.
  const [grow] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (mode !== 'moving') return;
    const loop = Animated.loop(
      Animated.timing(grow, {
        toValue: 1,
        duration: PULSE_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    // Start after this event's own delay, so tags don't pulse together.
    const timer = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(timer);
      loop.stop();
      grow.setValue(0);
    };
  }, [mode, delay, grow]);

  const moving = mode === 'moving';
  return (
    <Animated.View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.ring,
        { borderColor: colour },
        moving
          ? {
              opacity: grow.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
              transform: [
                { scale: grow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) },
              ],
            }
          : // A still ring: grown and half see-through (the mock's Reduce Motion look).
            { opacity: 0.5, transform: [{ scale: 1.5 }] },
      ]}
    />
  );
}

/** Styles built only from theme tokens and the map's glass (spec §2, VC-85). */
const styles = StyleSheet.create({
  // 9 px above and below the 26 px pill: a 44 px tall touch area.
  touch: { paddingVertical: (minTapTarget - TAG_HEIGHT) / 2, paddingHorizontal: 2 },
  pill: {
    height: TAG_HEIGHT,
    minWidth: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 8,
    paddingRight: 10,
    borderRadius: TAG_HEIGHT / 2,
    backgroundColor: glass.fill,
    borderWidth: 1,
    borderColor: glass.tagHairline,
  },
  // Large text: the pill grows to fit two lines.
  pillStacked: { height: undefined, minHeight: TAG_HEIGHT, paddingVertical: 3 },
  pillFire: { borderColor: colors.accent },
  // The gold FILL comes from goldLayer (cross-faded); only the edge switches.
  pillPicked: { borderColor: colors.accent },
  goldLayer: {
    ...StyleSheet.absoluteFill,
    borderRadius: TAG_HEIGHT / 2,
    backgroundColor: colors.accent,
  },
  stack: { flexDirection: 'column' },
  dotBox: { width: DOT, height: DOT },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  dotDashed: { borderWidth: 1.25, borderStyle: 'dashed', borderColor: colors.muted },
  // The fading old dot sits exactly on top of the new one.
  ghost: { position: 'absolute', top: 0, left: 0 },
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 1.5,
  },
  name: { fontFamily: fonts.bodyBold, fontSize: 12, lineHeight: 16, color: colors.text },
  score: { fontFamily: fonts.display, fontSize: 13, lineHeight: 16 },
  // "Too early", "10 PM", "2 parties": Manrope 500 11, muted (6.7:1 on the glass).
  muted: { fontFamily: fonts.bodyMedium, fontSize: 11, lineHeight: 14, color: colors.muted },
  textPicked: { color: colors.onAccent },
});
