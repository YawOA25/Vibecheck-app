/**
 * An area's heat glow on the map (VC-83 map v2, design/vc83-map-v2-spec.md
 * §3).
 *
 * What it draws: stacked see-through circles around the area's fixed
 * centre (five since VC-85, see below; three in VC-83). Inner circles
 * pile on top of outer ones, so the gold glow is strongest in the middle
 * and fades out towards the edge without needing a picture. How strong the glow is follows the BAND
 * (Quiet, Good, Hot, Fire), using only the v3 gold ramp.
 *
 * VC-85 step 1 ("soft radial glow", design/vc85-map-brand-spec.md): Apple
 * Maps can't fill a circle with a real gradient, and a picture overlay would
 * need its size worked out at every zoom. So the glow is now FIVE thinner
 * rings (at 100%, 80%, 60%, 40% and 20% of the radius) with no hard edge,
 * tuned so the middle reaches the spec's strength (Fire 55% light gold, Hot
 * 38%, Good 20%, Quiet 20% grey) and it fades smoothly to almost nothing at
 * the area's edge. The OUTER ring is still exactly the area's size.
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
 * The glow recipe per band (VC-85 spec "Glow"): the band's colour and how
 * strong the glow is in the very middle (0 to 1).
 */
const RECIPES: Record<VibeLabel, { colour: string; centre: number }> = {
  Quiet: { colour: colors.muted, centre: 0.2 },
  Good: { colour: colors.accentPressed, centre: 0.2 },
  Hot: { colour: colors.accent, centre: 0.38 },
  Fire: { colour: colors.accentHover, centre: 0.55 },
};

/** The rings' sizes, outer first, as shares of the area's radius. */
const SCALES = [1, 0.8, 0.6, 0.4, 0.2] as const;

/**
 * How strong the glow looks in each band of the area, outer band first, as
 * a share of the middle's strength: faint at the edge, full in the middle
 * (the mock's radial gradient, in 5 steps).
 */
const PROFILE = [0.12, 0.3, 0.5, 0.75, 1] as const;

/**
 * The see-through amount of each ring so the STACK looks like PROFILE.
 *
 * Why the sum isn't simple: see-through layers on top of each other don't
 * add up. Two 20% layers look like 36%, not 40% (the second one only
 * covers what the first let through). So for each ring we work out the
 * amount that turns what is already showing (`before`) into the target
 * (`target`): 1 - (1 - target) / (1 - before).
 *
 * @param centre - how strong the middle should look (0 to 1).
 * @returns one opacity per ring, outer first.
 */
export function ringAlphas(centre: number): number[] {
  let before = 0;
  return PROFILE.map((share) => {
    const target = centre * share;
    const alpha = 1 - (1 - target) / (1 - before);
    before = target;
    return alpha;
  });
}

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
 * @returns the circles, outer first: five soft rings with no edge. With no
 *   band: one faint grey circle with a dashed edge (the inner rings would be
 *   fully clear, so they aren't drawn at all).
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
  const alphas = ringAlphas(recipe.centre);
  // No hard edge on any ring (VC-85): the glow just fades out.
  return SCALES.map((scale, i) => ({
    scale,
    fill: rgba(recipe.colour, alphas[i] * strength),
    strokeWidth: 0,
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
 * @returns 1 to 5 map circles (testID "map-circle" in the Jest fake); for
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
