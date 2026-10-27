/**
 * Reads the phone's location once for "I'm here" check-in (task VC-B06).
 *
 * What it does: works out where location permission stands, asks for it if
 * the phone still allows asking, then takes ONE foreground reading. It hands
 * back either the reading or a plain reason why there isn't a usable one.
 *
 * Privacy (VC-20):
 *   - Foreground only ("while using the app"); never background tracking.
 *   - The reading is returned to the caller, which sends it straight to the
 *     server's check_in function. Nothing here saves it, shows it or logs it.
 *     Please keep it that way: no console.log of a reading, ever.
 *
 * Permission states, in plain words:
 *   - granted:      precise location allowed.
 *   - approximate:  allowed, but only a rough area (Android "Approximate",
 *                   iPhone "Precise: Off"). That's a few kilometres, far too
 *                   rough to tell if you're at a party, so we treat it like a
 *                   weak signal and don't even send it.
 *   - denied:       said no, but the phone lets us ask again.
 *   - blocked:      said no and the phone won't show the question again
 *                   ("Don't ask again", or any "no" on iPhone): only Settings
 *                   can change it.
 *   - undetermined: never asked yet.
 */
import * as Location from 'expo-location';
import type { LocationPermissionResponse } from 'expo-location';

/** One reading, as sent to the server. Never stored or shown. */
export interface LocationReading {
  lat: number;
  lng: number;
  /** The phone's own estimate of how far off it might be, in metres. */
  accuracyM: number;
}

/** Where location permission stands (see the file comment). */
export type PermissionState = 'granted' | 'approximate' | 'denied' | 'blocked' | 'undetermined';

/** What {@link readLocationForCheckIn} returns. */
export type ReadingOutcome =
  | { kind: 'reading'; reading: LocationReading }
  /** Said no; we may ask again (show "Allow location"). */
  | { kind: 'denied' }
  /** Said no for good; only Settings can change it. */
  | { kind: 'blocked' }
  /** Allowed, but only approximate location. Treated like a weak signal. */
  | { kind: 'approximate' }
  /** The phone's location services are switched off altogether. */
  | { kind: 'servicesOff' }
  /** Couldn't get a usable position in time (indoors, no fix, an error). */
  | { kind: 'noFix' };

/**
 * How long we wait for a position before giving up. 20 seconds is long
 * enough for a cold GPS start outdoors, short enough not to feel stuck.
 */
export const READING_TIMEOUT_MS = 20_000;

/**
 * Turns the phone's permission answer into one of our five states.
 *
 * @param permission - the answer from expo-location (get... or request...).
 * @returns 'granted', 'approximate', 'denied', 'blocked' or 'undetermined'.
 */
export function classifyPermission(permission: LocationPermissionResponse): PermissionState {
  if (permission.status === 'granted') {
    // Android: 'coarse' means the person picked "Approximate".
    // iPhone (iOS 14+): 'reduced' means "Precise" is switched off.
    if (permission.android?.accuracy === 'coarse' || permission.ios?.accuracy === 'reduced') {
      return 'approximate';
    }
    return 'granted';
  }
  if (permission.status === 'undetermined') return 'undetermined';
  // A "no": can we still ask? If not, only Settings can turn it back on.
  return permission.canAskAgain ? 'denied' : 'blocked';
}

/**
 * Waits for a promise, but gives up after a time limit.
 *
 * @param promise - the work to wait for.
 * @param ms - the limit in milliseconds.
 * @returns the promise's value, or null if the time ran out first.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    // Always stop the timer so it can't keep the app (or a test) waiting.
    if (timer) clearTimeout(timer);
  }
}

/**
 * Asks for permission if needed, then reads the position once.
 *
 * @param timeoutMs - how long to wait for a position (tests pass a short one).
 * @returns the reading, or why there isn't a usable one. Never throws.
 *
 * Order matters:
 *   1. Check permission without a pop-up first.
 *   2. Never asked, or a "no" we may ask about again: show the phone's
 *      question now (the person just tapped "I'm here", so they expect it).
 *   3. Approximate only: stop here and say so, without taking a reading.
 *   4. Location switched off for the whole phone: say so.
 *   5. Take one high-accuracy (GPS) reading, with a time limit.
 */
export async function readLocationForCheckIn(
  timeoutMs: number = READING_TIMEOUT_MS,
): Promise<ReadingOutcome> {
  try {
    let state = classifyPermission(await Location.getForegroundPermissionsAsync());
    if (state === 'undetermined' || state === 'denied') {
      state = classifyPermission(await Location.requestForegroundPermissionsAsync());
    }
    if (state === 'denied' || state === 'undetermined') return { kind: 'denied' };
    if (state === 'blocked') return { kind: 'blocked' };
    if (state === 'approximate') return { kind: 'approximate' };

    return await takeReading(timeoutMs);
  } catch {
    // For example "location request failed" from the phone. Nothing about
    // the error is logged: it could include position details.
    return { kind: 'noFix' };
  }
}

/**
 * Takes ONE high-accuracy reading, once permission is known to be fine.
 *
 * @param timeoutMs - how long to wait for a position.
 * @returns the reading, 'servicesOff' when location is switched off for the
 *   whole phone, or 'noFix' when there's no usable position in time. May
 *   throw (the callers catch it).
 */
async function takeReading(
  timeoutMs: number,
): Promise<Extract<ReadingOutcome, { kind: 'reading' | 'servicesOff' | 'noFix' }>> {
  if (!(await Location.hasServicesEnabledAsync())) return { kind: 'servicesOff' };

  // High accuracy uses GPS, the same thing the admin's pin came from.
  const position = await withTimeout(
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
    timeoutMs,
  );
  // No position in time, or the phone didn't say how accurate it is (the
  // server needs that to be fair): treat as no usable fix.
  const accuracy = position?.coords.accuracy;
  if (!position || accuracy == null || !Number.isFinite(accuracy)) return { kind: 'noFix' };

  return {
    kind: 'reading',
    reading: {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracyM: accuracy,
    },
  };
}

/**
 * The quiet re-check before a rating (task VC-B08): one reading, but ONLY
 * if precise location is already allowed. It never shows the phone's
 * permission question and never explains a failure to the guest.
 *
 * @param timeoutMs - how long to wait for a position.
 * @returns the reading, or null when there isn't one (permission not
 *   granted, approximate only, location off, no fix, an error). Never throws.
 * Why quiet: the guest already proved they were here when they checked in;
 * this just keeps "here now" true (mvp-plan.md, "Rating rules"). If it
 * can't get a reading, the server's 45-minute rule still decides.
 * Privacy: same as {@link readLocationForCheckIn}; the reading goes only to
 * the server's check_in and is never stored, shown or logged.
 */
export async function readLocationQuietly(
  timeoutMs: number = READING_TIMEOUT_MS,
): Promise<LocationReading | null> {
  try {
    const state = classifyPermission(await Location.getForegroundPermissionsAsync());
    if (state !== 'granted') return null;
    const outcome = await takeReading(timeoutMs);
    return outcome.kind === 'reading' ? outcome.reading : null;
  } catch {
    // Nothing about the error is logged: it could include position details.
    return null;
  }
}
