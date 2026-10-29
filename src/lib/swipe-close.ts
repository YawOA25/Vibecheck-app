/**
 * useSwipeToClose: switches a sheet screen's swipe-down-to-close gesture
 * on or off (VC-76, design/vc76-motion-spec.md section 1).
 *
 * Why it exists: since VC-76 the rating and party-code screens open as
 * sheets from the bottom ("modal"), and on iPhone a sheet closes when you
 * swipe it down. That's handy, but not halfway through a rating or while a
 * code is being sent: a stray swipe would throw that work away. Those
 * screens call this hook with `false` at those moments.
 *
 * It only changes the screen's gesture setting; it never closes anything
 * itself.
 */
import { useNavigation } from 'expo-router';
import { useEffect } from 'react';

/**
 * The one navigator method this hook uses (a small hand-written type, so
 * the screens needn't import the navigator library's types).
 */
interface ScreenOptionsSetter {
  setOptions(options: { gestureEnabled: boolean }): void;
}

/**
 * Turns the screen's swipe-to-close on or off.
 *
 * @param allowed - true to allow swiping the sheet away, false to block it.
 * @returns nothing.
 */
export function useSwipeToClose(allowed: boolean): void {
  const navigation = useNavigation() as unknown as ScreenOptionsSetter;
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: allowed });
  }, [navigation, allowed]);
}
