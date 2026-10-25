/**
 * Smoke test: the simplest possible check that the test setup works.
 *
 * "Smoke test" comes from electronics: switch it on and see if smoke comes out.
 * If this file fails, the problem is the test tooling (Jest, the '@/' import
 * shortcut), not the app. It also guards the theme tokens against accidental
 * edits, because every screen depends on them.
 */
import { colors, minTapTarget } from '@/theme';

describe('smoke test', () => {
  it('runs Jest', () => {
    expect(1 + 1).toBe(2);
  });

  it('loads the theme with the colors from the design (wireframes v1)', () => {
    expect(colors).toEqual({
      bg: '#0F0B1A',
      surface: '#1C1630',
      text: '#F5F2FF',
      muted: '#A9A1C4',
      accent: '#FF4D6D',
      onAccent: '#0F0B1A',
    });
    expect(minTapTarget).toBe(48);
  });
});
