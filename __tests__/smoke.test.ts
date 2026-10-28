/**
 * Smoke test: the simplest possible check that the test setup works.
 *
 * "Smoke test" comes from electronics: switch it on and see if smoke comes out.
 * If this file fails, the problem is the test tooling (Jest, the '@/' import
 * shortcut), not the app. It also guards the theme tokens against accidental
 * edits, because every screen depends on them.
 */
import { fontFiles } from '@/lib/fonts';
import { colors, minTapTarget, typography } from '@/theme';

describe('smoke test', () => {
  it('runs Jest', () => {
    expect(1 + 1).toBe(2);
  });

  it('loads the theme with the v3 colours, plus the designer accessibility fixes', () => {
    expect(colors).toEqual({
      bg: '#0A0A0C',
      surface: '#141417',
      surfaceRaised: '#1B1B20',
      border: '#24242A',
      borderStrong: '#2B2B31',
      fieldBorder: '#6B6B73',
      goldBorder: '#5A4C30',
      text: '#F3EFE6',
      muted: '#A19C92',
      accent: '#D6B97B',
      onAccent: '#16130D',
      accentHover: '#E8D3A4',
      accentPressed: '#BFA365',
      disabledBg: '#2B2B31',
      disabledText: '#8A8A92',
      error: '#FF8A7A',
      success: '#7FD6A0',
      scrim: 'rgba(0, 0, 0, 0.6)',
      // Q4 "launch look" tokens (audit fix #10 and the VC-71 mark).
      surfaceSunken: '#0E0E11',
      divider: '#1F1F24',
      handle: '#3A3A42',
      accentTint: '#1D1A14',
      markTrack: '#2B2B31',
    });
    // Nothing tappable may be smaller than 44 px (spec section 1).
    expect(minTapTarget).toBe(44);
  });

  it('gives every text style one of the loaded font files', () => {
    // Every font name a text style uses must be one the app loads, or that
    // text would silently fall back to the phone's own font.
    const loaded = Object.keys(fontFiles);
    for (const style of Object.values(typography)) {
      expect(loaded).toContain(style.fontFamily);
    }
  });
});
