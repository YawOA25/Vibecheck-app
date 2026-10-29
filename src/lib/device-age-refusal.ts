/**
 * The phone's own "already refused here" note for the age question that now
 * comes BEFORE the email (task VC-74).
 *
 * Why it exists: an under-18 date of birth is refused on the phone, before
 * any email is asked for, and nothing is sent to the server. Without a note,
 * the person could tap Continue again with an older year. So the phone
 * remembers, for 12 months (the same period as the server's refusal mark),
 * that someone was refused on it, and the "Create account" path then refuses
 * any later answer on this phone too.
 *
 * What is stored: only the time of the refusal, under a fixed key. No date
 * of birth, no age, no "under 13", no email, no id. It never leaves the
 * phone.
 *
 * Honest limits (said plainly, because no reliable fix exists without
 * collecting data):
 *   - deleting and reinstalling the app, or using another phone, clears it;
 *   - the "Already have an account? Sign in" path is not blocked by it, so
 *     adults sharing the phone can still sign in. That path can't create a
 *     new login (app/(auth)/sign-in.tsx sends shouldCreateUser: false there), and a
 *     login with no profile still meets the server's 18+ gate
 *     (complete_profile), which stays the backstop.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** The phone-storage key. Exported for the tests. */
export const DEVICE_REFUSAL_KEY = 'vibecheck.ageRefusedOnDevice';

/** How long the note counts: about 12 months (365 days), like the server's mark. */
export const DEVICE_REFUSAL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Notes on this phone that an age answer was refused.
 *
 * @param now - the moment of the refusal in milliseconds (tests pass a fixed one).
 * @returns nothing. If storage fails, the refusal still happened; only the
 *   retry protection is lost, which is the same as a reinstall.
 */
export async function rememberDeviceRefusal(now: number = Date.now()): Promise<void> {
  try {
    await AsyncStorage.setItem(DEVICE_REFUSAL_KEY, String(now));
  } catch {
    // Phone storage can fail (for example when full). Nothing else to do.
  }
}

/**
 * Says whether this phone refused an age answer within the last 12 months.
 * An older note is removed, so nothing is kept longer than needed.
 *
 * @param now - the current moment in milliseconds.
 * @returns true if a refusal note younger than 12 months exists.
 */
export async function hasRecentDeviceRefusal(now: number = Date.now()): Promise<boolean> {
  try {
    const saved = await AsyncStorage.getItem(DEVICE_REFUSAL_KEY);
    if (saved === null) return false;
    const at = Number(saved);
    // A note from the future (clock changed) still counts; a broken one doesn't.
    if (Number.isFinite(at) && now - at < DEVICE_REFUSAL_MS) return true;
    await AsyncStorage.removeItem(DEVICE_REFUSAL_KEY);
    return false;
  } catch {
    // Can't read storage: don't block. The server's gate is still there for
    // anything that reaches it.
    return false;
  }
}
