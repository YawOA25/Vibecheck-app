/**
 * Skeleton loading blocks (Q6, polish audit fix #8).
 *
 * What a skeleton is: while a screen waits for its data, instead of a
 * spinning wheel it shows plain grey shapes roughly where the content will
 * appear (cards, a heading). The page feels faster because its layout is
 * already there, and nothing jumps around when the data lands.
 *
 * Look (v3 Check-in backdrop): flat blocks in surfaceRaised (#1B1B20),
 * radius 6 for text lines and 20 for cards.
 *
 * Motion: the blocks gently "breathe": their opacity goes from full to 50%
 * and back every 1.2 seconds. Under the phone's Reduce Motion setting
 * (and until the phone has answered) they stay still.
 *
 * Accessibility: the whole skeleton is ONE item for screen readers, named
 * by `label` (e.g. "Loading events"), so they hear what's happening instead
 * of a list of empty shapes. It is also marked busy (accessibilityState
 * busy, Q8a), the standard way to tell a screen reader "still loading".
 *
 * VC-76 (design/vc76-motion-spec.md 2c "Reserve heights"): the event page's
 * skeleton is sized like the real page (heading lines at the real text
 * heights, the gauge card and the heads-up card at their usual ready
 * heights), and SkeletonBlock and SkeletonGroup are shared so cards can
 * hold the space of parts that are still loading (the vibe lines and
 * tiles, the heads-up chips). Then nothing jumps when the data lands.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { DimensionValue, StyleProp, ViewStyle } from 'react-native';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { motionAllowed, useReduceMotion } from '@/lib/reduce-motion';
import { colors, radius, spacing, typography } from '@/theme';

/** One full breath (dim then back), in milliseconds. */
export const PULSE_MS = 1200;
/** How far the blocks dim at the middle of a breath. */
export const PULSE_MIN_OPACITY = 0.5;
/** Corner rounding for text-line blocks (v3: 6). Cards use radius.card (20). */
export const LINE_RADIUS = 6;

/**
 * The event page's ready card heights, for its skeleton (VC-76, spec 2c).
 * Worked out from the cards' own styles (padding, text line heights, the
 * 200 x 104 gauge, the 60 px tiles, the 44 px chips), so the skeleton and
 * the page line up. The spec asks for a check on an iPhone 15: see the
 * README's device checklist.
 *   gauge card: 14 top + 42 header + 140 gauge and word + 18 line + 70
 *     tiles + 21 headcount + 16 bottom, plus the gaps = about 330;
 *   heads-up card: 16 + 16 label + 44 chip row + 18 hint + 44 info link +
 *     16, plus the gaps = about 180.
 */
export const GAUGE_CARD_HEIGHT = 330;
export const HEADS_UP_CARD_HEIGHT = 180;

/**
 * Makes the shared opacity value that all blocks of one skeleton follow,
 * and runs the 1.2 s pulse while motion is allowed.
 *
 * @returns the Animated opacity (stays at 1 under Reduce Motion).
 */
function usePulse(): Animated.Value {
  const reduce = useReduceMotion();
  // Kept in state (not a ref) so it's made once and the lint rules allow it.
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!motionAllowed(reduce)) {
      // Reduce Motion on (or not known yet): hold still at full opacity.
      opacity.setValue(1);
      return undefined;
    }
    // Half the breath down, half back up, repeated until the skeleton goes.
    const half = PULSE_MS / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: PULSE_MIN_OPACITY,
          duration: half,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: half,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, opacity]);
  return opacity;
}

/** What one SkeletonBlock needs. */
interface BlockProps {
  /** Height in pixels. */
  height: number;
  /** Width (pixels or a percentage like '60%'); full width by default. */
  width?: DimensionValue;
  /** Corner rounding: LINE_RADIUS for text lines, radius.card for cards. */
  corner?: number;
}

/**
 * One grey block.
 *
 * @returns a plain view in surfaceRaised.
 */
export function SkeletonBlock({ height, width = '100%', corner = LINE_RADIUS }: BlockProps) {
  return (
    <View testID="skeleton-block" style={[styles.block, { height, width, borderRadius: corner }]} />
  );
}

/** What a SkeletonGroup needs. */
interface GroupProps {
  /** The blocks inside. */
  children: ReactNode;
  /** Layout for the group (e.g. a row of chips). */
  style?: StyleProp<ViewStyle>;
  /** Optional id for tests. */
  testID?: string;
}

/**
 * A few blocks that pulse together, used INSIDE a card that is still
 * loading (VC-76): it only holds the space, so screen readers skip it (the
 * card says "Loading" in its own words).
 *
 * @returns the pulsing (or still, under Reduce Motion) group.
 */
export function SkeletonGroup({ children, style, testID }: GroupProps) {
  const opacity = usePulse();
  return (
    <Animated.View
      testID={testID}
      style={[style, { opacity }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {children}
    </Animated.View>
  );
}

/** What a skeleton screen part needs. */
interface SkeletonProps {
  /** What screen readers hear, e.g. "Loading events". */
  label: string;
}

/**
 * The home list's skeleton: three card-shaped blocks, sized like an event
 * card, 14 px apart (the list's own gap).
 *
 * @param props.label - what screen readers hear.
 * @returns the pulsing (or still) skeleton.
 */
export function ListSkeleton({ label }: SkeletonProps) {
  const opacity = usePulse();
  return (
    <Animated.View
      testID="list-skeleton"
      style={[styles.list, { opacity }]}
      accessible
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      // Q8a: tells screen readers this part is still loading.
      accessibilityState={{ busy: true }}
    >
      {[0, 1, 2].map((i) => (
        <SkeletonBlock key={i} height={104} corner={radius.card} />
      ))}
    </Animated.View>
  );
}

/**
 * The event page's skeleton: a heading (kicker line, title line, area
 * line, at the real text heights) and two card blocks below it, sized like
 * the gauge card and the heads-up card (VC-76).
 *
 * @param props.label - what screen readers hear.
 * @returns the pulsing (or still) skeleton.
 */
export function EventSkeleton({ label }: SkeletonProps) {
  const opacity = usePulse();
  return (
    <Animated.View
      testID="event-skeleton"
      style={[styles.page, { opacity }]}
      accessible
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      // Q8a: tells screen readers this part is still loading.
      accessibilityState={{ busy: true }}
    >
      <View style={styles.heading}>
        {/* Same heights as the kicker, title and area lines. */}
        <SkeletonBlock height={typography.label.lineHeight} width="35%" />
        <SkeletonBlock height={typography.title.lineHeight} width="80%" />
        <SkeletonBlock height={typography.bodySm.lineHeight} width="50%" />
      </View>
      <SkeletonBlock height={GAUGE_CARD_HEIGHT} corner={radius.card} />
      <SkeletonBlock height={HEADS_UP_CARD_HEIGHT} corner={radius.card} />
    </Animated.View>
  );
}

/** Styles built only from theme tokens (and the card sizes above). */
const styles = StyleSheet.create({
  block: { backgroundColor: colors.surfaceRaised },
  // Same side gutter and top spacing as the real list, 14 px between cards.
  list: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md, gap: 14 },
  // Same padding and 24 px section gap as the event page's content.
  page: { padding: spacing.gutter, gap: spacing.lg },
  // The real heading's 4 px gap between its lines.
  heading: { gap: spacing.xs },
});
