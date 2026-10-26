/**
 * Tests for the phone's copy of the age-gate lock (src/lib/age-lock.ts), VC-30.
 *
 * Supabase is faked, and phone storage uses the in-memory fake that the
 * AsyncStorage package ships for tests. We check the order of checks (phone
 * first, then server), that the server's "locked" is copied to the phone
 * (so it survives going offline), and that a failed check is reported as an
 * error rather than guessed as "not locked".
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ageLockKey, checkAgeLock, rememberAgeLock } from '@/lib/age-lock';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const rpc = supabase.rpc as unknown as jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('age lock', () => {
  it('stores only a yes flag under the login id (no birthdate)', async () => {
    await rememberAgeLock('user-1');
    expect(await AsyncStorage.getAllKeys()).toEqual([ageLockKey('user-1')]);
    expect(await AsyncStorage.getItem(ageLockKey('user-1'))).toBe('1');
  });

  it('answers from the phone flag without asking the server', async () => {
    await rememberAgeLock('user-1');
    expect(await checkAgeLock('user-1')).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('asks the server when the phone has no flag, and copies a "locked" answer back', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await checkAgeLock('user-1')).toBe(true);
    expect(rpc).toHaveBeenCalledWith('age_gate_locked');
    expect(await AsyncStorage.getItem(ageLockKey('user-1'))).toBe('1');
  });

  it('is not locked when the server says no', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await checkAgeLock('user-1')).toBe(false);
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it('reports an error (not "unlocked") when the server cannot be reached', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    expect(await checkAgeLock('user-1')).toBe('error');
  });

  it('keeps flags separate per login', async () => {
    await rememberAgeLock('user-1');
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await checkAgeLock('user-2')).toBe(false);
  });
});
