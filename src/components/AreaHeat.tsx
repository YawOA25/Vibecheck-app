/**
 * An area's heat glow on the map (VC-83 map v2, design/vc83-map-v2-spec.md
 * §3).
 *
 * What it draws: up to three stacked circles around the area's fixed centre,
 * at 100%, 66% and 33% of the area's radius. Each one is a little more
 * opaque than the one around it, so the gold glow fades out towards the
 * edge without needing a picture. How strong the glow is follows the BAND
 * (Quiet, Good, Hot, Fire), using only the v3 gold ramp.
 *
 * Privacy: the circle SIZE is always the area's own size (600 m or more,
 * from the server). The score never changes the size, only the colour and
 * strength, so the map never draws a smaller circle for a hotter party.
 *
 * Without a published score (before the start, or "Too early") the area gets
 * only a faint grey wash with a dashed edge.
 *
 * It's decoration only: every fact is also on the tag in words and numbers.
 */
import { Circle } from 'react-native-maps';

import type { VibeLabel } from '@/lib/rating';
import { colors } from '@/theme';

/** One of the stacked circles. */
export interface HeatLayer {
  /** Its radius as a share of the area's radius (1, 0.66 or 0.33). */
  scale: number;
  /** Fill colour with its opacity, e.g. "rgba(214, 185, 123, 0.10)". */
  fill: string;
  /** Edge colour (outer circle only), or undefined for no edge. */
  stroke?: string;
  /** Edge width in points (0 for none). */
  strokeWidth: number;
  /** Dash pattern for the edge (only for "no score yet"). */
  dash?: number[];
}

/**
 * Turns a "#RRGGBB" colour and an opacity into "rgba(r, g, b, a)".
 *
 * @param hex - a 6-digit hex colour from the theme.
 * @param alpha - 0 to 1.
 * @returns the rgba() text react-native-maps understands.
 */
export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  // The three colour bytes, red first.
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

/**
 * The glow recipe per band (spec §3 table): band colour, fill opacity of the
 * outer / middle / core circle, and the outer edge.
 */
const RECIPES: Record<
  VibeLabel,
  { colour: string; fills: [number, number, number]; stroke: number; strokeAlpha: number }
> = {
  Quiet: { colour: colors.muted, fills: [0.06, 0.08, 0.1], stroke: 0, strokeAlpha: 0 },
  Good: { colour: colors.accentPressed, fills: [0.08, 0.12, 0.16], stroke: 0, strokeAlpha: 0 },
  Hot: { colour: colors.accent, fills: [0.1, 0.18, 0.26], stroke: 1, strokeAlpha: 0.4 },
  Fire: { colour: colors.accentHover, fills: [0.12, 0.24, 0.36], stroke: 1.5, strokeAlpha: 0.6 },
};

/** The circles' sizes, outer first, as shares of the area's radius. */
const SCALES = [1, 0.66, 0.33] as const;

/**
 * Works out the circles for one area.
 *
 * @param band - the band to show (for an area with 2+ parties, the hottest
 *   published band among them), or null when none has a published score.
 * @returns the circles, outer first. With no band: one faint grey circle
 *   with a dashed edge (the middle and core would be fully clear, so they
 *   aren't drawn at all).
 */
export function heatLayers(band: VibeLabel | null): HeatLayer[] {
  if (band === null) {
    return [
      {
        scale: 1,
        fill: rgba(colors.muted, 0.05),
        stroke: rgba(colors.muted, 0.5),
        strokeWidth: 1,
        dash: [6, 6],
      },
    ];
  }
  const recipe = RECIPES[band];
  return SCALES.map((scale, i) => ({
    scale,
    fill: rgba(recipe.colour, recipe.fills[i]),
    // Only the outer circle gets an edge, and only for Hot and Fire.
    stroke: i === 0 && recipe.stroke > 0 ? rgba(recipe.colour, recipe.strokeAlpha) : undefined,
    strokeWidth: i === 0 ? recipe.stroke : 0,
  }));
}

/** What an AreaHeat needs. */
export interface AreaHeatProps {
  /** The area's fixed centre (from the server). */
  latitude: number;
  longitude: number;
  /** The area's radius in metres (600 or more). Never changed by the score. */
  radius: number;
  /** The band to show, or null for "no score yet". */
  band: VibeLabel | null;
}

/**
 * Renders the stacked circles.
 *
 * @returns 1 to 3 map circles (testID "map-circle" in the Jest fake).
 */
export function AreaHeat({ latitude, longitude, radius, band }: AreaHeatProps) {
  const center = { latitude, longitude };
  return (
    <>
      {heatLayers(band).map((layer) => (
        <Circle
          key={layer.scale}
          center={center}
          radius={radius * layer.scale}
          fillColor={layer.fill}
          strokeColor={layer.stroke ?? 'transparent'}
          strokeWidth={layer.strokeWidth}
          lineDashPattern={layer.dash}
        />
      ))}
    </>
  );
}
