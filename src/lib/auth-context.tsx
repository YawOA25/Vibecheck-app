/**
 * Who is using the app right now, shared with every screen.
 *
 * What it does: watches the Supabase login and loads the person's profile,
 * then sums both up as one `status`:
 *   - 'loading'      : still checking (the splash screen stays up)
 *   - 'signedOut'    : no login -> show the sign-in screen
 *   - 'needsProfile' : signed in, but no profile yet -> show the age gate
 *   - 'ready'        : signed in with a profile (passed the 18+ gate)
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

import { supabase } from '@/lib/supabase';

/** The profile fields the app reads. birthdate is never readable by the app. */
export interface Profile {
  id: string;
  display_name: string;
  role: 'user' | 'admin';
  is_tester: boolean;
}

/** The overall sign-in state (see the list at the top of this file). */
export type AuthStatus = 'loading' | 'signedOut' | 'needsProfile' | 'ready' | 'error';

/** Everything `useAuth()` gives a screen. */
export interface AuthState {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  /** Loads the profile again (after complete_profile, or to retry after an error). */
  refreshProfile: () => Promise<void>;
  /** Signs out on this phone and returns to the sign-in screen. */
  signOut: () => Promise<void>;
}

// The columns we read from profiles. They must be named one by one: the table
// refuses `select *` because app users may not read birthdate (VC-B02).
const PROFILE_COLUMNS = 'id, display_name, role, is_tester';

const AuthContext = createContext<AuthState | null>(null);

/**
 * Reads one person's profile from the database.
 *
 * @param userId - the signed-in person's id.
 * @returns their profile; null if they have none yet (they still need to pass
 *   the age gate); or 'error' if it couldn't be loaded (for example offline).
 */
async function fetchProfile(userId: string): Promise<Profile | null | 'error'> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle<Profile>();
  // maybeSingle gives null data (and no error) when there's no row yet,
  // which means "needs to finish sign-up".
  return error ? 'error' : data;
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
    value: Profile | null | 'error';
  } | null>(null);

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
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      // Supabase warns against calling it again from inside this callback
      // (it can lock up), so we only store the session here. The effect below
      // loads the profile.
      if (active) setSession(newSession);
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
    // scope 'local' signs out only this phone, which also works offline.
    await supabase.auth.signOut({ scope: 'local' });
  }, []);

  // 3. Sum it all up as one status.
  const value = useMemo<AuthState>(() => {
    // Only count a loaded profile if it belongs to the person signed in now.
    const profile = loaded && loaded.userId === userId ? loaded.value : undefined;
    let status: AuthStatus;
    if (session === undefined) status = 'loading';
    else if (session === null) status = 'signedOut';
    else if (profile === undefined) status = 'loading';
    else if (profile === 'error') status = 'error';
    else if (profile === null) status = 'needsProfile';
    else status = 'ready';

    return {
      status,
      session: session ?? null,
      profile: profile && profile !== 'error' ? profile : null,
      refreshProfile,
      signOut,
    };
  }, [session, userId, loaded, refreshProfile, signOut]);

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
