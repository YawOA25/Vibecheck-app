/**
 * Tests for the shared sign-in state (src/lib/auth-context.tsx), tasks
 * VC-B03 and VC-30.
 *
 * Supabase is replaced with a fake, and phone storage with the in-memory
 * fake that the AsyncStorage package ships for tests. A tiny "probe"
 * component prints the current status so we can check that each situation
 * (no login, login without profile, login with profile, profile failed to
 * load, refused by the age gate) gives the right status, which is what
 * decides the screens a person can reach.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { Pressable, Text } from 'react-native';

import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ageLockKey } from '@/lib/age-lock';
import { offerRecapReminder } from '@/lib/recap-notifications';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: jest.fn(), onAuthStateChange: jest.fn(), signOut: jest.fn() },
    from: jest.fn(),
    rpc: jest.fn(),
    functions: { invoke: jest.fn() },
  },
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const auth = supabase.auth as unknown as {
  getSession: jest.Mock;
  onAuthStateChange: jest.Mock;
  signOut: jest.Mock;
};
const from = supabase.from as unknown as jest.Mock;
const rpc = supabase.rpc as unknown as jest.Mock;
const invoke = supabase.functions.invoke as unknown as jest.Mock;

// Fakes for the chain supabase.from('profiles').select(...).eq(...).maybeSingle().
const select = jest.fn();
const eq = jest.fn();
const maybeSingle = jest.fn();

// The function Supabase would call on sign-in or sign-out, saved so tests can
// pretend those events happen.
let emitAuthChange: (event: string, session: unknown) => void = () => {};

const SESSION = { user: { id: 'user-1' } };
const PROFILE = { id: 'user-1', display_name: 'Ava', role: 'user', is_tester: false };

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  // By default the server says "not locked" (VC-30's age_gate_locked).
  rpc.mockResolvedValue({ data: false, error: null });
  auth.onAuthStateChange.mockImplementation((callback) => {
    emitAuthChange = callback;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
  auth.signOut.mockResolvedValue({ error: null });
  from.mockReturnValue({ select });
  select.mockReturnValue({ eq });
  eq.mockReturnValue({ maybeSingle });
});

/** Shows the status and some buttons, so tests can read and press them. */
function Probe() {
  const { status, profile, signOut, markAgeBlocked, deleteAccount } = useAuth();
  return (
    <>
      <Text>status:{status}</Text>
      <Text>name:{profile?.display_name ?? '-'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="out" onPress={signOut} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="locked"
        onPress={() => markAgeBlocked('locked')}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="deleted"
        onPress={() => markAgeBlocked('deleted')}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="delete account"
        onPress={() => void deleteAccount()}
      />
    </>
  );
}

/** Renders the probe inside the provider. */
async function renderProbe() {
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe('AuthProvider', () => {
  it('is signedOut when there is no saved login', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await renderProbe();
    expect(await screen.findByText('status:signedOut')).toBeOnTheScreen();
    expect(from).not.toHaveBeenCalled();
  });

  it('is needsProfile when signed in but the age gate is not done', async () => {
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await renderProbe();
    expect(await screen.findByText('status:needsProfile')).toBeOnTheScreen();
  });

  it('is ready with the profile, reading named columns only (never birthdate)', async () => {
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    maybeSingle.mockResolvedValue({ data: PROFILE, error: null });
    await renderProbe();
    expect(await screen.findByText('status:ready')).toBeOnTheScreen();
    expect(screen.getByText('name:Ava')).toBeOnTheScreen();

    expect(from).toHaveBeenCalledWith('profiles');
    const columns = select.mock.calls[0][0] as string;
    expect(columns).toBe('id, display_name, role, is_tester');
    expect(eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('is error (not needsProfile) when the profile fails to load', async () => {
    // Treating a network error as "no profile" would send an existing user
    // back to the age gate, so it must be its own state.
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    await renderProbe();
    expect(await screen.findByText('status:error')).toBeOnTheScreen();
  });

  it('follows sign-in and sign-out events', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    maybeSingle.mockResolvedValue({ data: PROFILE, error: null });
    await renderProbe();
    expect(await screen.findByText('status:signedOut')).toBeOnTheScreen();

    await act(async () => emitAuthChange('SIGNED_IN', SESSION));
    expect(await screen.findByText('status:ready')).toBeOnTheScreen();

    await act(async () => emitAuthChange('SIGNED_OUT', null));
    expect(await screen.findByText('status:signedOut')).toBeOnTheScreen();
  });

  it('signs out on this phone only', async () => {
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    maybeSingle.mockResolvedValue({ data: PROFILE, error: null });
    await renderProbe();
    await screen.findByText('status:ready');
    await fireEvent.press(screen.getByRole('button', { name: 'out' }));
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  // ---- VC-B12: recap notes name the user's events; sign-out removes them ----

  it('sign-out removes every waiting recap note before signing out (next person never sees them)', async () => {
    (Notifications as unknown as { __reset: () => void }).__reset();
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    maybeSingle.mockResolvedValue({ data: PROFILE, error: null });
    await offerRecapReminder({ id: 'e1', title: 'Rooftop' }, new Date('2026-10-17T23:00:00-04:00'));
    expect(await Notifications.getAllScheduledNotificationsAsync()).toHaveLength(1);
    // When Supabase signs out, the note must already be gone.
    auth.signOut.mockImplementation(async () => {
      expect(await Notifications.getAllScheduledNotificationsAsync()).toHaveLength(0);
      return { error: null };
    });
    await renderProbe();
    await screen.findByText('status:ready');
    await fireEvent.press(screen.getByRole('button', { name: 'out' }));
    expect(auth.signOut).toHaveBeenCalled();
    expect(await Notifications.getAllScheduledNotificationsAsync()).toHaveLength(0);
  });

  it('any other sign-out (expired login, age gate) also removes recap notes, delivered ones too', async () => {
    const fake = Notifications as unknown as {
      __reset: () => void;
      getPresentedNotificationsAsync: jest.Mock;
      dismissNotificationAsync: jest.Mock;
    };
    fake.__reset();
    fake.getPresentedNotificationsAsync.mockResolvedValue([
      { request: { identifier: 'recap-2026-10-18', content: { data: { kind: 'recap' } } } },
      { request: { identifier: 'other', content: { data: { kind: 'other' } } } },
    ]);
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    maybeSingle.mockResolvedValue({ data: PROFILE, error: null });
    await offerRecapReminder({ id: 'e1', title: 'Rooftop' }, new Date('2026-10-17T23:00:00-04:00'));
    await renderProbe();
    await screen.findByText('status:ready');
    await act(async () => emitAuthChange('SIGNED_OUT', null));
    expect(await screen.findByText('status:signedOut')).toBeOnTheScreen();
    expect(await Notifications.getAllScheduledNotificationsAsync()).toHaveLength(0);
    expect(fake.dismissNotificationAsync).toHaveBeenCalledWith('recap-2026-10-18');
    expect(fake.dismissNotificationAsync).not.toHaveBeenCalledWith('other');
  });
  // ---- VC-B13: account deletion clears the phone only after the server ----

  it('deleting the account calls the Edge Function, then removes recap notes and the saved login', async () => {
    (Notifications as unknown as { __reset: () => void }).__reset();
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    maybeSingle.mockResolvedValue({ data: PROFILE, error: null });
    invoke.mockResolvedValue({ data: { deleted: true }, error: null });
    await offerRecapReminder({ id: 'e1', title: 'Rooftop' }, new Date('2026-10-17T23:00:00-04:00'));
    await renderProbe();
    await screen.findByText('status:ready');
    await fireEvent.press(screen.getByRole('button', { name: 'delete account' }));
    // The app sends no id: the function deletes the token's owner only.
    expect(invoke).toHaveBeenCalledWith('delete-account', { method: 'POST' });
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' }));
    expect(await Notifications.getAllScheduledNotificationsAsync()).toHaveLength(0);
  });

  it('a failed deletion changes nothing on the phone (still signed in, notes kept)', async () => {
    (Notifications as unknown as { __reset: () => void }).__reset();
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    maybeSingle.mockResolvedValue({ data: PROFILE, error: null });
    invoke.mockResolvedValue({ data: null, error: { context: { status: 500 } } });
    await offerRecapReminder({ id: 'e1', title: 'Rooftop' }, new Date('2026-10-17T23:00:00-04:00'));
    await renderProbe();
    await screen.findByText('status:ready');
    await fireEvent.press(screen.getByRole('button', { name: 'delete account' }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    // Let the failed answer finish before checking nothing else happened.
    await act(async () => {});
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(await Notifications.getAllScheduledNotificationsAsync()).toHaveLength(1);
    expect(screen.getByText('status:ready')).toBeOnTheScreen();
  });

  // ---- VC-30: the lock after an under-18 answer ----------------------------

  it('is blocked when the server says this login was refused, and remembers it on the phone', async () => {
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    rpc.mockResolvedValue({ data: true, error: null });
    await renderProbe();
    expect(await screen.findByText('status:blocked')).toBeOnTheScreen();
    expect(rpc).toHaveBeenCalledWith('age_gate_locked');
    expect(await AsyncStorage.getItem(ageLockKey('user-1'))).toBe('1');
  });

  it('is blocked from the phone flag alone, without waiting for the server', async () => {
    await AsyncStorage.setItem(ageLockKey('user-1'), '1');
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await renderProbe();
    expect(await screen.findByText('status:blocked')).toBeOnTheScreen();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is error (not needsProfile) when the lock check fails, so the form is not shown by mistake', async () => {
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    rpc.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    await renderProbe();
    expect(await screen.findByText('status:error')).toBeOnTheScreen();
  });

  it('a 13-17 refusal blocks the login and sets the phone flag', async () => {
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await renderProbe();
    await screen.findByText('status:needsProfile');
    await fireEvent.press(screen.getByRole('button', { name: 'locked' }));
    expect(await screen.findByText('status:blocked')).toBeOnTheScreen();
    expect(await AsyncStorage.getItem(ageLockKey('user-1'))).toBe('1');
    // Not signed out: the login stays, so the lock holds on the next sign-in.
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('an under-13 refusal signs the phone out, keeps the sorry screen up, and stores nothing', async () => {
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await renderProbe();
    await screen.findByText('status:needsProfile');
    await fireEvent.press(screen.getByRole('button', { name: 'deleted' }));
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });

    // Supabase reports the sign-out; the sorry screen must stay up.
    await act(async () => emitAuthChange('SIGNED_OUT', null));
    expect(await screen.findByText('status:blocked')).toBeOnTheScreen();
    // Legal condition: nothing is kept about an under-13, not even on the phone.
    expect(await AsyncStorage.getAllKeys()).toEqual([]);

    // Dismissing it goes to sign-in.
    await fireEvent.press(screen.getByRole('button', { name: 'out' }));
    expect(await screen.findByText('status:signedOut')).toBeOnTheScreen();
  });
});
