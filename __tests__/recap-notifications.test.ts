/**
 * Tests for src/lib/recap-notifications.ts, the 11 AM recap note (VC-B12).
 *
 * expo-notifications is replaced by the fake in __mocks__/expo-notifications.js,
 * which keeps scheduled notes in a list. These tests check that:
 *   - permission is asked only when it hasn't been answered yet;
 *   - a "no" (now or earlier) schedules nothing and never throws;
 *   - the note is scheduled for 11 AM New York the next morning, with no
 *     score in its words;
 *   - two events the same night share one note; a re-rating doesn't repeat
 *     the event;
 *   - a phone error never escapes (the rating is already saved);
 *   - a tap on a recap note opens the recap; other notes are ignored; and
 *     a tap that started the app waits until the guest is signed in.
 */
import { renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import {
  isRecapTap,
  offerRecapReminder,
  useRecapNotificationTaps,
} from '@/lib/recap-notifications';

// The "mock" prefix lets jest.mock (which runs first) use this fake.
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

/** The fake's extra test helper and spies, typed loosely for the tests. */
const fake = Notifications as unknown as {
  __reset: () => void;
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  scheduleNotificationAsync: jest.Mock;
  getAllScheduledNotificationsAsync: jest.Mock;
  getLastNotificationResponse: jest.Mock;
  clearLastNotificationResponse: jest.Mock;
  addNotificationResponseReceivedListener: jest.Mock;
};

const SAT_11PM = new Date('2026-10-17T23:00:00-04:00');
const SUN_1AM = new Date('2026-10-18T01:00:00-04:00');

beforeEach(() => {
  fake.__reset();
  jest.clearAllMocks();
});

describe('offerRecapReminder', () => {
  it('already allowed: schedules for 11 AM New York the next morning, without asking', async () => {
    const result = await offerRecapReminder({ id: 'e1', title: 'Rooftop' }, SAT_11PM);
    expect(result).toBe('scheduled');
    expect(fake.requestPermissionsAsync).not.toHaveBeenCalled();
    const request = fake.scheduleNotificationAsync.mock.calls[0][0];
    expect(request.identifier).toBe('recap-2026-10-18');
    expect((request.trigger.date as Date).toISOString()).toBe('2026-10-18T15:00:00.000Z');
    expect(request.content.body).toBe('Your night at Rooftop is ready.');
    expect(request.content.data).toEqual({
      kind: 'recap',
      events: [{ id: 'e1', title: 'Rooftop' }],
    });
  });

  it('not asked yet: asks at this moment, then schedules if allowed', async () => {
    fake.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    expect(await offerRecapReminder({ id: 'e1', title: 'Rooftop' }, SAT_11PM)).toBe('scheduled');
    expect(fake.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('asked and refused: nothing scheduled, no error', async () => {
    fake.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    fake.requestPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    expect(await offerRecapReminder({ id: 'e1', title: 'Rooftop' }, SAT_11PM)).toBe('denied');
    expect(fake.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('refused before: does not nag (no second question), nothing scheduled', async () => {
    fake.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    expect(await offerRecapReminder({ id: 'e1', title: 'Rooftop' }, SAT_11PM)).toBe('denied');
    expect(fake.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(fake.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('two events the same night (one after midnight): one note naming both', async () => {
    await offerRecapReminder({ id: 'e1', title: 'Rooftop' }, SAT_11PM);
    await offerRecapReminder({ id: 'e2', title: 'Basement' }, SUN_1AM);
    const notes = await Notifications.getAllScheduledNotificationsAsync();
    expect(notes).toHaveLength(1);
    expect(notes[0].content.body).toBe('Your night at Rooftop + 1 more is ready.');
  });

  it("re-rating the same event (an update after 60 minutes) doesn't repeat it", async () => {
    await offerRecapReminder({ id: 'e1', title: 'Rooftop' }, SAT_11PM);
    await offerRecapReminder({ id: 'e1', title: 'Rooftop' }, SUN_1AM);
    const notes = await Notifications.getAllScheduledNotificationsAsync();
    expect(notes[0].content.body).toBe('Your night at Rooftop is ready.');
  });

  it('a phone error never escapes: "unavailable"', async () => {
    fake.scheduleNotificationAsync.mockRejectedValueOnce(new Error('not allowed in Expo Go'));
    expect(await offerRecapReminder({ id: 'e1', title: 'Rooftop' }, SAT_11PM)).toBe('unavailable');
  });
});

describe('isRecapTap', () => {
  /** A tap on a note carrying `data`. */
  const tap = (data: Record<string, unknown>) =>
    ({ notification: { request: { content: { data } } } }) as never;

  it('true for our recap note, false for anything else', () => {
    expect(isRecapTap(tap({ kind: 'recap', events: [] }))).toBe(true);
    expect(isRecapTap(tap({ kind: 'other' }))).toBe(false);
    expect(isRecapTap(null)).toBe(false);
  });
});

describe('useRecapNotificationTaps', () => {
  /** A tap on a recap note. */
  const recapTap = { notification: { request: { content: { data: { kind: 'recap' } } } } };

  it('a tap that started the app waits until the guest is ready, then opens the recap once', async () => {
    fake.getLastNotificationResponse.mockReturnValue(recapTap);
    const { rerender } = await renderHook<void, { ready: boolean }>(
      ({ ready }) => useRecapNotificationTaps(ready),
      {
        initialProps: { ready: false },
      },
    );
    expect(mockPush).not.toHaveBeenCalled();
    await rerender({ ready: true });
    expect(mockPush).toHaveBeenCalledWith('/recap');
    expect(fake.clearLastNotificationResponse).toHaveBeenCalled();
  });

  it('a tap while the app runs opens the recap', async () => {
    await renderHook(() => useRecapNotificationTaps(true));
    const listener = fake.addNotificationResponseReceivedListener.mock.calls[0][0];
    listener(recapTap);
    expect(mockPush).toHaveBeenCalledWith('/recap');
  });
});
