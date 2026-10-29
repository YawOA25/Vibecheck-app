/**
 * The "glass" look shared by everything that floats on the Tonight map
 * (VC-85 step 1, design/vc85-map-brand-spec.md "Chrome"): the top bar, the
 * round buttons, the tags, the count bubbles and the bottom card. Also the
 * map's calm edge fade (the vignette) and the map's motion timings.
 *
 * Why one file: the spec's "sleek" feel comes from every floating piece
 * using the SAME fill, hairline edge and easing. Keeping the numbers here
 * means a later tweak (or Tier 2's custom base map) changes them once.
 *
 * About the "glass": real frosted glass needs a blur package (expo-blur),
 * which this app doesn't have, and step 1 must not add native packages
 * (it has to keep working in Expo Go). So the glass is faked with a dark
 * fill that is only slightly see-through, plus a 1 px light hairline. The
 * spec's own no-blur fallback is 92% fill; we use a little less (88%) so a
 * hint of the map still shows, while road names behind a tag can't make its
 * text hard to read.
 */
import { Easing, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { rgba } from '@/components/AreaHeat';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { colors, minTapTarget, motion } from '@/theme';

/** How see-through the glass is: 0.88 = 88% solid (see the note above). */
export const GLASS_ALPHA = 0.88;

/** The shared glass colours (all built from v3 theme tokens). */
export const glass = {
  /** The fill: the v3 surface colour, slightly see-through. */
  fill: rgba(colors.surface, GLASS_ALPHA),
  /** The 1 px hairline round the edge: the text colour at 8%. */
  hairline: rgba(colors.text, 0.08),
  /** The tags' slightly stronger hairline (spec: 9%). */
  tagHairline: rgba(colors.text, 0.09),
  /** The bottom card's gold hairline (spec: gold at 22%). */
  goldHairline: rgba(colors.accent, 0.22),
} as const;

/**
 * The map's easing curve: a quick start that settles softly, with no
 * bounce (the spec's cubic-bezier(.22, 1, .36, 1)). Used for the card's
 * slide. (Apple Maps moves its camera with its own curve; we can only set
 * how long the camera takes.)
 */
export const MAP_EASE = Easing.bezier(0.22, 1, 0.36, 1);

/** A round glass button's size (spec: 40). */
export const GLASS_BUTTON_SIZE = 40;

/**
 * Extra touch area round a 40 px button so the finger target is still
 * 44 px (the app's smallest tap size): 2 px on every side.
 */
const BUTTON_SLOP = (minTapTarget - GLASS_BUTTON_SIZE) / 2;

/** What a GlassCircleButton needs. */
export interface GlassCircleButtonProps {
  /** The line icon in the middle. */
  icon: IconName;
  /** What screen readers say (the icon alone says nothing to them). */
  label: string;
  onPress: () => void;
  /** Icon colour: gold for "locate" (spec), the text colour otherwise. */
  iconColour?: string;
  /** false under Reduce Motion: no shrink while pressed. */
  animate?: boolean;
  /** For a button that opens something (the menu): whether it is open now. */
  expanded?: boolean;
  testID?: string;
}

/**
 * A round 40 px glass button floating on the map (the menu button and
 * "Show my location").
 *
 * @returns a pressable circle whose touch area is 44 px (hit slop).
 */
export function GlassCircleButton({
  icon,
  label,
  onPress,
  iconColour = colors.text,
  animate,
  expanded,
  testID,
}: GlassCircleButtonProps) {
  return (
    <PressableScale
      scaleTo={motion.pressScale.circle}
      animate={animate}
      onPress={onPress}
      hitSlop={BUTTON_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      testID={testID}
      style={({ pressed }) => [styles.circle, pressed && styles.pressed]}
    >
      {/* Decoration only; the label above is what screen readers say. */}
      <Icon name={icon} size={18} color={iconColour} />
    </PressableScale>
  );
}

/**
 * The map's calm edges (spec "Edge fade"): a soft dark ring round the edge
 * (the vignette) plus a fade at the top and bottom, so the eye goes to the
 * middle and the grey Apple map blends into the dark screen.
 *
 * It is a picture only: it never takes touches (pointerEvents "none", so
 * the map underneath still pans and its tags still open) and screen
 * readers skip it. It draws with react-native-svg, which Expo Go already
 * has.
 *
 * How the shapes are set up: the drawing's box is stretched to the map's
 * size ("preserveAspectRatio none"), so a round gradient becomes an oval
 * that follows the screen's shape, like the mock's CSS radial gradient
 * (120% wide, 90% tall, centred just above the middle).
 *
 * @returns a full-size overlay for the map.
 */
export function MapVignette() {
  const bg = colors.bg;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="map-vignette"
    >
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          {/* Clear in the middle 52%, then darker towards the corners. */}
          <RadialGradient
            id="vcVignette"
            cx="50"
            cy="46"
            rx="60"
            ry="45"
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0.52" stopColor={bg} stopOpacity={0} />
            <Stop offset="0.82" stopColor={bg} stopOpacity={0.55} />
            <Stop offset="1" stopColor={bg} stopOpacity={0.92} />
          </RadialGradient>
          {/* 85% dark at the very top and bottom, clear by 22% in (top)
              and in the lowest 30% it darkens again (bottom). */}
          <LinearGradient id="vcEdgeFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={bg} stopOpacity={0.85} />
            <Stop offset="0.22" stopColor={bg} stopOpacity={0} />
            <Stop offset="0.7" stopColor={bg} stopOpacity={0} />
            <Stop offset="1" stopColor={bg} stopOpacity={0.85} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#vcVignette)" />
        <Rect x="0" y="0" width="100" height="100" fill="url(#vcEdgeFade)" />
      </Svg>
    </View>
  );
}

/** Styles built only from theme tokens and the glass colours above. */
const styles = StyleSheet.create({
  circle: {
    width: GLASS_BUTTON_SIZE,
    height: GLASS_BUTTON_SIZE,
    borderRadius: GLASS_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: glass.fill,
    borderWidth: 1,
    borderColor: glass.hairline,
  },
  // A finger on the button lightens the fill one step, as on cards.
  pressed: { backgroundColor: colors.surfaceRaised },
});
