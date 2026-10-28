/**
 * The phone's "Reduce Motion" setting, as a React hook (Q6).
 *
 * Why it exists: some people get dizzy or distracted by moving things, so
 * iPhone and Android let them turn animations down. Every animation in the
 * app (the gauge sweep, skeleton pulses, card press scale, list cross-fade)
 * must stop when that setting is on. Before Q6 only the gauge
 * (VibeMeter.tsx) read it; this file shares the same logic so every
 * animation asks the same question in the same way.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Tracks the phone's "Reduce Motion" setting.
 *
 * @returns true while Reduce Motion is on, false while off, and null until
 *   the phone has answered. Callers treat null like "on" (no motion yet), so
 *   an animation never starts that should not have. A listener follows
 *   later changes, e.g. the guest flips the setting while the app is open.
 */
export function useReduceMotion(): boolean | null {
  const [reduce, setReduce] = useState<boolean | null>(null);
  useEffect(() => {
    // Ignore a late answer if the screen has already closed.
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (active) setReduce(on);
      })
      // If the phone can't say, assume motion is fine (the default setting).
      .catch(() => {
        if (active) setReduce(false);
      });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);
  return reduce;
}

/**
 * True only when motion is known to be allowed.
 *
 * @param reduce - the value from useReduceMotion (true, false or null).
 * @returns true when the phone said Reduce Motion is OFF; false while it is
 *   on or still unknown (so nothing moves until we know it may).
 */
export function motionAllowed(reduce: boolean | null): boolean {
  return reduce === false;
}
