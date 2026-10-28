/**
 * A stand-in for expo-notifications, used automatically by every Jest test
 * (Jest picks up files in a `__mocks__` folder next to node_modules that
 * match an installed package's name). Task VC-B12.
 *
 * Why: the real library talks to the phone's notification system, which
 * doesn't exist in Jest. This fake keeps scheduled notes in a list, so tests
 * can check what would be scheduled and when. Every function is a Jest spy
 * that tests can inspect or change (for example, to say permission was
 * refused). `__reset()` puts everything back to "allowed, nothing scheduled".
 */
let scheduled = [];

/** The permission answer the fake gives; tests may change it with mockResolvedValue. */
const granted = { granted: true, canAskAgain: true, status: 'granted' };

const Notifications = {
  /** Same values as the real enums, for the few our code reads. */
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { DEFAULT: 5 },
  IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3 },

  getPermissionsAsync: jest.fn(async () => granted),
  requestPermissionsAsync: jest.fn(async () => granted),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationHandler: jest.fn(),

  /** Lists the fake's scheduled notes (the same shape our code reads). */
  getAllScheduledNotificationsAsync: jest.fn(async () => scheduled.slice()),
  /** Adds a note, replacing one with the same identifier (like the phone). */
  scheduleNotificationAsync: jest.fn(async (request) => {
    scheduled = scheduled.filter((n) => n.identifier !== request.identifier);
    scheduled.push({
      identifier: request.identifier,
      content: request.content,
      trigger: request.trigger,
    });
    return request.identifier;
  }),

  /** Removes one waiting note by identifier (like the phone). */
  cancelScheduledNotificationAsync: jest.fn(async (identifier) => {
    scheduled = scheduled.filter((n) => n.identifier !== identifier);
  }),
  /** Delivered notes in the phone's list: none unless a test says so. */
  getPresentedNotificationsAsync: jest.fn(async () => []),
  dismissNotificationAsync: jest.fn(async () => undefined),

  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),

  /** Test helper: forget scheduled notes and restore the default answers. */
  __reset() {
    scheduled = [];
    Notifications.getPermissionsAsync.mockImplementation(async () => granted);
    Notifications.requestPermissionsAsync.mockImplementation(async () => granted);
    Notifications.getLastNotificationResponse.mockImplementation(() => null);
    Notifications.getPresentedNotificationsAsync.mockImplementation(async () => []);
  },
};

module.exports = Notifications;
