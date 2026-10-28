/**
 * The app's one icon component (Q4 "launch look", spec section 3).
 *
 * Why it exists: before Q4 the app drew icons with text characters ("‹",
 * "!", a tick, a diamond). Those look different on every phone and font.
 * The v3 design uses thin line icons instead, so this file draws the 15
 * icons the app needs with react-native-svg (already installed, so no new
 * package).
 *
 * How to use it:
 *   <Icon name="chevron-left" />                      // 20 px, main text colour
 *   <Icon name="alert" size={iconSize.sm} color={colors.error} />
 *
 * Icons are ALWAYS decoration: screen readers skip them, because the button
 * or sentence next to the icon already says what it means (for example the
 * back button is read as "Back"). Never put meaning in an icon alone.
 *
 * Every icon is drawn on a 24 x 24 grid with round line ends and corners.
 * The tiny "dots" (in alert and info) are 0.01 px lines that only show up
 * BECAUSE the line ends are round, so keep strokeLinecap="round".
 */
import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors, iconSize, iconStroke } from '@/theme';

/**
 * One shape inside an icon: a path (lines and curves), a circle or a
 * rounded rectangle. The numbers are on the 24 x 24 grid.
 */
type Shape =
  | { kind: 'path'; d: string }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number };

/** Short helpers so the icon table below stays readable. */
const path = (d: string): Shape => ({ kind: 'path', d });
const circle = (cx: number, cy: number, r: number): Shape => ({ kind: 'circle', cx, cy, r });

/**
 * Every icon's shapes, copied from the Q4 spec's icon table (which took
 * most of them from the v3 design boards). Because this is one typed table,
 * `<Icon name="chevron-lft" />` (a typo) fails the type-check.
 */
const ICONS = {
  /** Back buttons. */
  'chevron-left': [path('M15 18l-6-6 6-6')],
  /** "Opens another screen" on list rows. */
  'chevron-right': [path('M9 6l6 6-6 6')],
  /** Close a sheet or screen. */
  close: [path('M6 6l12 12M18 6L6 18')],
  /** Share an event. */
  share: [path('M12 3v12M7 8l5-5 5 5M5 14v6h14v-6')],
  /** Error messages (a ring with "!"). */
  alert: [circle(12, 12, 9), path('M12 7.5v5.5M12 16.5h.01')],
  /** Success messages and picked chips. */
  check: [path('M5 12.5l4.5 4.5L19 7.5')],
  /** Information (a ring with "i"), e.g. the Blocked screen. */
  info: [circle(12, 12, 9), path('M12 11v5.5M12 7.5h.01')],
  /** A map pin: the check-in privacy panel. */
  pin: [path('M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z'), circle(12, 10, 2.5)],
  /** Privacy notes. */
  shield: [path('M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z')],
  /** The Tonight tab. */
  moon: [path('M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z')],
  /** The Me tab. */
  person: [circle(12, 8, 4), path('M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6')],
  /** Settings. */
  gear: [
    circle(12, 12, 3),
    path('M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1'),
  ],
  /** The Admin tab. */
  clipboard: [
    { kind: 'rect', x: 5, y: 4, width: 14, height: 17, rx: 2.5 },
    path('M9 3h6v3H9zM9 11h6M9 15h4'),
  ],
  /** "New event" on the Admin hub. */
  'plus-circle': [circle(12, 12, 9), path('M12 8v8M8 12h8')],
  /** "Reports" on the Admin hub. */
  flag: [path('M5 21V4M5 4h11l-2 4 2 4H5')],
} satisfies Record<string, Shape[]>;

/** The name of one of the 15 icons, e.g. 'chevron-left'. */
export type IconName = keyof typeof ICONS;

/** Every icon name, in table order (used by tests to draw them all). */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/** What an Icon needs. */
export interface IconProps {
  /** Which icon to draw. */
  name: IconName;
  /** Width and height in pixels. Default 20 (`iconSize.md`). */
  size?: number;
  /** Line colour, always a theme colour. Default: the main text colour. */
  color?: ColorValue;
  /** Optional id for tests. */
  testID?: string;
}

/**
 * Draws one line icon.
 *
 * @param props.name - which icon (see the table above).
 * @param props.size - pixels; default 20.
 * @param props.color - line colour; default `colors.text`.
 * @returns the icon, hidden from screen readers.
 */
export function Icon({ name, size = iconSize.md, color = colors.text, testID }: IconProps) {
  // 16 px icons get a slightly thicker line so they don't look faint.
  const strokeWidth = size <= iconSize.sm ? iconStroke.small : iconStroke.regular;
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decoration only: iPhone (accessibilityElementsHidden) and Android
      // (importantForAccessibility) screen readers both skip it.
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {ICONS[name].map((shape: Shape, i) => {
        if (shape.kind === 'path') return <Path key={i} d={shape.d} />;
        if (shape.kind === 'circle')
          return <Circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} />;
        return (
          <Rect
            key={i}
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
            rx={shape.rx}
          />
        );
      })}
    </Svg>
  );
}
