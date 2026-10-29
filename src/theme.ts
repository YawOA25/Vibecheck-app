/**
 * VibeCheck's look: colours, fonts, text styles, spacing and corner sizes.
 *
 * Source: the v3 design ("After Dark, Turned Up"), adopted by the founder on
 * 2026-10-26. The values come from team/projects/vibecheck/design/v3-ui-spec.md,
 * section 1, including the designer's accessibility fixes (a stronger field
 * border, error and success colours, and a pressed colour for buttons).
 *
 * Why this file exists: every screen imports its look from here instead of
 * typing hex codes by hand. If the designer changes a colour, we change it in
 * one place and the whole app follows.
 *
 * `as const` tells TypeScript these values never change, so it can catch
 * typos like `colors.backgorund` at compile time.
 */
import { Easing } from 'react-native';

/**
 * Colour tokens. The numbers in the notes are contrast ratios (how readable
 * one colour is on another). Readable text needs 4.5 or more; edges of
 * fields and buttons need 3 or more.
 */
export const colors = {
  /** Screen background: near-black. */
  bg: '#0A0A0C',
  /** Hero block, cards and text boxes: one step lighter than the background. */
  surface: '#141417',
  /** Photo placeholders and tiles: one more step lighter. */
  surfaceRaised: '#1B1B20',
  /** Card and divider lines. Decorative only (1.3), never the only sign of anything. */
  border: '#24242A',
  /** v3's own field edge. Too faint for inputs (1.4), so decorative only. */
  borderStrong: '#2B2B31',
  /** Edge of text boxes, code boxes and outline buttons (3.7 on bg). Designer fix. */
  fieldBorder: '#6B6B73',
  /** Edge of a featured card. Decorative only. */
  goldBorder: '#5A4C30',
  /** Main text: warm off-white (17.2 on bg). */
  text: '#F3EFE6',
  /** Secondary text, field labels and placeholders (7.2 on bg). */
  muted: '#A19C92',
  /** Gold: buttons, links, highlights and the focus ring (10.4 on bg). */
  accent: '#D6B97B',
  /** Text placed on gold (9.8). */
  onAccent: '#16130D',
  /** Gold under a mouse pointer (web only). */
  accentHover: '#E8D3A4',
  /** Gold while a finger is pressing a button. Designer fix. */
  accentPressed: '#BFA365',
  /** Background of a button that can't be tapped yet. */
  disabledBg: '#2B2B31',
  /** Text of a button that can't be tapped yet (5.4 on disabledBg). */
  disabledText: '#8A8A92',
  /** Error text, error field edge and error icon (8.6 on bg). Always paired with an icon and a sentence. */
  error: '#FF8A7A',
  /** "New code sent" confirmation (11.3 on bg). */
  success: '#7FD6A0',
  /** Dimmed layer behind a bottom sheet (the Custom dates picker, VC-63b). */
  scrim: 'rgba(0, 0, 0, 0.6)',
  /** Recessed panels, e.g. the check-in pin panel (Q4). Decorative only. */
  surfaceSunken: '#0E0E11',
  /** Thin edge lines: the tab bar's top edge, the event page's bottom bar (Q4). Decorative (1.2). */
  divider: '#1F1F24',
  /** The grab handle on a bottom sheet (Q4). Decorative only. */
  handle: '#3A3A42',
  /** Dark gold-tinted fill of a picked multi-select chip (Q4). Gold text on it reads 9.0. */
  accentTint: '#1D1A14',
  /** Unfilled track of the app mark (Q4, VC-71). Same value as borderStrong. Decorative. */
  markTrack: '#2B2B31',
} as const;

/**
 * Font names. Each weight is its own font file, because Android can't make a
 * regular font bold by itself. These names must match the keys loaded in
 * src/lib/fonts.ts. If the fonts fail to load, the phone uses its own font.
 */
export const fonts = {
  /** Bricolage Grotesque, extra bold: headlines and numbers. */
  display: 'BricolageGrotesque_800ExtraBold',
  /** Bricolage Grotesque, semi bold: card names (later screens). */
  displaySemi: 'BricolageGrotesque_600SemiBold',
  /** Manrope, regular: paragraphs. */
  body: 'Manrope_400Regular',
  /** Manrope, medium: small notes and typed text. */
  bodyMedium: 'Manrope_500Medium',
  /** Manrope, semi bold: emphasised words inside a paragraph. */
  bodySemi: 'Manrope_600SemiBold',
  /** Manrope, bold: labels and buttons. */
  bodyBold: 'Manrope_700Bold',
} as const;

/** Spacing steps in pixels. Use these for padding and gaps so the layout stays even. */
export const spacing = {
  xs: 4,
  sm: 8,
  /** Small gap between a button and the note under it (v3 Rate footer: 10). */
  gap10: 10,
  /** Gap between parts of a form (v3 uses 12 to 14). */
  gap12: 12,
  md: 16,
  lg: 24,
  xl: 32,
  /** Space between list content and the screen edge. */
  gutter: 16,
  /** Side padding of v3 sheets and the Rate screen (20). */
  sheetGutter: 20,
  /** Space between sign-in screens' content and the screen edge (v3 uses 24). */
  authGutter: 24,
} as const;

/** Corner rounding in pixels. */
export const radius = {
  /** Text boxes. */
  field: 14,
  /** Each of the code boxes (one per digit). */
  codeBox: 14,
  /** Cards. */
  card: 20,
  /** Small chips. */
  chip: 12,
  /** Fully round ends: buttons and pills. */
  pill: 999,
} as const;

/**
 * Line icon sizes in pixels (Q4 icon set, src/components/Icon.tsx):
 * 16 next to text, 20 inside 44 px round buttons and rows, 22 in the tab
 * bar, 28 inside 56 px round "feature" circles.
 */
export const iconSize = { sm: 16, md: 20, tab: 22, lg: 28 } as const;

/**
 * Line thickness of the icons. Small 16 px icons use a slightly thicker
 * line (`small`) so they don't look faint next to text.
 */
export const iconStroke = { regular: 1.5, small: 1.75 } as const;

/**
 * The bottom bar's measurements (VC-82, design/vc82-bottom-bar-spec.md
 * section 2; replaced the Q4 full-width bar). A floating pill:
 *   - 16 px from each side, 12 px above the phone's home-bar space;
 *   - at least 64 tall (it grows a little with very large text);
 *   - 3 px between icon and label;
 *   - a 16 x 3 gold bar under the open tab's label, 7 px from the bottom;
 *   - admins: a 56 px gold plus in a 76 px middle slot, wrapped in a 6 px
 *     ring of the page colour, its circle sitting 14 px above the pill.
 */
export const tabBar = {
  sideMargin: 16,
  bottomMargin: 12,
  pillHeight: 64,
  iconLabelGap: 3,
  indicator: { width: 16, height: 3, bottom: 7 },
  plusSize: 56,
  plusRing: 6,
  plusRaise: 14,
  plusSlotWidth: 76,
} as const;

/** Smallest size a tappable thing may be (44 px), so it's easy to hit with a thumb. */
export const minTapTarget = 44;

/** Height of a full-size button (v3: 17 px padding top and bottom plus a 20 px line). */
export const buttonHeight = 54;

/** Height of a text box (v3: 15 px padding top and bottom plus a 22 px line). */
export const fieldHeight = 52;

/**
 * Text styles: font, size, line height and letter spacing, from the spec's
 * text-style table. Text still grows with the phone's text-size setting.
 */
export const typography = {
  /** Sign-in headline. */
  hero: { fontFamily: fonts.display, fontSize: 38, lineHeight: 46, letterSpacing: -1 },
  /** Titles on the code, age-gate and sorry screens. */
  h1: { fontFamily: fonts.display, fontSize: 36, lineHeight: 44, letterSpacing: -1 },
  /** Tonight header. */
  title: { fontFamily: fonts.display, fontSize: 32, lineHeight: 36, letterSpacing: -0.6 },
  /** Card names (later screens). */
  cardTitle: { fontFamily: fonts.displaySemi, fontSize: 22, lineHeight: 24, letterSpacing: -0.6 },
  /** Paragraphs. */
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  /** Helper text and links. */
  bodySm: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21 },
  /** Small notes. Smallest size for sentences in the app. */
  caption: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18 },
  /** Field labels, written in capitals (12 px, not v3's 11, for readability). */
  label: { fontFamily: fonts.bodyBold, fontSize: 12, lineHeight: 16, letterSpacing: 1.4 },
  /** Text typed into a field. */
  input: { fontFamily: fonts.bodyMedium, fontSize: 16, lineHeight: 22 },
  /** Button labels. */
  button: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 20, letterSpacing: 0.3 },
  /** Each digit in the code boxes. */
  codeDigit: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32 },
} as const;

/**
 * The most a headline may grow with the phone's text-size setting (1.3 times),
 * so the hero headline still fits on screen. Other text grows without a cap.
 */
export const headlineMaxScale = 1.3;

/**
 * Motion tokens (VC-76, design/vc76-motion-spec.md "Shared tokens").
 *
 * Why they live here: every fade, press and slide in the app uses the same
 * few speeds and curves, so the app feels like one thing. Change a number
 * here and every screen follows.
 *
 * Easing curves say how a movement speeds up or slows down. "out" curves
 * start fast and settle gently (good for things arriving); "in" curves start
 * slow and leave fast (good for things going away).
 */
export const motion = {
  /** Press in and out, chip state changes: 120 ms. */
  fast: { duration: 120, easing: Easing.out(Easing.quad) },
  /** Content fading in, the switch thumb: 200 ms. */
  base: { duration: 200, easing: Easing.out(Easing.cubic) },
  /** The check-in sheet: 280 ms up, 220 ms down. */
  sheetIn: { duration: 280, easing: Easing.out(Easing.cubic) },
  sheetOut: { duration: 220, easing: Easing.in(Easing.cubic) },
  /** The tab cross-fade (founder's choice, see app/(tabs)/_layout.tsx): 150 ms. */
  tabFade: 150,
  /** The sign-in screens' fade (sign-in, age gate, sorry, and the tabs group): 200 ms. */
  authFade: 200,
  /**
   * Under Reduce Motion, fades are still allowed (nothing moves) but get
   * shorter: 100 ms (spec section 4).
   */
  reducedFade: 100,
  /** Show a loading spinner only if loading takes longer than this (300 ms). */
  spinnerDelay: 300,
  /** How small things get while pressed (1 = normal size). */
  pressScale: { row: 0.97, card: 0.98, button: 0.98, circle: 0.96 },
  /** The release "spring" back to full size: quick, with no wobble. */
  releaseSpring: { speed: 40, bounciness: 0 },
  /** How see-through a text link gets while pressed. */
  linkPressedOpacity: 0.6,
} as const;
