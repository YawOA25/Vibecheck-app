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
 *
 * VC-83 Batch 2: when the band changes (a new snapshot was published), the
 * old glow fades out while the new one fades in, over 400 ms in 4 steps
 * (spec §3). Map circles can't use React Native's animation driver, so the
 * fade re-sends the circles' colours 4 times; that happens only on a
 * publish, so it costs nothing the rest of the time. Under Reduce Motion
 * the change is instant.
 */
import { useEffect, useState } from 'react';
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

/** How long a band change fades, in ms (spec §3), and in how many steps. */
export const GLOW_FADE_MS = 400;
const GLOW_FADE_STEPS = 4;

/**
 * Works out the circles for one area.
 *
 * @param band - the band to show (for an area with 2+ parties, the hottest
 *   published band among them), or null when none has a published score.
 * @param strength - 0 to 1: how far faded in (1, the default, is the full
 *   glow; used only while a band change cross-fades).
 * @returns the circles, outer first. With no band: one faint grey circle
 *   with a dashed edge (the middle and core would be fully clear, so they
 *   aren't drawn at all).
 */
export function heatLayers(band: VibeLabel | null, strength: number = 1): HeatLayer[] {
  if (band === null) {
    return [
      {
        scale: 1,
        fill: rgba(colors.muted, 0.05 * strength),
        stroke: rgba(colors.muted, 0.5 * strength),
        strokeWidth: 1,
        dash: [6, 6],
      },
    ];
  }
  const recipe = RECIPES[band];
  return SCALES.map((scale, i) => ({
    scale,
    fill: rgba(recipe.colour, recipe.fills[i] * strength),
    // Only the outer circle gets an edge, and only for Hot and Fire.
    stroke:
      i === 0 && recipe.stroke > 0 ? rgba(recipe.colour, recipe.strokeAlpha * strength) : undefined,
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
  /** false under Reduce Motion: a band change is instant instead of fading. */
  fade?: boolean;
}

/** One circle to draw: its layer and a key that stays put while it fades. */
interface DrawnLayer {
  key: string;
  layer: HeatLayer;
}

/**
 * Renders the stacked circles.
 *
 * @returns 1 to 3 map circles (testID "map-circle" in the Jest fake); for
 *   400 ms after a band change, the old band's circles too, fading out.
 */
export function AreaHeat({ latitude, longitude, radius, band, fade = false }: AreaHeatProps) {
  const center = { latitude, longitude };
  // The band drawn last, and (while fading) the band it is fading from.
  // "Adjust state when a prop changes": noticed during the render.
  const [shownBand, setShownBand] = useState(band);
  const [fadingFrom, setFadingFrom] = useState<{ band: VibeLabel | null } | null>(null);
  // How far the fade has got: 0 just started, 1 done.
  const [progress, setProgress] = useState(1);
  if (shownBand !== band) {
    setShownBand(band);
    setFadingFrom(fade ? { band: shownBand } : null);
    setProgress(fade ? 0 : 1);
  }
  useEffect(() => {
    if (!fadingFrom) return;
    // Step the fade along on a timer (state set only inside the timer).
    const stepMs = GLOW_FADE_MS / GLOW_FADE_STEPS;
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      setProgress(step / GLOW_FADE_STEPS);
      if (step >= GLOW_FADE_STEPS) {
        clearInterval(timer);
        setFadingFrom(null);
      }
    }, stepMs);
    return () => clearInterval(timer);
  }, [fadingFrom]);

  const drawn: DrawnLayer[] = [];
  if (fadingFrom) {
    for (const layer of heatLayers(fadingFrom.band, 1 - progress)) {
      drawn.push({ key: `old-${layer.scale}`, layer });
    }
  }
  for (const layer of heatLayers(band, fadingFrom ? progress : 1)) {
    drawn.push({ key: `${layer.scale}`, layer });
  }
  return (
    <>
      {drawn.map(({ key, layer }) => (
        <Circle
          key={key}
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
