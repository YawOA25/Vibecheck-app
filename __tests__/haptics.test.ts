/**
 * Tests for the haptics wrapper (src/lib/haptics.ts), proposal VC-32d.
 *
 * expo-haptics is replaced with a fake, so no phone is needed. We check:
 *   - in Jest the wrapper is OFF by default, so no test ever buzzes;
 *   - once switched on, each tap asks expo-haptics for the right pattern
 *     (light impact, success, warning);
 *   - a failure (a rejected promise, or a thrown error from a missing
 *     native module) is swallowed: a missing buzz never breaks a screen.
 */
import * as Haptics from 'expo-haptics';

import { setHapticsEnabled, tapLight, tapSuccess, tapWarning } from '@/lib/haptics';

// A fake expo-haptics: the two calls we use, plus the enum values we pass.
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));

const impact = Haptics.impactAsync as jest.Mock;
const notify = Haptics.notificationAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

// Put the wrapper back to its Jest default (off) after every test.
afterEach(() => setHapticsEnabled(false));

describe('haptics wrapper', () => {
  it('does nothing in tests unless switched on', () => {
    tapLight();
    tapSuccess();
    tapWarning();
    expect(impact).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('asks for a light impact, a success and a warning', () => {
    setHapticsEnabled(true);
    tapLight();
    expect(impact).toHaveBeenCalledWith('light');
    tapSuccess();
    expect(notify).toHaveBeenLastCalledWith('success');
    tapWarning();
    expect(notify).toHaveBeenLastCalledWith('warning');
  });

  it('ignores a rejected vibration (e.g. no motor, or the web)', async () => {
    setHapticsEnabled(true);
    notify.mockReturnValueOnce(Promise.reject(new Error('not available')));
    expect(() => tapSuccess()).not.toThrow();
    // Let the rejection settle; an unhandled rejection would fail the run.
    await Promise.resolve();
  });

  it('ignores a thrown error (e.g. the native module is missing)', () => {
    setHapticsEnabled(true);
    impact.mockImplementationOnce(() => {
      throw new Error('native module missing');
    });
    expect(() => tapLight()).not.toThrow();
  });
});
