/**
 * The vibe meter (task VC-B09, arc gauge since VC-52): a half-circle gauge
 * that fills from 0 to 10, the big score in its middle, and the word under it.
 *
 * What it shows, by state (design/score-visuals-and-tags-spec.md, section 2):
 *   live     a gold-ish fill to the score, e.g. "8.0", and the word "Hot";
 *            hotter words are brighter gold (Quiet grey, Good, Hot, Fire);
 *   stale    the last score with a grey fill, number and word in grey (the
 *            party has been quiet for 90+ minutes, so it's old news);
 *   early    the empty track and "Early reading" (no number before 5 ratings);
 *   none     the empty track and "No vibe yet";
 *   night    (the All night view, words only) the empty track with the
 *            night's word in the middle, in its colour: no number and no
 *            fill level, because the night's number is never sent (cto);
 *   loading  the empty track with a spinner in the middle;
 *   blank    the empty track only (the first load failed; the card says so).
 *
 * The number and the word always carry the meaning; the arc is a visual
 * extra, so it is hidden from screen readers. The whole gauge is ONE element
 * that says e.g. "Vibe 8.0 out of 10, Hot".
 *
 * Movement (all skipped when the phone's "Reduce Motion" is on):
 *   - the first score sweeps up from 0 in 700 ms while the number counts up;
 *   - a new score moves from the old one in 400 ms (the number just swaps);
 *   - the colour swaps at the END of a move (no colour blending);
 *   - going stale fades the fill and text to grey in 300 ms.
 * A poll that brings the same score moves nothing (the effect below only
 * runs when the score itself changes).
 *
 * Glow (VC-70, approved as proposal P3): a live Hot or Fire score gets a
 * soft gold glow behind the arc, a radial gradient that fades from 14%
 * gold in the middle to nothing at the edge (under the 15% cap). It never
 * moves, so Reduce Motion has nothing to switch off. No glow for Quiet or
 * Good, a stale (grey) score, early/none, loading, or the All night view,
 * which stays exactly as it was (words only).
 *
 * How the arc is drawn: react-native-svg (a new dependency with VC-52). The
 * fill is the same half-circle path as the track, with one dash as long as
 * the whole arc; shifting the dash ("strokeDashoffset") by the empty part
 * leaves only the filled part visible. It uses React Native's own Animated
 * (no extra animation library); SVG props can't use the native driver.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';

import type { VibeLabel } from '@/lib/rating';
// Shared with the skeletons and card press (Q6); the logic moved there unchanged.
import { useReduceMotion } from '@/lib/reduce-motion';
import { EARLY_TITLE, NO_VIBE_TITLE, VIBE_LOAD_ERROR, formatScore, meterSpoken } from '@/lib/vibe';
import type { Vibe, VibeView } from '@/lib/vibe';
import { colors, fonts, headlineMaxScale, typography } from '@/theme';

/** The half circle: centre (100, 100), radius 86, from the left end to the right. */
const ARC_PATH = 'M14 100 A86 86 0 0 1 186 100';
/** The arc's length: half of a circle's edge, π × 86 ≈ 270.2. */
export const ARC_LENGTH = Math.PI * 86;
/** How thick the arc is (the spec chose 8 over v3's 6: it reads better on a phone). */
const STROKE = 8;

/** Timings from the spec, in milliseconds. */
export const FIRST_SWEEP_MS = 700;
export const MOVE_MS = 400;
const FADE_MS = 300;

/**
 * How strong the glow is at its centre (VC-70: must stay under 15%, so it
 * reads as warmth, not a coloured blob). Exported for the test.
 */
export const GLOW_OPACITY = 0.14;

/**
 * Whether a gauge gets the gold glow (VC-70): only a live Hot or Fire score.
 *
 * @param vibe - the vibe on the gauge.
 * @param hasScore - whether a number is drawn (false for early, none,
 *   loading, blank and the words-only All night view).
 * @returns true to draw the glow.
 */
export function showsGlow(vibe: Vibe, hasScore: boolean): boolean {
  return hasScore && vibe.state === 'live' && (vibe.label === 'Hot' || vibe.label === 'Fire');
}

/** A Path whose props can follow an Animated value. */
const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * The fill and word colour for each vibe word: a brightness ramp of the v3
 * gold tokens, so "hotter" is brighter (all readable on the card: 6.7+).
 */
const WORD_COLOURS: Record<VibeLabel, string> = {
  Quiet: colors.muted,
  Good: colors.accentPressed,
  Hot: colors.accent,
  Fire: colors.accentHover,
};

/**
 * The colour for a vibe word.
 *
 * @param label - the server's word (it is worked out on the rounded score,
 *   so number, word and colour always agree).
 * @returns the hex colour (gold when there is no word).
 */
export function wordColour(label: VibeLabel | null): string {
  return label ? WORD_COLOURS[label] : colors.accent;
}

/**
 * How far to shift the fill's dash for a score: the empty part of the arc.
 *
 * @param score - 0 to 10 (values outside are clamped).
 * @returns ARC_LENGTH × (1 − score / 10): 270.2 at 0 (nothing shows), 0 at 10.
 */
export function dashOffset(score: number): number {
  const clamped = Math.max(0, Math.min(10, score));
  return ARC_LENGTH * (1 - clamped / 10);
}

/** What a VibeMeter needs. */
export interface VibeMeterProps {
  /** The vibe to draw (for the All night view, from nightAsVibe). */
  vibe: Vibe;
  /** Which view it is, for the spoken sentence (default live). */
  view?: VibeView;
  /** true while the first answer is loading: track plus spinner. */
  loading?: boolean;
  /** true when the first load failed: the track only (the card shows the message). */
  blank?: boolean;
}

/**
 * Renders the gauge.
 *
 * @returns the gauge, read out as one item (a "progress bar" from 0 to 10
 *   when there is a score).
 */
export function VibeMeter({ vibe, view = 'live', loading = false, blank = false }: VibeMeterProps) {
  const reduceMotion = useReduceMotion();
  const hasScore = !loading && !blank && vibe.score !== null && vibe.label !== null;
  // The All night view: a word and no number (it never has a score).
  const wordOnly = !loading && !blank && view === 'night' && !hasScore && vibe.label !== null;
  const stale = hasScore && vibe.state === 'stale';
  const target = hasScore ? (vibe.score ?? 0) : 0;
  const colour = wordColour(vibe.label);
  const glow = showsGlow(vibe, hasScore);
  // An id for the glow's gradient that is unique on the screen. React's ids
  // contain ":" characters, which SVG's url(#...) links can't use, so keep
  // only letters and numbers.
  const glowId = `vibe-glow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  // `progress` is the score the arc currently shows (0 to 10), animated.
  // It starts at 0, so the first reading sweeps up from empty.
  // (Kept in state, not a ref: the value object itself never changes, and
  // reading a ref while drawing isn't allowed by the React rules.)
  const [progress] = useState(() => new Animated.Value(0));
  // `greyness` goes 0 (colour) to 1 (grey) when the reading goes stale.
  const [greyness] = useState(() => new Animated.Value(stale ? 1 : 0));
  // The number while it counts up during the first sweep (null otherwise).
  const [countUp, setCountUp] = useState<number | null>(null);
  // The fill colour as of the last FINISHED move: during a move the old
  // colour stays, and the new one takes over at the end (spec).
  const [settledColour, setSettledColour] = useState(colour);
  // The score drawn last time (null before the first score), so we can tell
  // "first reading" (sweep from 0, count up) from "new score" (short move).
  const lastScore = useRef<number | null>(null);

  // Move the arc when (and only when) the score changes. State is only set
  // inside the animation's callbacks, never straight in the effect.
  useEffect(() => {
    // Wait for the phone to say whether Reduce Motion is on.
    if (reduceMotion === null) return;
    const previous = lastScore.current;
    lastScore.current = hasScore ? target : null;
    if (reduceMotion || !hasScore) {
      // No movement: draw the final state at once.
      progress.setValue(target);
      return;
    }
    const first = previous === null;
    if (first) progress.setValue(0);
    // During the first sweep the number counts up with the arc.
    const listener = first
      ? progress.addListener(({ value }) => setCountUp(Math.round(value * 10) / 10))
      : null;
    const animation = Animated.timing(progress, {
      toValue: target,
      duration: first ? FIRST_SWEEP_MS : MOVE_MS,
      easing: first ? Easing.out(Easing.cubic) : Easing.inOut(Easing.ease),
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      // Always stop counting (even if a newer score interrupted this move).
      setCountUp(null);
      if (finished) setSettledColour(colour);
    });
    return () => {
      animation.stop();
      if (listener) progress.removeListener(listener);
    };
  }, [target, hasScore, colour, reduceMotion, progress]);

  // Fade to grey (or back) when the stale flag changes.
  useEffect(() => {
    if (reduceMotion !== false) {
      greyness.setValue(stale ? 1 : 0);
      return;
    }
    const animation = Animated.timing(greyness, {
      toValue: stale ? 1 : 0,
      duration: FADE_MS,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [stale, reduceMotion, greyness]);

  // Without movement the colour is simply the word's colour; with movement
  // it is the settled one until the move ends.
  const fillBase = reduceMotion !== false ? colour : settledColour;
  const shownNumber = reduceMotion ? target : (countUp ?? target);

  const offset = progress.interpolate({
    inputRange: [0, 10],
    outputRange: [ARC_LENGTH, 0],
    extrapolate: 'clamp',
  });
  const fillColour = greyness.interpolate({
    inputRange: [0, 1],
    outputRange: [fillBase, colors.fieldBorder],
  });
  const numberColour = greyness.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.text, colors.muted],
  });
  const wordTextColour = greyness.interpolate({
    inputRange: [0, 1],
    outputRange: [fillBase, colors.muted],
  });

  return (
    <View
      style={styles.meter}
      accessible
      accessibilityRole={hasScore ? 'progressbar' : undefined}
      accessibilityLabel={
        loading ? 'Loading the vibe' : blank ? VIBE_LOAD_ERROR : meterSpoken(vibe, view)
      }
      accessibilityValue={hasScore ? { min: 0, max: 10, now: Math.round(target) } : undefined}
      testID="vibe-meter"
    >
      <View style={styles.gauge}>
        {/* The arc itself: decoration for sighted people, hidden from screen
            readers (the number and word carry the meaning). */}
        <Svg
          width="100%"
          height="100%"
          viewBox="0 0 200 104"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {/* VC-70: the soft gold glow, drawn first so it sits behind the
              arc. An oval centred on the arc's base line: the drawing area
              cuts off its lower half, so it rises like a dome of warm light
              under the arc. Static: it never animates. */}
          {glow ? (
            <>
              <Defs>
                <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor={colors.accent} stopOpacity={GLOW_OPACITY} />
                  <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Ellipse
                testID="vibe-meter-glow"
                cx={100}
                cy={100}
                rx={100}
                ry={96}
                fill={`url(#${glowId})`}
              />
            </>
          ) : null}
          <Path
            testID="vibe-meter-track"
            d={ARC_PATH}
            stroke={colors.border}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
          />
          {/* At 0.0 the fill isn't drawn at all: its round end would show a dot. */}
          {hasScore && target > 0 ? (
            <AnimatedPath
              testID="vibe-meter-fill"
              d={ARC_PATH}
              stroke={fillColour}
              strokeWidth={STROKE}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={ARC_LENGTH}
              strokeDashoffset={offset}
            />
          ) : null}
        </Svg>
        {loading ? (
          <View style={styles.centre}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : null}
        {wordOnly ? (
          // Words only: the night's word sits where the number would, in its
          // colour, over an empty track (no fill level to read a number from).
          <Text
            style={[styles.nightWord, { color: colour }]}
            maxFontSizeMultiplier={headlineMaxScale}
            testID="vibe-meter-word"
          >
            {vibe.label}
          </Text>
        ) : null}
        {hasScore ? (
          // Plain text over the arc, bottom-centred (not SVG text, so it
          // follows the phone's text size, capped so it stays in the arc).
          <Animated.Text
            style={[styles.score, { color: numberColour }]}
            maxFontSizeMultiplier={headlineMaxScale}
          >
            {formatScore(shownNumber)}
          </Animated.Text>
        ) : null}
      </View>
      {hasScore ? (
        <Animated.Text style={[styles.word, { color: wordTextColour }]}>{vibe.label}</Animated.Text>
      ) : loading || blank || wordOnly ? null : (
        <Text style={styles.title}>{vibe.state === 'early' ? EARLY_TITLE : NO_VIBE_TITLE}</Text>
      )}
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  meter: { alignSelf: 'stretch', alignItems: 'center', marginTop: 8 },
  // 200 × 104 like the v3 drawing, shrinking on a narrower card.
  gauge: { width: '100%', maxWidth: 200, aspectRatio: 200 / 104 },
  centre: { position: 'absolute', left: 0, right: 0, bottom: 8, alignItems: 'center' },
  // The big number: Bricolage extra bold 46/52, sitting on the arc's base line.
  score: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    textAlign: 'center',
    fontFamily: fonts.display,
    fontSize: 46,
    lineHeight: 52,
  },
  word: { ...typography.cardTitle, marginTop: 4 },
  // The All night word in the arc: big, but smaller than a number so long
  // words ("Quiet") fit.
  nightWord: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 4,
    textAlign: 'center',
    fontFamily: fonts.display,
    fontSize: 36,
    lineHeight: 42,
  },
  title: { ...typography.cardTitle, color: colors.text, textAlign: 'center', marginTop: 4 },
});
