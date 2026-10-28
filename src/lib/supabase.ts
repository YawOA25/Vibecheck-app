/**
 * The app's one connection to Supabase (login and database).
 *
 * What it does: creates the Supabase "client" that every screen uses to sign
 * in, sign out and call server functions such as `complete_profile`.
 *
 * Where the settings come from: `.env` in the app folder (see .env.example).
 * Expo copies variables starting with EXPO_PUBLIC_ into the app. The URL and
 * the anon (public) key are safe to ship inside the app: the database's
 * row-level security rules protect the data, not the key.
 *
 * Where the login is kept: Supabase saves the login (session tokens) so people
 * stay signed in after closing the app. On phones it goes to the encrypted
 * secure store (iPhone Keychain / Android Keystore) through
 * src/lib/secure-session-storage.ts, which also moved logins saved by older
 * builds out of plain AsyncStorage once, without signing anyone out (batch
 * Q1). The web build has no secure store, so it uses AsyncStorage (the
 * browser's localStorage).
 *
 * Privacy rule for server calls (batch Q1): every `supabase.rpc(...)` is sent
 * as a POST, with its inputs in the request BODY. Never pass the third
 * `{ get: true }` or `{ head: true }` option: those put the inputs (for
 * complete_profile, the date of birth) into the web address, where server
 * logs keep them. ESLint refuses that option (eslint.config.js), and
 * __tests__/rpc-post-only.test.js proves the calls go out as POST.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { secureSessionStorage } from '@/lib/secure-session-storage';

// Expo only fills these in when they are written out exactly like this
// (process.env.EXPO_PUBLIC_...), so don't rewrite them as process.env[name].
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * True when `.env` has real Supabase settings (not missing, not the
 * placeholder text from .env.example). The app shows a "setup needed" note
 * instead of a confusing network error when this is false.
 */
export const isSupabaseConfigured = Boolean(
  url && anonKey && !url.includes('your-project-id') && !anonKey.includes('your-anon-key'),
);

/**
 * The shared Supabase client.
 *
 * When `.env` isn't filled in we still create a client (pointing nowhere), so
 * importing this file never crashes; the root layout checks
 * `isSupabaseConfigured` first.
 */
export const supabase = createClient(
  url || 'https://not-configured.invalid',
  anonKey || 'not-configured',
  {
    auth: {
      // Phones: encrypted secure store. Web: localStorage (no secure store).
      storage: Platform.OS === 'web' ? AsyncStorage : secureSessionStorage,
      // Renew the login token in the background before it expires (1 hour).
      autoRefreshToken: true,
      // Remember the login between app launches.
      persistSession: true,
      // Only websites receive logins in the page address; the app uses codes.
      detectSessionInUrl: false,
    },
  },
);

// Supabase's guidance for phones: renew tokens only while the app is open on
// screen. A phone pauses background apps, so a timer running then can fail.
// This doesn't apply on the web, where the browser handles it.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
