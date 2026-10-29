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
 * The phone's last known Reduce Motion answer, shared by the whole app
 * (VC-76). null until the phone has answered.
 *
 * Why a shared copy: small parts such as buttons and chips need the answer
 * at the moment they are pressed, and asking the phone from every button
 * would mean hundreds of questions. Instead the answer is asked once,
 * remembered here, and kept up to date by one listener. Screens that use the
 * useReduceMotion hook also refresh it.
 */
let latest: boolean | null = null;
/** Whether the one-time question and the listener have been set up. */
let watching = false;

/**
 * Starts the one shared question and listener, the first time it is needed.
 *
 * @returns nothing; fills `latest` when the phone answers.
 */
function startWatching(): void {
  if (watching) return;
  watching = true;
  AccessibilityInfo.isReduceMotionEnabled()
    .then((on) => {
      latest = on;
    })
    // If the phone can't say, assume motion is fine (the default setting).
    .catch(() => {
      if (latest === null) latest = false;
    });
  AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => {
    latest = on;
  });
}

/**
 * The Reduce Motion answer right now, without waiting (VC-76).
 *
 * Used by parts that animate on a tap or on new content (PressableScale,
 * FadeIn, ChoiceChip), where a React hook in every copy would be wasteful.
 *
 * @returns true (on), false (off) or null (the phone hasn't answered yet;
 *   callers treat null like "on", so nothing moves that shouldn't).
 */
export function reduceMotionNow(): boolean | null {
  startWatching();
  return latest;
}

/**
 * Tests only: forgets the shared answer so the next test starts fresh.
 *
 * @param value - the answer to start from (default null, "not known").
 * @returns nothing.
 */
export function resetReduceMotionForTests(value: boolean | null = null): void {
  latest = value;
  // Set up as "already watching" when a value is given, so a test's chosen
  // answer isn't overwritten by a new question to the (fake) phone.
  watching = value !== null;
}

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
        // Keep the shared copy in step too (see reduceMotionNow).
        latest = on;
        if (active) setReduce(on);
      })
      // If the phone can't say, assume motion is fine (the default setting).
      .catch(() => {
        if (active) setReduce(false);
      });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => {
      latest = on;
      setReduce(on);
    });
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
