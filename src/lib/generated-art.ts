/**
 * The "recipe" for generated placeholder art (VC-69, polish audit P2).
 *
 * Why it exists: v3's design puts a photo on the event page header, the
 * hero event card and the sign-in hero. Events have no photos yet (VC-68
 * comes later), and an empty grey block looks unfinished. So each event
 * gets a soft gold-on-near-black picture that is worked out from its id.
 *
 * "Worked out from its id" (deterministic) means: the same id always gives
 * exactly the same picture, on every phone, every time, with nothing stored
 * anywhere. Different ids give different pictures, so two events side by
 * side don't look like copies.
 *
 * Privacy and honesty rule: the ONLY input is the id (a random code the
 * database made up). The picture must never hint at where the party is or
 * how good it is, so nothing else (area, score, time) is ever passed in.
 *
 * This file only does the maths and returns plain numbers. The drawing is
 * in src/components/GeneratedArt.tsx, so the maths can be tested on its own.
 */

/** One soft round glow of gold. Positions and sizes are 0-1 of the picture. */
export interface ArtGlow {
  /** Centre, left to right (0 = left edge, 1 = right edge). */
  cx: number;
  /** Centre, top to bottom (0 = top, 1 = bottom). */
  cy: number;
  /** How far the glow reaches, sideways (0-1 of the width). */
  rx: number;
  /** How far the glow reaches, up and down (0-1 of the height). */
  ry: number;
  /** How strong the gold is at the centre (0 = invisible, 1 = solid). */
  opacity: number;
}

/** One slanted see-through stripe of gold (the "band" in "gradient band"). */
export interface ArtBand {
  /** Where the stripe starts along the top edge (0-1 of the width). */
  x: number;
  /** How wide the stripe is (0-1 of the width). */
  width: number;
  /** How strong the gold is at the top of the stripe; it fades to nothing below. */
  opacity: number;
}

/** Everything needed to draw one picture. All numbers are rounded to 3 places. */
export interface ArtRecipe {
  /** Direction of the faint gold wash across the whole picture, in degrees (0-359). */
  washAngle: number;
  /** Strength of that wash at its gold end. */
  washOpacity: number;
  /** Two soft glows. */
  glows: ArtGlow[];
  /** Three stripes, all leaning the same way. */
  bands: ArtBand[];
  /** How far each stripe's bottom is shifted from its top (-0.3 to 0.3 of the width). */
  bandSkew: number;
}

/**
 * Turns a piece of text into a whole number between 0 and 4,294,967,295
 * (the FNV-1a "hash"). The same text always gives the same number, and a
 * one-letter change gives a very different one.
 *
 * @param text - the text to turn into a number (here, an event id).
 * @returns an unsigned 32-bit whole number.
 */
export function hashSeed(text: string): number {
  // FNV-1a: start from a fixed number, then for each character mix it in
  // (xor) and multiply by a fixed prime. Math.imul keeps it in 32 bits.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0; // ">>> 0" makes it a positive number
}

/**
 * Makes a "random number" maker that always gives the same list of numbers
 * for the same starting number (the "mulberry32" method). Math.random can't
 * be used: it would give a new picture every time the screen draws.
 *
 * @param seed - the starting number (from hashSeed).
 * @returns a function that returns the next number between 0 and 1 each call.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // Standard mulberry32 steps: shuffle the bits of a running counter.
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rounds to 3 decimal places, so the numbers (and the drawing) are tidy and
 * exactly the same on every phone.
 *
 * @param n - any number.
 * @returns n rounded to 3 places.
 */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Works out the picture for one id.
 *
 * The ranges below are what keeps the art "subtle and on brand": each gold
 * layer is at most 18% strong. Even where the wash, both glows and a stripe
 * all overlap (about 45% gold at worst), the off-white text drawn on top
 * (the sign-in wordmark and headline) still reads at more than 5 to 1.
 *
 * @param seed - the event id (or a fixed word for the sign-in hero). Nothing
 *   else about the event may be passed in (see the privacy rule above).
 * @returns the recipe for that id; the same id always gives the same recipe.
 */
export function artRecipe(seed: string): ArtRecipe {
  const random = seededRandom(hashSeed(seed));
  /** A number between min and max, rounded. */
  const between = (min: number, max: number) => round3(min + random() * (max - min));

  const washAngle = Math.floor(random() * 360);
  const washOpacity = between(0.04, 0.1);
  const glows: ArtGlow[] = [0, 1].map(() => ({
    cx: between(0, 1),
    cy: between(0, 1),
    rx: between(0.35, 0.7),
    ry: between(0.6, 1.1),
    opacity: between(0.08, 0.18),
  }));
  // Three stripes spread across the width: each starts somewhere in its own
  // third, so they never pile up in one corner.
  const bands: ArtBand[] = [0, 1, 2].map((i) => ({
    x: round3(i / 3 + random() / 3 - 0.1),
    width: between(0.04, 0.14),
    opacity: between(0.04, 0.1),
  }));
  const bandSkew = between(-0.3, 0.3);
  return { washAngle, washOpacity, glows, bands, bandSkew };
}

/** The seed for the sign-in hero (VC-32a): one fixed picture for everyone. */
export const SIGN_IN_ART_SEED = 'vibecheck-sign-in';
