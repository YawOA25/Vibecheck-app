/**
 * The bottom bar (VC-82, design/vc82-bottom-bar-spec.md; founder approved
 * the mock 2026-10-29). It replaced the Q4 full-width bar.
 *
 * What people see:
 *   - everyone: a floating pill with two tabs, HOME and ME;
 *   - admins only: a raised gold plus in the middle (Home | + | Me) that
 *     opens the New event form. A normal guest gets no plus at all (not a
 *     greyed one), because guest "Add event" is not approved.
 *
 * Why a custom bar instead of the built-in one: the design marks the open
 * tab twice, with gold colour AND a small 16 x 3 gold bar under its label,
 * so the state isn't shown by colour alone. That bar slides to the new tab
 * in 200 ms. app/(tabs)/_layout.tsx hands this bar to expo-router through
 * the `tabBar` option, and passes `onAddEvent` only for admins.
 *
 * The plus is not a tab: it never becomes "selected", and screen readers
 * call it "Add event, button" (hint: "Opens the new event form"). So the
 * tabs still count "1 of 2" and "2 of 2". The New event screen it opens is
 * still locked to admins in the root layout and on the server, so hiding
 * the plus is only about what people see, not about security.
 *
 * Motion: the gold bar slides in 200 ms; the plus gives a light vibration,
 * shrinks to 0.94 while pressed and turns 90 degrees and back (180 ms).
 * Under the phone's Reduce Motion nothing slides, shrinks or turns: the
 * gold bar jumps straight to the new tab.
 *
 * Accessibility (Q4 spec 2.6, unchanged): the row is a "tablist", each tab
 * a "tab" with "selected" on the open one, read as "Home" and "Me" (not the
 * capitals shown). Icons are hidden from screen readers. Labels grow with
 * the phone's text size up to 1.3 times, then stop; the pill grows a
 * little with them instead of cutting them off.
 */
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { tapLight } from '@/lib/haptics';
import { motionAllowed, reduceMotionNow, useReduceMotion } from '@/lib/reduce-motion';
import { colors, fonts, iconSize, motion, tabBar } from '@/theme';

/** The most the tab labels may grow with the phone's text-size setting. */
const LABEL_MAX_SCALE = 1.3;

/** How small the plus gets while pressed (spec section 2). */
const PLUS_PRESS_SCALE = 0.94;

/** The plus icon: 24 px with a 2.5 px line, so it reads well on gold. */
const PLUS_ICON = { size: 24, stroke: 2.5 } as const;

/** The plus's quarter turn: 90 ms there and 90 ms back (180 ms in all). */
const PLUS_TURN_HALF_MS = 90;

/**
 * How far the plus's outer edge (its page-coloured ring) rises above the
 * pill: the circle sits 14 px above it, and the 6 px ring adds to that.
 */
const PLUS_OVERHANG = tabBar.plusRaise + tabBar.plusRing;

/** What the bar takes: expo-router's usual tab-bar props, plus our own. */
export interface TabBarProps extends BottomTabBarProps {
  /**
   * Opens the New event form. Passed ONLY for admins; when it is missing,
   * the bar draws no plus (guests see two tabs).
   */
  onAddEvent?: () => void;
}

/**
 * Where the plus goes among the tabs: in the middle.
 *
 * @param tabCount - how many tabs there are.
 * @returns the index of the first tab that comes AFTER the plus (1 of 2).
 */
function plusPosition(tabCount: number) {
  return Math.floor(tabCount / 2);
}

/**
 * Where the middle of tab number `index` sits, in pixels from the bar's
 * left edge. Exported so tests can check the sliding gold bar's target.
 *
 * Why it needs maths: the tabs share the width equally, except that the
 * admins' plus takes a fixed 76 px slot in the middle, pushing the tabs
 * after it to the right.
 *
 * @param index - the tab's place in the list (0 = Home).
 * @param tabCount - how many tabs there are (2 today).
 * @param barWidth - the bar's measured width in pixels.
 * @param hasPlus - true when the admins' plus slot is shown.
 * @returns the tab's centre, in pixels.
 */
export function tabCentre(index: number, tabCount: number, barWidth: number, hasPlus: boolean) {
  const slot = hasPlus ? tabBar.plusSlotWidth : 0;
  // Every tab gets an equal share of what the plus slot leaves over.
  const tabWidth = (barWidth - slot) / tabCount;
  // The plus sits before the second half of the tabs (Home | + | Me).
  const afterPlus = hasPlus && index >= plusPosition(tabCount);
  return tabWidth * index + tabWidth / 2 + (afterPlus ? slot : 0);
}

/**
 * Renders the bar.
 *
 * @param props.state - the tabs that exist right now and which one is open.
 * @param props.descriptors - each tab's options (its title and icon).
 * @param props.emitter - sends "tabPress" events (this is how a tap on the
 *   open tab scrolls its list back to the top, via useScrollToTop).
 * @param props.navigateToTab - switches to a tab.
 * @param props.insets - the phone's safe-area edges (the home bar below).
 * @param props.onAddEvent - admins only: opens New event (see TabBarProps).
 * @returns the bar.
 */
export function TabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
  insets,
  onAddEvent,
}: TabBarProps) {
  const hasPlus = onAddEvent !== undefined;
  const tabCount = state.routes.length;
  // The bar's width, known once it has been laid out (0 until then). The
  // gold bar is only drawn after that, so it never flashes in the wrong spot.
  const [barWidth, setBarWidth] = useState(0);
  const reduceMotion = useReduceMotion();

  // The gold bar's left edge, moved on the phone's UI thread (native driver).
  const [slide] = useState(() => new Animated.Value(0));
  // Whether the gold bar has been put in place once. The first placement is
  // instant; only later tab changes slide.
  const placed = useRef(false);
  // Where the gold bar should be: under the open tab, centred.
  const target =
    barWidth > 0
      ? tabCentre(state.index, tabCount, barWidth, hasPlus) - tabBar.indicator.width / 2
      : null;

  useEffect(() => {
    if (target === null) return;
    // First placement, Reduce Motion on, or not known yet: jump, no slide.
    if (!placed.current || !motionAllowed(reduceMotion)) {
      placed.current = true;
      slide.setValue(target);
      return;
    }
    const animation = Animated.timing(slide, {
      toValue: target,
      duration: motion.base.duration, // 200 ms (spec section 3)
      easing: motion.base.easing,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [target, reduceMotion, slide]);

  /**
   * Remembers the bar's width when it is laid out (or the phone turns).
   *
   * @param event - the layout event with the new size.
   */
  const onLayout = (event: LayoutChangeEvent) => setBarWidth(event.nativeEvent.layout.width);

  // Draw the tabs, with the plus slot slipped in the middle for admins.
  const items = state.routes.map((route, index) => {
    const focused = index === state.index;
    const { options } = descriptors[route.key];
    // The tab's name in sentence case ("Home"): what screen readers say.
    const title = options.title ?? route.name;

    /**
     * A tap: tell the screen (so a tap on the open tab can scroll its list
     * to the top), then switch tabs unless it's already open.
     */
    const onPress = () => {
      const event = emitter.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (!focused && !event.defaultPrevented) navigateToTab(route.key);
    };

    return (
      <Pressable
        key={route.key}
        onPress={onPress}
        onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
        accessibilityRole="tab"
        accessibilityLabel={title}
        accessibilityState={{ selected: focused }}
        testID={`tab-${route.name}`}
        // Android's touch ripple: a soft round glow inside the pill.
        android_ripple={{ color: colors.surfaceRaised, borderless: true }}
        // Admins: the tabs start below the plus's overhang, inside the pill.
        style={[styles.item, hasPlus && { marginTop: PLUS_OVERHANG }]}
      >
        {({ pressed }) => {
          // Gold when open, grey when not, darker gold while pressed.
          const tint = pressed ? colors.accentPressed : focused ? colors.accent : colors.muted;
          return (
            <>
              {options.tabBarIcon?.({ focused, color: tint, size: iconSize.tab })}
              <Text
                style={[styles.label, { color: tint }]}
                maxFontSizeMultiplier={LABEL_MAX_SCALE}
                numberOfLines={1}
              >
                {title.toUpperCase()}
              </Text>
            </>
          );
        }}
      </Pressable>
    );
  });
  if (onAddEvent) {
    // Left to right (and for screen readers): Home, Add event, Me.
    items.splice(
      plusPosition(tabCount),
      0,
      <View key="add-event" style={styles.plusSlot}>
        <AddEventButton onPress={onAddEvent} />
      </View>,
    );
  }

  return (
    // The outer strip, in the page colour, keeps the pill off the screen's
    // sides and above the phone's home bar. (The pill sits below the screen
    // rather than over it, so no list or map ever hides behind it.)
    <View style={[styles.outer, { paddingBottom: insets.bottom + tabBar.bottomMargin }]}>
      <View style={styles.row} accessibilityRole="tablist" testID="tab-bar" onLayout={onLayout}>
        {/* The pill itself, drawn behind the tabs. For admins it starts lower,
            so the plus can rise above its top edge. Decoration only. */}
        <View
          style={[styles.pill, hasPlus && { top: PLUS_OVERHANG }]}
          pointerEvents="none"
          testID="tab-pill"
        />
        {items}
        {/* The second "this tab is open" cue: the sliding gold bar. */}
        {target !== null ? (
          <Animated.View
            pointerEvents="none"
            testID="tab-indicator"
            style={[styles.indicator, { transform: [{ translateX: slide }] }]}
          />
        ) : null}
      </View>
    </View>
  );
}

/**
 * The admins' raised gold plus (spec section 2): a 56 px gold circle in a
 * 6 px ring of the page colour, so it looks cut into the pill.
 *
 * On a tap: a light vibration, a quarter turn of the plus and back, then
 * the New event form opens. Under Reduce Motion there is no turn and no
 * shrink (PressableScale checks that by itself); the vibration stays.
 *
 * @param props.onPress - opens New event.
 * @returns the button.
 */
function AddEventButton({ onPress }: { onPress: () => void }) {
  // 0 = upright, 1 = turned 90 degrees. Made once (useState, not useRef).
  const [turn] = useState(() => new Animated.Value(0));
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });

  /** The tap: buzz, turn (unless Reduce Motion), and open the form. */
  const handlePress = () => {
    tapLight();
    if (motionAllowed(reduceMotionNow())) {
      turn.setValue(0);
      const half = {
        duration: PLUS_TURN_HALF_MS,
        easing: motion.fast.easing,
        useNativeDriver: true,
      };
      Animated.sequence([
        Animated.timing(turn, { toValue: 1, ...half }),
        Animated.timing(turn, { toValue: 0, ...half }),
      ]).start();
    }
    onPress();
  };

  return (
    <View style={styles.plusRing}>
      <PressableScale
        scaleTo={PLUS_PRESS_SCALE}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel="Add event"
        accessibilityHint="Opens the new event form"
        testID="add-event-button"
        // The ring counts as part of the button for a finger (68 px in all).
        hitSlop={tabBar.plusRing}
        style={({ pressed }) => [styles.plus, pressed && styles.plusPressed]}
      >
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Icon
            name="plus"
            size={PLUS_ICON.size}
            strokeWidth={PLUS_ICON.stroke}
            color={colors.onAccent}
          />
        </Animated.View>
      </PressableScale>
    </View>
  );
}

/** The plus plus its ring: 56 + 6 + 6 = 68 px across. */
const PLUS_OUTER = tabBar.plusSize + tabBar.plusRing * 2;

/** Styles built from theme tokens (sizes from the VC-82 spec, section 2). */
const styles = StyleSheet.create({
  // The strip under the screens: page colour, 16 px side margins.
  outer: { backgroundColor: colors.bg, paddingHorizontal: tabBar.sideMargin },
  // The tabs (and plus slot) side by side; the pill is drawn behind them.
  row: { flexDirection: 'row' },
  // Flat, like the rest of v3: no shadow or blur, a 1 px edge, fully round.
  pill: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
  },
  // Each tab shares the width equally; the whole 64 px height is tappable.
  // The bottom padding keeps the label clear of the gold bar under it.
  item: {
    flex: 1,
    minHeight: tabBar.pillHeight,
    paddingTop: 4,
    paddingBottom: tabBar.indicator.bottom + tabBar.indicator.height + 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: tabBar.iconLabelGap,
  },
  // 16 x 3 gold bar, 7 px above the pill's bottom; slid sideways by code.
  indicator: {
    position: 'absolute',
    left: 0,
    bottom: tabBar.indicator.bottom,
    width: tabBar.indicator.width,
    height: tabBar.indicator.height,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  // Manrope 700, 11/14, capitals, 1.2 letter spacing (unchanged from Q4).
  label: { fontFamily: fonts.bodyBold, fontSize: 11, lineHeight: 14, letterSpacing: 1.2 },
  // The middle slot: fixed width, the plus at its top (rising over the pill).
  plusSlot: { width: tabBar.plusSlotWidth, alignItems: 'center' },
  // The page-coloured ring that makes the plus look cut into the pill.
  plusRing: {
    width: PLUS_OUTER,
    height: PLUS_OUTER,
    borderRadius: PLUS_OUTER / 2,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The gold circle (icon on gold: 9.8:1 contrast).
  plus: {
    width: tabBar.plusSize,
    height: tabBar.plusSize,
    borderRadius: tabBar.plusSize / 2,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusPressed: { backgroundColor: colors.accentPressed },
});
