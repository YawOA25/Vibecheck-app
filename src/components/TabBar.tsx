/**
 * The bottom tab bar (Q4 "launch look", spec section 2.2): Tonight, Me and,
 * for admins only, Admin.
 *
 * Why a custom bar instead of the built-in one: the design marks the open
 * tab twice, with gold colour AND a small 24 x 2 gold bar on the top edge,
 * so the state isn't shown by colour alone. Drawing our own bar keeps that
 * and the exact sizes simple. app/(tabs)/_layout.tsx hands it to expo-router
 * through the `tabBar` option.
 *
 * Which tabs appear is decided by the layout, not here: the Admin tab is
 * left out of the navigator for non-admins (Tabs.Protected), so this bar
 * simply draws every tab it is given.
 *
 * Accessibility (spec 2.6): the row is a "tablist", each column a "tab"
 * with "selected" on the open one, read as "Tonight", "Me", "Admin" (not the
 * capital letters shown). Icons are hidden from screen readers. Labels grow
 * with the phone's text size up to 1.3 times, then stop, so the bar never
 * breaks.
 */
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, iconSize, minTapTarget, tabBar } from '@/theme';

/**
 * The smallest space under the labels. On phones with no home bar (inset 0,
 * e.g. Android button navigation) the labels would otherwise touch the edge.
 */
const MIN_BOTTOM_PADDING = 8;

/** The most the tab labels may grow with the phone's text-size setting. */
const LABEL_MAX_SCALE = 1.3;

/**
 * Renders the tab bar.
 *
 * @param props.state - the tabs that exist right now and which one is open.
 * @param props.descriptors - each tab's options (its title and icon).
 * @param props.emitter - sends "tabPress" events (this is how a tap on the
 *   open tab scrolls its list back to the top, via useScrollToTop).
 * @param props.navigateToTab - switches to a tab.
 * @param props.insets - the phone's safe-area edges (the home bar below).
 * @returns the bar.
 */
export function TabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  // Labels never sit inside the home-bar space; with no home bar, keep 8 px.
  const paddingBottom = Math.max(insets.bottom, MIN_BOTTOM_PADDING);
  return (
    <View style={[styles.bar, { paddingBottom }]} accessibilityRole="tablist" testID="tab-bar">
      {state.routes.map((route, index) => {
        const focused = index === state.index;
        const { options } = descriptors[route.key];
        // The tab's name in sentence case ("Tonight"): what screen readers say.
        const title = options.title ?? route.name;

        /**
         * A tap: tell the screen (so a tap on the open tab can scroll its
         * list to the top), then switch tabs unless it's already open.
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
            // Android's touch ripple, in the card colour (no other colour).
            android_ripple={{ color: colors.surface }}
            style={styles.item}
          >
            {({ pressed }) => {
              // Gold when open, grey when not, darker gold while pressed.
              const tint = pressed ? colors.accentPressed : focused ? colors.accent : colors.muted;
              return (
                <>
                  {/* The second "this tab is open" cue: a 24 x 2 gold bar on
                      the top edge, centred over the column. */}
                  {focused ? <View style={styles.indicator} testID="tab-indicator" /> : null}
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
      })}
    </View>
  );
}

/** Styles built from theme tokens (sizes from the Q4 spec, section 2.2). */
const styles = StyleSheet.create({
  // Flat and opaque like the rest of v3: no blur, no shadow, a 1 px top edge.
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  // Each tab shares the width equally; the whole 56 px column is tappable.
  item: {
    flex: 1,
    height: tabBar.height,
    minHeight: minTapTarget,
    paddingTop: 6,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: tabBar.iconLabelGap,
  },
  indicator: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    width: tabBar.indicator.width,
    height: tabBar.indicator.height,
    backgroundColor: colors.accent,
  },
  // Manrope 700, 11/14, capitals (v3's 10/600 was raised for legibility).
  label: { fontFamily: fonts.bodyBold, fontSize: 11, lineHeight: 14, letterSpacing: 1.2 },
});
