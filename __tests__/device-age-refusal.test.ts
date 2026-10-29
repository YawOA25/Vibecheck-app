/**
 * Tests for src/lib/device-age-refusal.ts (VC-74): the phone's own note
 * that an age answer was refused on the first sign-up screen.
 *
 * Phone storage is the AsyncStorage package's own in-memory test fake.
 * We check that only a time is stored, that the note counts for 12 months
 * and is then removed, and that storage failures never throw.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEVICE_REFUSAL_KEY,
  DEVICE_REFUSAL_MS,
  hasRecentDeviceRefusal,
  rememberDeviceRefusal,
} from '@/lib/device-age-refusal';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// A fixed moment, so the tests don't depend on today's date.
const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);

beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
});

describe('device age refusal note', () => {
  it('is absent on a fresh phone', async () => {
    expect(await hasRecentDeviceRefusal(T0)).toBe(false);
  });

  it('stores only the refusal time, under one fixed key', async () => {
    await rememberDeviceRefusal(T0);
    expect(await AsyncStorage.getAllKeys()).toEqual([DEVICE_REFUSAL_KEY]);
    expect(await AsyncStorage.getItem(DEVICE_REFUSAL_KEY)).toBe(String(T0));
  });

  it('counts for 12 months (365 days), then is removed', async () => {
    await rememberDeviceRefusal(T0);
    expect(await hasRecentDeviceRefusal(T0 + DEVICE_REFUSAL_MS - 1)).toBe(true);
    expect(await hasRecentDeviceRefusal(T0 + DEVICE_REFUSAL_MS)).toBe(false);
    // Nothing is kept longer than needed.
    expect(await AsyncStorage.getItem(DEVICE_REFUSAL_KEY)).toBeNull();
  });

  it('ignores and removes a broken note', async () => {
    await AsyncStorage.setItem(DEVICE_REFUSAL_KEY, 'not-a-time');
    expect(await hasRecentDeviceRefusal(T0)).toBe(false);
    expect(await AsyncStorage.getItem(DEVICE_REFUSAL_KEY)).toBeNull();
  });

  it('never throws when phone storage fails', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('disk full'));
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('disk full'));
    await expect(rememberDeviceRefusal(T0)).resolves.toBeUndefined();
    await expect(hasRecentDeviceRefusal(T0)).resolves.toBe(false);
  });
});
