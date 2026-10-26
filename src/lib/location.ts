/**
 * Reads the phone's current position once, for "Use my current location" on
 * the admin "New event" screen (task VC-B04).
 *
 * Privacy (VC-20): the position is only handed to the screen, which sends it
 * to `create_event`. The server keeps it in event_private, which no app user
 * can read. Nothing is saved on the phone, and the screen never shows the
 * numbers, only "Location set".
 *
 * Uses expo-location, which works in Expo Go. It asks for "while using the
 * app" permission only (foreground), never background tracking.
 */
import * as Location from 'expo-location';

import type { Pin } from '@/lib/event-form';

/** What {@link getCurrentPin} returns. */
export type PinOutcome =
  | { status: 'ok'; pin: Pin }
  /** The admin said no to location access (now or earlier). */
  | { status: 'denied' }
  /** Location is on, but the phone couldn't get a fix (indoors, timeout...). */
  | { status: 'error' };

/**
 * Asks for location permission if needed, then reads the position once.
 *
 * @returns the pin with its accuracy in metres, or why there isn't one.
 */
export async function getCurrentPin(): Promise<PinOutcome> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') return { status: 'denied' };
    // High accuracy uses GPS, which is what check-in will compare against.
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return {
      status: 'ok',
      pin: {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracyM: position.coords.accuracy ?? null,
      },
    };
  } catch {
    // For example location services switched off for the whole phone.
    return { status: 'error' };
  }
}
