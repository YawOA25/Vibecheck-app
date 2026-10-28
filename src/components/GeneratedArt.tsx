/**
 * Generated placeholder art (VC-69): a soft gold-on-near-black picture that
 * fills a "photo" slot until real event photos exist (VC-68).
 *
 * Where it's used:
 *   - the 170 px band at the top of the event page (seeded by the event id);
 *   - the sign-in hero (VC-32a), with one fixed seed for everyone.
 * (The v3 hero event card also has a photo slot, but that card isn't built
 * yet: VC-31. The compact cards on the home list have no image slot.)
 *
 * What it draws, from back to front, with only two colours (the theme's
 * near-black `surface` and its `accent` gold):
 *   1. a near-black base;
 *   2. a faint gold wash running in one direction across the whole picture;
 *   3. two soft round gold glows;
 *   4. three slanted gold stripes that fade out towards the bottom.
 * Every position, size and strength comes from artRecipe (src/lib/
 * generated-art.ts), which works them out from the seed alone. So the same
 * event always has the same picture, and it says nothing about where the
 * party is or how it's rated.
 *
 * It is pure decoration: screen readers skip it entirely.
 *
 * Drawing note: the picture is drawn on a 100 x 100 grid and then stretched
 * to whatever size the slot is (preserveAspectRatio "none"). Stretching is
 * fine here because everything is soft shapes, with no circles or text that
 * would look squashed.
 */
import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Defs,
  Ellipse,
  LinearGradient,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { artRecipe } from '@/lib/generated-art';
import { colors } from '@/theme';

/** What a GeneratedArt needs. */
export interface GeneratedArtProps {
  /**
   * What the picture is worked out from: the event id, or a fixed word for
   * the sign-in hero. Never pass the area, the score or anything else about
   * the event (privacy rule, VC-69).
   */
  seed: string;
  /**
   * Height in pixels, e.g. 170 for the event page band. Leave it out to
   * fill the parent (the sign-in hero places it behind its content).
   */
  height?: number;
  /** Optional id for tests. */
  testID?: string;
}

/**
 * Renders the picture.
 *
 * @returns a view as wide as its parent, hidden from screen readers.
 */
export function GeneratedArt({ seed, height, testID }: GeneratedArtProps) {
  const recipe = artRecipe(seed);
  // Each picture needs its own gradient names, or two pictures on one
  // screen would share (and mix up) their gradients. useId gives a unique
  // name; its ":" characters break SVG's url(#...) links, so drop them.
  const uid = useId().replace(/:/g, '');
  const washId = `art-wash-${uid}`;
  const bandId = `art-band-${uid}`;

  // The wash runs from one edge to the opposite one, at the recipe's angle.
  // (cos, sin) is a step in that direction; centring it on the middle of
  // the picture (0.5, 0.5) gives the start and end points on a 0-1 scale.
  const angle = (recipe.washAngle * Math.PI) / 180;
  const dx = Math.cos(angle) / 2;
  const dy = Math.sin(angle) / 2;

  return (
    <View
      testID={testID}
      // Decoration only: hidden from screen readers on both phones.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={height === undefined ? StyleSheet.absoluteFill : { height }}
    >
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={washId} x1={0.5 - dx} y1={0.5 - dy} x2={0.5 + dx} y2={0.5 + dy}>
            <Stop offset={0} stopColor={colors.accent} stopOpacity={0} />
            <Stop offset={1} stopColor={colors.accent} stopOpacity={recipe.washOpacity} />
          </LinearGradient>
          {/* Stripes: full gold at the top fading to nothing at the bottom;
              each stripe's own strength is set with fillOpacity below. */}
          <LinearGradient id={bandId} x1={0} y1={0} x2={0} y2={1}>
            <Stop offset={0} stopColor={colors.accent} stopOpacity={1} />
            <Stop offset={1} stopColor={colors.accent} stopOpacity={0} />
          </LinearGradient>
          {recipe.glows.map((glow, i) => (
            // A glow: its strength at the centre, fading to nothing at the edge.
            <RadialGradient key={i} id={`art-glow-${uid}-${i}`}>
              <Stop offset={0} stopColor={colors.accent} stopOpacity={glow.opacity} />
              <Stop offset={1} stopColor={colors.accent} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>

        <Rect x={0} y={0} width={100} height={100} fill={colors.surface} />
        <Rect x={0} y={0} width={100} height={100} fill={`url(#${washId})`} />
        {recipe.glows.map((glow, i) => (
          <Ellipse
            key={i}
            cx={glow.cx * 100}
            cy={glow.cy * 100}
            rx={glow.rx * 100}
            ry={glow.ry * 100}
            fill={`url(#art-glow-${uid}-${i})`}
          />
        ))}
        {recipe.bands.map((band, i) => {
          // A slanted stripe: its top edge runs from x to x + width; its
          // bottom edge is the same, shifted sideways by the skew.
          const left = band.x * 100;
          const right = (band.x + band.width) * 100;
          const shift = recipe.bandSkew * 100;
          return (
            <Polygon
              key={i}
              points={`${left},0 ${right},0 ${right + shift},100 ${left + shift},100`}
              fill={`url(#${bandId})`}
              fillOpacity={band.opacity}
            />
          );
        })}
      </Svg>
    </View>
  );
}
