/**
 * The phone's copy of the age-gate lock (task VC-30).
 *
 * What it is: when the server refuses a login because the person is under 18,
 * it stores a "refusal mark" (since VC-75 an HMAC fingerprint of the
 * login's email; see supabase/migrations/20261026170000_age_gate_lock.sql
 * and 20261028130000_age_refusal_hmac.sql). This file keeps a
 * matching yes/no flag on the phone, so the app can show the "sorry" screen
 * at once, even before the server answers or when the phone is offline.
 *
 * The server's mark is the one that counts. The phone flag only helps: it
 * disappears if the app is reinstalled, and then the server check
 * (`checkAgeLock`) brings the "sorry" screen back.
 *
 * Privacy (legal condition 1): only the login id goes into the key and the
 * value is just "1". The birthdate is never saved or logged here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';

/** The phone-storage key for one login's flag. Exported for the tests. */
export function ageLockKey(userId: string): string {
  return `vibecheck.ageLock.${userId}`;
}

/**
 * Remembers on this phone that a login was refused.
 *
 * @param userId - the refused login's id.
 * @returns nothing. If phone storage fails, the server mark still protects.
 */
export async function rememberAgeLock(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(ageLockKey(userId), '1');
  } catch {
    // Phone storage can fail (for example when it is full). That is fine:
    // the server keeps the real mark and is asked again on the next launch.
  }
}

/**
 * Says whether this phone remembers a refusal for a login.
 *
 * @param userId - the login to check.
 * @returns true if the flag is set; false if not, or if storage can't be read.
 */
async function hasLocalAgeLock(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ageLockKey(userId))) === '1';
  } catch {
    return false;
  }
}

/**
 * Decides whether a signed-in login without a profile is locked by the age
 * gate. Checks the phone first (quick, works offline), then the server.
 *
 * @param userId - the signed-in login's id.
 * @returns true (locked), false (not locked), or 'error' when the phone has
 *   no flag and the server couldn't be asked (for example no internet). The
 *   caller treats 'error' like any other loading failure and offers a retry,
 *   rather than guessing "not locked".
 */
export async function checkAgeLock(userId: string): Promise<boolean | 'error'> {
  if (await hasLocalAgeLock(userId)) return true;
  // `age_gate_locked` only ever answers about the caller's own login.
  const { data, error } = await supabase.rpc('age_gate_locked');
  if (error) return 'error';
  if (data === true) {
    // Reinstalled, or a new phone: copy the server's answer back to the phone.
    await rememberAgeLock(userId);
    return true;
  }
  return false;
}
