/**
 * VibeCheck's dark theme: the colors, spacing, corner sizes and text styles
 * from the design (team/projects/vibecheck/design/wireframes-v1.md, section 4).
 *
 * Why this file exists: every screen imports its look from here instead of
 * typing hex codes by hand. If the designer changes a color, we change it in
 * one place and the whole app follows.
 *
 * `as const` tells TypeScript these values never change, so it can catch
 * typos like `colors.backgorund` at compile time.
 */

/** Color tokens. Contrast ratios are from the design doc and meet accessibility guidelines. */
export const colors = {
  /** App background. */
  bg: '#0F0B1A',
  /** Cards and bottom sheets, one step lighter than the background. */
  surface: '#1C1630',
  /** Primary text (16:1 contrast on bg). */
  text: '#F5F2FF',
  /** Secondary text (6.5:1 on bg). Keep it at 14 px or larger to stay readable. */
  muted: '#A9A1C4',
  /** Flame icon and primary buttons. */
  accent: '#FF4D6D',
  /** Text placed on top of accent (6:1). It's the same dark color as bg, on purpose. */
  onAccent: '#0F0B1A',
} as const;

/** Spacing steps in pixels. Use these for padding and gaps so the layout stays even. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  /** Space between screen content and the screen edge. */
  gutter: 16,
} as const;

/** Corner rounding in pixels. */
export const radius = {
  card: 16,
  chip: 12,
} as const;

/** Smallest size a tappable thing may be (48 px), so it's easy to hit with a thumb. */
export const minTapTarget = 48;

/**
 * Text styles: font size, line height and weight. We use the phone's system
 * font, which also grows with the user's text-size setting.
 */
export const typography = {
  display: { fontSize: 32, lineHeight: 36, fontWeight: '700' },
  /** The big vibe score number on the vibe meter. */
  score: { fontSize: 48, lineHeight: 52, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  /** Smallest allowed text size in the app. */
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
} as const;
