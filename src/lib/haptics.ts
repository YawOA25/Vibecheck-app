/**
 * Small vibrations ("haptics") for key moments (proposal VC-32d, Q6).
 *
 * Four taps, each tied to one moment:
 *   - tapLight:   a rating was saved (Rate screen), and a pull to refresh
 *                 started on the home list (VC-80);
 *   - tapSelection: the lightest "tick", for picking something (VC-80: a
 *                 date chip, the home carousel settling on a new card, a
 *                 day heading sticking to the top). Never on plain scroll;
 *   - tapSuccess: a check-in passed (GPS check-in or the party code);
 *   - tapWarning: the party code was wrong.
 *
 * Why a wrapper instead of calling expo-haptics directly:
 *   1. It never fails loudly. A vibration is a nice extra; if the phone has
 *      no vibration motor, the setting is off, or we're on the web, the
 *      call may throw or reject. We swallow that, so a missing buzz can
 *      never break a check-in or a rating.
 *   2. It never runs in tests. Jest runs on a PC with no phone hardware, so
 *      the wrapper does nothing while NODE_ENV is 'test'. Screen tests mock
 *      this file to check WHEN a tap happens; this file's own test switches
 *      it on with `setHapticsEnabled(true)` and mocks expo-haptics.
 *
 * expo-haptics is a native module: after installing it, Expo must be
 * restarted with `npx expo start --clear` (and a new dev build for EAS).
 * It sends nothing anywhere and stores nothing (no privacy change).
 */
import * as Haptics from 'expo-haptics';

// Off in Jest (NODE_ENV is 'test' there), on in the app.
let enabled = process.env.NODE_ENV !== 'test';

/**
 * Turns the taps on or off. Only this file's own test uses it.
 *
 * @param on - true to let taps run (even in Jest), false to silence them.
 * @returns nothing.
 */
export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

/**
 * Runs one haptics call, ignoring any failure.
 *
 * @param run - starts the vibration and returns its promise.
 * @returns nothing; the caller never waits for the vibration.
 */
function safely(run: () => Promise<void>): void {
  if (!enabled) return;
  try {
    // A rejected promise (e.g. "not available on this device") is ignored.
    run().catch(() => {});
  } catch {
    // A sync throw (e.g. the native module is missing in an old build) too.
  }
}

/** A light tap: a rating was saved. */
export function tapLight(): void {
  safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/**
 * The lightest "tick" (expo-haptics selectionAsync), VC-80: a date chip was
 * picked, the carousel settled on a new card, or a day heading stuck.
 */
export function tapSelection(): void {
  safely(() => Haptics.selectionAsync());
}

/** The phone's "success" pattern: a check-in passed. */
export function tapSuccess(): void {
  safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** The phone's "warning" pattern: the party code was wrong. */
export function tapWarning(): void {
  safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}
