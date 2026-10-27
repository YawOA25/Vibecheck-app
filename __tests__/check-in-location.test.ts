/**
 * Tests for the check-in location reader (src/lib/check-in-location.ts),
 * task VC-B06: the permission-state handling.
 *
 * expo-location is replaced with a fake so we can play every permission
 * answer a phone can give. We check:
 *   - each phone answer maps to the right state (granted, approximate on
 *     Android and iPhone, denied-but-can-ask, blocked, never asked);
 *   - never asked, or "no but can ask again", shows the phone's question;
 *     blocked does not (it can't), and goes to Settings instead;
 *   - approximate location stops before any reading is taken;
 *   - location switched off, a slow fix (time limit), a missing accuracy
 *     and an error all end as "no usable fix", never a crash;
 *   - a good reading is handed back with its accuracy;
 *   - nothing is ever written to the console (no coordinates in logs).
 */
import * as Location from 'expo-location';
import type { LocationPermissionResponse } from 'expo-location';

import { classifyPermission, readLocationForCheckIn } from '@/lib/check-in-location';

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { High: 4 },
}));

const getPerm = Location.getForegroundPermissionsAsync as jest.Mock;
const askPerm = Location.requestForegroundPermissionsAsync as jest.Mock;
const servicesOn = Location.hasServicesEnabledAsync as jest.Mock;
const getPosition = Location.getCurrentPositionAsync as jest.Mock;

/**
 * Makes a fake permission answer.
 *
 * @param status - 'granted', 'denied' or 'undetermined'.
 * @param extra - other fields (canAskAgain, android, ios).
 * @returns a LocationPermissionResponse.
 */
function perm(
  status: 'granted' | 'denied' | 'undetermined',
  extra: Partial<LocationPermissionResponse> = {},
): LocationPermissionResponse {
  return {
    status,
    granted: status === 'granted',
    canAskAgain: true,
    expires: 'never',
    ...extra,
  } as LocationPermissionResponse;
}

/** A position the fake phone returns: about where a DC party might be. */
const POSITION = { coords: { latitude: 38.91234, longitude: -77.04321, accuracy: 18 } };

let consoleSpies: jest.SpyInstance[];

beforeEach(() => {
  jest.clearAllMocks();
  servicesOn.mockResolvedValue(true);
  getPosition.mockResolvedValue(POSITION);
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
    jest.spyOn(console, name).mockImplementation(() => {}),
  );
});

afterEach(() => {
  // Privacy: the reader must never print anything (it could be a position).
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

describe('classifyPermission', () => {
  it('reads precise permission as granted', () => {
    expect(classifyPermission(perm('granted', { android: { accuracy: 'fine' } }))).toBe('granted');
    expect(
      classifyPermission(perm('granted', { ios: { scope: 'whenInUse', accuracy: 'full' } })),
    ).toBe('granted');
  });

  it('reads Android "Approximate" and iPhone "Precise: Off" as approximate', () => {
    expect(classifyPermission(perm('granted', { android: { accuracy: 'coarse' } }))).toBe(
      'approximate',
    );
    expect(
      classifyPermission(perm('granted', { ios: { scope: 'whenInUse', accuracy: 'reduced' } })),
    ).toBe('approximate');
  });

  it('tells a "no" we may ask about again from a "no" only Settings can undo', () => {
    expect(classifyPermission(perm('denied', { canAskAgain: true }))).toBe('denied');
    expect(classifyPermission(perm('denied', { canAskAgain: false }))).toBe('blocked');
  });

  it('reads never-asked as undetermined', () => {
    expect(classifyPermission(perm('undetermined'))).toBe('undetermined');
  });
});

describe('readLocationForCheckIn', () => {
  it('asks when never asked, then returns one reading with its accuracy', async () => {
    getPerm.mockResolvedValue(perm('undetermined'));
    askPerm.mockResolvedValue(perm('granted'));
    await expect(readLocationForCheckIn()).resolves.toEqual({
      kind: 'reading',
      reading: { lat: 38.91234, lng: -77.04321, accuracyM: 18 },
    });
    expect(askPerm).toHaveBeenCalledTimes(1);
    expect(getPosition).toHaveBeenCalledWith({ accuracy: Location.Accuracy.High });
  });

  it("doesn't ask again when permission is already granted", async () => {
    getPerm.mockResolvedValue(perm('granted'));
    await expect(readLocationForCheckIn()).resolves.toMatchObject({ kind: 'reading' });
    expect(askPerm).not.toHaveBeenCalled();
  });

  it('asks again after an earlier "no" that the phone still allows us to ask about', async () => {
    getPerm.mockResolvedValue(perm('denied', { canAskAgain: true }));
    askPerm.mockResolvedValue(perm('granted'));
    await expect(readLocationForCheckIn()).resolves.toMatchObject({ kind: 'reading' });
    expect(askPerm).toHaveBeenCalledTimes(1);
  });

  it('reports denied when the person says no again', async () => {
    getPerm.mockResolvedValue(perm('undetermined'));
    askPerm.mockResolvedValue(perm('denied', { canAskAgain: true }));
    await expect(readLocationForCheckIn()).resolves.toEqual({ kind: 'denied' });
    expect(getPosition).not.toHaveBeenCalled();
  });

  it('reports blocked without asking when only Settings can change it', async () => {
    getPerm.mockResolvedValue(perm('denied', { canAskAgain: false }));
    await expect(readLocationForCheckIn()).resolves.toEqual({ kind: 'blocked' });
    expect(askPerm).not.toHaveBeenCalled();
    expect(getPosition).not.toHaveBeenCalled();
  });

  it('reports blocked when the question turns into "don\'t ask again"', async () => {
    getPerm.mockResolvedValue(perm('denied', { canAskAgain: true }));
    askPerm.mockResolvedValue(perm('denied', { canAskAgain: false }));
    await expect(readLocationForCheckIn()).resolves.toEqual({ kind: 'blocked' });
  });

  it('stops at approximate location (Android) without taking a reading', async () => {
    getPerm.mockResolvedValue(perm('undetermined'));
    askPerm.mockResolvedValue(perm('granted', { android: { accuracy: 'coarse' } }));
    await expect(readLocationForCheckIn()).resolves.toEqual({ kind: 'approximate' });
    expect(getPosition).not.toHaveBeenCalled();
  });

  it('reports location services switched off for the whole phone', async () => {
    getPerm.mockResolvedValue(perm('granted'));
    servicesOn.mockResolvedValue(false);
    await expect(readLocationForCheckIn()).resolves.toEqual({ kind: 'servicesOff' });
    expect(getPosition).not.toHaveBeenCalled();
  });

  it('gives up with "no fix" when the phone takes too long', async () => {
    getPerm.mockResolvedValue(perm('granted'));
    getPosition.mockReturnValue(new Promise(() => {}));
    await expect(readLocationForCheckIn(10)).resolves.toEqual({ kind: 'noFix' });
  });

  it('treats a reading without an accuracy as "no fix" (the server needs it)', async () => {
    getPerm.mockResolvedValue(perm('granted'));
    getPosition.mockResolvedValue({ coords: { ...POSITION.coords, accuracy: null } });
    await expect(readLocationForCheckIn()).resolves.toEqual({ kind: 'noFix' });
  });

  it('turns a phone error into "no fix" instead of crashing', async () => {
    getPerm.mockResolvedValue(perm('granted'));
    getPosition.mockRejectedValue(new Error('Location request failed'));
    await expect(readLocationForCheckIn()).resolves.toEqual({ kind: 'noFix' });
  });
});
