/**
 * Who is using the app right now, shared with every screen.
 *
 * What it does: watches the Supabase login and loads the person's profile,
 * then sums both up as one `status`:
 *   - 'loading'      : still checking (the splash screen stays up)
 *   - 'signedOut'    : no login -> show the sign-in screen
 *   - 'needsProfile' : signed in, but no profile yet -> show the age gate
 *   - 'ready'        : signed in with a profile (passed the 18+ gate)
 *   - 'blocked'      : refused by the 18+ gate (VC-30) -> show the "sorry"
 *                      screen. This sticks after signing out and back in,
 *                      because the server keeps a refusal mark for the login.
 *   - 'error'        : couldn't load the profile (for example no internet)
 * The root layout (app/_layout.tsx) uses `status` to decide which screens
 * exist at all, so a signed-out person can't open the Tonight screen.
 *
 * Why a "context": React's way to share one value with every screen without
 * passing it through each one by hand. Screens read it with `useAuth()`.
 */
import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { requestAccountDeletion } from '@/lib/account-api';
import type { DeleteAccountResult } from '@/lib/account-api';
import { checkAgeLock, rememberAgeLock } from '@/lib/age-lock';
import { cancelRecapReminders } from '@/lib/recap-notifications';
import { supabase } from '@/lib/supabase';

/** The profile fields the app reads. birthdate is never readable by the app. */
export interface Profile {
  id: string;
  display_name: string;
  role: 'user' | 'admin';
  is_tester: boolean;
}

/** The overall sign-in state (see the list at the top of this file). */
export type AuthStatus = 'loading' | 'signedOut' | 'needsProfile' | 'ready' | 'blocked' | 'error';

/**
 * How the server refused an under-18 answer (see complete_profile):
 *   - 'locked'  : ages 13-17. The login stays, but is locked for good.
 *   - 'deleted' : under 13. The server deleted the login, so the phone signs
 *                 out too; the "sorry" screen stays up until it is dismissed.
 */
export type AgeRefusal = 'locked' | 'deleted';

/** Everything `useAuth()` gives a screen. */
export interface AuthState {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  /** Loads the profile again (after complete_profile, or to retry after an error). */
  refreshProfile: () => Promise<void>;
  /** Signs out on this phone and returns to the sign-in screen. */
  signOut: () => Promise<void>;
  /** Called by the age gate when the server refuses the answer (VC-30). */
  markAgeBlocked: (refusal: AgeRefusal) => Promise<void>;
  /**
   * Deletes the account on the server, then signs out and clears this
   * phone (VC-B13). Resolves with { ok: false, message } if the server
   * didn't delete it; the person then stays signed in.
   */
  deleteAccount: () => Promise<DeleteAccountResult>;
}

/** What we know about a login after loading: its profile, or why there's none. */
type LoadedValue = Profile | null | 'blocked' | 'error';

// The columns we read from profiles. They must be named one by one: the table
// refuses `select *` because app users may not read birthdate (VC-B02).
const PROFILE_COLUMNS = 'id, display_name, role, is_tester';

const AuthContext = createContext<AuthState | null>(null);

/**
 * Reads one person's profile from the database, and if there is none, checks
 * whether the age gate has locked their login.
 *
 * @param userId - the signed-in person's id.
 * @returns their profile; null if they have none yet (they still need to pass
 *   the age gate); 'blocked' if the age gate refused them before (VC-30); or
 *   'error' if it couldn't be loaded (for example offline).
 */
async function fetchProfile(userId: string): Promise<LoadedValue> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle<Profile>();
  if (error) return 'error';
  // maybeSingle gives null data (and no error) when there's no row yet.
  if (data) return data;
  // No profile: either they haven't answered yet, or they were refused.
  const locked = await checkAgeLock(userId);
  if (locked === 'error') return 'error';
  return locked ? 'blocked' : null;
}

/**
 * Wraps the app and keeps the sign-in state up to date.
 *
 * @param props.children - the rest of the app.
 * @returns the children, with the auth state available through `useAuth()`.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  // undefined = "not checked yet"; null = "checked, nobody signed in".
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // The last profile we loaded, tagged with WHOSE it is. The value is the
  // profile, null ("no profile yet") or 'error' (loading failed). Tagging it
  // means that when a different person signs in, the old answer is simply
  // ignored (status 'loading') until theirs arrives, and a slow answer for a
  // previous person can never be shown as the new person's.
  const [loaded, setLoaded] = useState<{
    userId: string;
    value: LoadedValue;
  } | null>(null);
  // True after an under-13 refusal, when the server has deleted the login and
  // the phone has signed out. It keeps the "sorry" screen up (instead of
  // jumping straight to sign-in) until the person taps to dismiss it.
  const [blockedAfterSignOut, setBlockedAfterSignOut] = useState(false);

  // 1. Watch the login. getSession() reads a saved login from the phone;
  //    onAuthStateChange tells us about every sign-in, sign-out and token renewal.
  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setSession(data.session);
      })
      .catch(() => {
        // A broken saved login is treated as "signed out".
        if (active) setSession(null);
      });
    const { data } = supabase.auth.onAuthStateChange((event, newSession) => {
      // Supabase warns against calling it again from inside this callback
      // (it can lock up), so we only store the session here. The effect below
      // loads the profile.
      if (active) setSession(newSession);
      // Any sign-out (the button, the age gate, an expired login): remove
      // the recap notes, which name the last person's events (VC-B12). This
      // isn't a Supabase call, so it's safe in here.
      if (event === 'SIGNED_OUT') void cancelRecapReminders();
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  // The signed-in person's id, or null. Token renewals keep the same id, so
  // the profile isn't reloaded every hour.
  const userId = session?.user.id ?? null;

  /**
   * Loads the profile again on request (after complete_profile, or the
   * "Try again" button). Returns once the new answer is stored.
   */
  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    const value = await fetchProfile(userId);
    setLoaded({ userId, value });
  }, [userId]);

  // 2. Load the profile whenever a different person signs in. State is only
  //    set inside `.then` (after the answer arrives), as React recommends.
  useEffect(() => {
    if (!userId) return;
    let active = true;
    void fetchProfile(userId).then((value) => {
      if (active) setLoaded({ userId, value });
    });
    return () => {
      active = false;
    };
  }, [userId]);

  /** Signs out on this phone. onAuthStateChange then sets the session to null. */
  const signOut = useCallback(async () => {
    // Dismisses the under-13 "sorry" screen too (see blockedAfterSignOut).
    setBlockedAfterSignOut(false);
    // The recap notes name this person's events: remove them first, so the
    // next person on this phone never sees them (VC-B12, cto privacy fix).
    await cancelRecapReminders();
    // scope 'local' signs out only this phone, which also works offline.
    await supabase.auth.signOut({ scope: 'local' });
  }, []);

  /**
   * Deletes the account (Settings, VC-B13): asks the server first, and only
   * once it says "deleted", clears this phone:
   *   - the scheduled and shown recap notes (they name the person's events);
   *   - the saved login in the secure store, through a local sign-out (the
   *     server has already ended every session, so 'local' is all that's
   *     left to do, and it works even if the network drops now).
   * The root layout then shows the sign-in screen by itself.
   *
   * @returns { ok: true } after deleting, or { ok: false, message } when the
   *   server didn't delete it (nothing on the phone is changed then).
   */
  const deleteAccount = useCallback(async (): Promise<DeleteAccountResult> => {
    const result = await requestAccountDeletion();
    if (!result.ok) return result;
    await cancelRecapReminders();
    // signOut can fail if the network drops; the local login is removed
    // either way (supabase-js clears it before talking to the server).
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return result;
  }, []);

  /**
   * Switches to the "sorry" screen after the server refused an age answer.
   *
   * @param refusal - 'locked' (13-17: remember it on the phone too) or
   *   'deleted' (under 13: the login is gone, so sign this phone out and
   *   store nothing, per the legal conditions).
   * @returns once the change is made.
   */
  const markAgeBlocked = useCallback(
    async (refusal: AgeRefusal) => {
      if (!userId) return;
      if (refusal === 'deleted') {
        setBlockedAfterSignOut(true);
        // The login no longer exists on the server; drop it from the phone.
        await supabase.auth.signOut({ scope: 'local' });
        return;
      }
      await rememberAgeLock(userId);
      setLoaded({ userId, value: 'blocked' });
    },
    [userId],
  );

  // 3. Sum it all up as one status.
  const value = useMemo<AuthState>(() => {
    // Only count a loaded profile if it belongs to the person signed in now.
    const profile = loaded && loaded.userId === userId ? loaded.value : undefined;
    let status: AuthStatus;
    if (blockedAfterSignOut) status = 'blocked';
    else if (session === undefined) status = 'loading';
    else if (session === null) status = 'signedOut';
    else if (profile === undefined) status = 'loading';
    else if (profile === 'error') status = 'error';
    else if (profile === 'blocked') status = 'blocked';
    else if (profile === null) status = 'needsProfile';
    else status = 'ready';

    return {
      status,
      session: session ?? null,
      profile: profile && profile !== 'error' && profile !== 'blocked' ? profile : null,
      refreshProfile,
      signOut,
      markAgeBlocked,
      deleteAccount,
    };
  }, [
    session,
    userId,
    loaded,
    blockedAfterSignOut,
    refreshProfile,
    signOut,
    markAgeBlocked,
    deleteAccount,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Reads the current sign-in state from inside any screen.
 *
 * @returns the auth state (see AuthState).
 * @throws if used outside <AuthProvider>, which would be a programming mistake.
 */
export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth() must be used inside <AuthProvider>.');
  return value;
}
