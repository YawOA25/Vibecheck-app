/**
 * Tests for the generated placeholder art (VC-69): the recipe maths in
 * src/lib/generated-art.ts and the drawing in src/components/GeneratedArt.tsx,
 * plus where it shows (the event page band is checked in event-screen.test,
 * the sign-in hero in sign-in-screen.test).
 *
 * We check:
 *   - the same id always gives the same picture (recipe AND drawing);
 *   - different ids give different pictures (50 made-up ids, all distinct);
 *   - every number stays in its "subtle" range (gold never too strong);
 *   - only the two brand colours are used: gold and near-black;
 *   - the picture is hidden from screen readers (it's decoration).
 */
import { render, screen } from '@testing-library/react-native';
import { processColor } from 'react-native';

import { GeneratedArt } from '@/components/GeneratedArt';
import { artRecipe, hashSeed, SIGN_IN_ART_SEED } from '@/lib/generated-art';
import { colors } from '@/theme';

/** 50 made-up event ids in the database's uuid shape. */
const IDS = Array.from(
  { length: 50 },
  (_, i) => `6f1c2a${String(i).padStart(2, '0')}-1b2c-4d5e-8f90-a1b2c3d4e5f6`,
);

describe('artRecipe (the maths)', () => {
  it('gives exactly the same recipe for the same id, every time', () => {
    for (const id of IDS) expect(artRecipe(id)).toEqual(artRecipe(id));
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
  });

  it('gives a different recipe for each different id', () => {
    const recipes = new Set(IDS.map((id) => JSON.stringify(artRecipe(id))));
    expect(recipes.size).toBe(IDS.length);
    // Even ids one letter apart look different.
    expect(artRecipe('event-a')).not.toEqual(artRecipe('event-b'));
  });

  it('keeps every value in its subtle range', () => {
    for (const id of [...IDS, SIGN_IN_ART_SEED, '']) {
      const r = artRecipe(id);
      expect(r.washAngle).toBeGreaterThanOrEqual(0);
      expect(r.washAngle).toBeLessThan(360);
      expect(r.washOpacity).toBeGreaterThanOrEqual(0.04);
      expect(r.washOpacity).toBeLessThanOrEqual(0.1);
      expect(r.glows).toHaveLength(2);
      for (const glow of r.glows) {
        expect(glow.opacity).toBeGreaterThanOrEqual(0.08);
        expect(glow.opacity).toBeLessThanOrEqual(0.18);
      }
      expect(r.bands).toHaveLength(3);
      for (const band of r.bands) expect(band.opacity).toBeLessThanOrEqual(0.1);
      expect(Math.abs(r.bandSkew)).toBeLessThanOrEqual(0.3);
    }
  });
});

/**
 * Collects the drawing's shape and gradient settings, so two drawings can
 * be compared. The gradient names (made by useId) differ between renders,
 * so they're left out.
 *
 * @returns a list of [shape type, its settings] pairs, from the rendered picture.
 */
function drawnShapes() {
  const art = screen.getByTestId('art', { includeHiddenElements: true });
  const out: [string, Record<string, unknown>][] = [];
  /** Walks the tree, copying each SVG part's props minus names and children. */
  function walk(node: { type: unknown; props: Record<string, unknown>; children: unknown[] }) {
    if (typeof node.type === 'string' && node.type.startsWith('RNSVG')) {
      const { children: _children, name: _name, fill: _fill, ...rest } = node.props;
      out.push([node.type, rest]);
    }
    for (const child of node.children ?? []) {
      if (child && typeof child === 'object') walk(child as typeof node);
    }
  }
  walk(art as unknown as Parameters<typeof walk>[0]);
  return out;
}

describe('<GeneratedArt> (the drawing)', () => {
  it('draws the same picture for the same id, and a different one for another id', async () => {
    const { unmount } = await render(<GeneratedArt seed={IDS[0]} height={170} testID="art" />);
    const first = drawnShapes();
    await unmount();
    await render(<GeneratedArt seed={IDS[0]} height={170} testID="art" />);
    const again = drawnShapes();
    expect(again).toEqual(first);
    await screen.unmount();
    await render(<GeneratedArt seed={IDS[1]} height={170} testID="art" />);
    expect(drawnShapes()).not.toEqual(first);
  });

  it('uses only gold and near-black, and is hidden from screen readers', async () => {
    await render(<GeneratedArt seed={IDS[2]} height={170} testID="art" />);
    const art = screen.getByTestId('art', { includeHiddenElements: true });
    expect(art.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(art.props.accessibilityElementsHidden).toBe(true);

    // Every colour in the drawing: plain fills arrive as { payload: number },
    // gradients as [offset, colour, offset, colour, ...] (see lessons).
    const allowed = [processColor(colors.accent), processColor(colors.surface)].map(
      (c) => (c as number) & 0xffffff, // compare the colour, not its strength
    );
    const seen: number[] = [];
    /** Walks the tree, collecting every fill and gradient colour. */
    // Only the shapes we draw: the Svg root and its group carry the
    // library's default black fill, which nothing inherits (every shape
    // sets its own fill).
    const SHAPES = ['RNSVGRect', 'RNSVGEllipse', 'RNSVGPath'];
    function walk(node: { type: unknown; props: Record<string, unknown>; children: unknown[] }) {
      const fill = node.props.fill as { payload?: unknown } | undefined;
      if (SHAPES.includes(node.type as string) && fill && typeof fill.payload === 'number') {
        seen.push(fill.payload);
      }
      const gradient = node.props.gradient as number[] | undefined;
      if (Array.isArray(gradient)) {
        for (let i = 1; i < gradient.length; i += 2) seen.push(gradient[i]);
      }
      for (const child of node.children ?? []) {
        if (child && typeof child === 'object') walk(child as typeof node);
      }
    }
    walk(art as unknown as Parameters<typeof walk>[0]);
    expect(seen.length).toBeGreaterThan(0);
    for (const colour of seen) expect(allowed).toContain(colour & 0xffffff);
  });

  it('fills its parent when no height is given (the sign-in hero)', async () => {
    await render(<GeneratedArt seed={SIGN_IN_ART_SEED} testID="art" />);
    const style = screen.getByTestId('art', { includeHiddenElements: true }).props.style;
    expect(style).toMatchObject({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 });
  });
});
