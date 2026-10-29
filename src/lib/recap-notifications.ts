/**
 * The 11 AM "Your night is ready" notification (task VC-B12).
 *
 * LOCAL notifications only: the phone itself sets an alarm-like reminder.
 * There are no push tokens and no server involved, so nothing about the
 * guest leaves the phone for this.
 *
 * What lives here:
 *   - `offerRecapReminder`: called right after a rating is saved. It asks
 *     for notification permission at that moment (the only time we ever
 *     ask, as the plan says), then schedules the note for 11:00 New York
 *     time the next morning (src/lib/recap.ts, recapMorning). If the guest
 *     says no, nothing else happens: the recap is still on the Me screen.
 *   - `useRecapNotificationTaps`: when the guest taps the note, open the
 *     recap screen. Works when the app was closed (the tap started it) and
 *     when it was open in the background.
 *   - `showRecapWhileOpen`: if the app happens to be open at 11 AM, still
 *     show the banner.
 *
 * One note per morning: rating two events on one night gives a single note
 * naming both ("Your night at A + 1 more is ready"). The text never holds a
 * score, because it shows on the lock screen. And one morning per event
 * (Q8a): an update after 5 AM doesn't name the event on a second morning.
 */
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { morningKey, recapMorning, recapNotificationText } from '@/lib/recap';

/** Android groups notifications into "channels" the user can mute; this is ours. */
export const RECAP_CHANNEL_ID = 'recap';

/** Marks our notes, so a tap on anything else is ignored. */
const RECAP_KIND = 'recap';

/** What happened when we offered the reminder. */
export type RecapReminderResult =
  /** Scheduled for 11 AM. */
  | 'scheduled'
  /** The guest said no (now or before). The recap is still in Nights out. */
  | 'denied'
  /** The phone couldn't do it (web, or an unexpected error). */
  | 'unavailable';

/** One event named in a note: its id and title. */
interface NotedEvent {
  id: string;
  title: string;
}

/**
 * Reads the events already named in a scheduled note, ignoring anything
 * that doesn't look right (so an old or odd note can't break scheduling).
 *
 * @param data - the note's `data` object.
 * @returns the events, oldest first.
 */
function notedEvents(data: unknown): NotedEvent[] {
  if (!data || typeof data !== 'object') return [];
  const events = (data as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];
  return events.filter(
    (e): e is NotedEvent =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as NotedEvent).id === 'string' &&
      typeof (e as NotedEvent).title === 'string',
  );
}

/**
 * Asks for permission if we haven't yet, and says whether we may notify.
 *
 * @returns true when notifications are allowed (fully, or iOS's quiet
 *   "provisional" mode).
 */
async function allowNotifications(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  // iOS can allow quiet notes without a full "yes"; that's fine for us.
  // (The lint rule can't follow this enum through the library's
  // `export *` files; it does exist, see node_modules/expo-notifications.)
  // eslint-disable-next-line import/namespace
  if (current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return true;
  // Already said no: the phone won't show the question again, and we don't nag.
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return asked.granted;
}

/**
 * Offers the next-morning recap note, right after a rating is saved.
 *
 * @param event - the event just rated (its id and title).
 * @param ratedAt - when the rating was saved (defaults to now).
 * @returns what happened. It never throws: the rating is already saved, and
 *   a notification problem must never spoil the payoff screen.
 */
export async function offerRecapReminder(
  event: { id: string; title: string },
  ratedAt: Date = new Date(),
): Promise<RecapReminderResult> {
  if (Platform.OS === 'web') return 'unavailable';
  try {
    if (!(await allowNotifications())) return 'denied';

    // Android 8+ needs a channel before anything can be shown.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(RECAP_CHANNEL_ID, {
        name: 'Next-morning recap',
        // eslint-disable-next-line import/namespace -- same lint blind spot as above
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const morning = recapMorning(ratedAt);
    const identifier = `${RECAP_ID_PREFIX}${morningKey(morning)}`;

    // Already a note for that morning (another event the same night)? Add
    // this event to it. Scheduling with the same identifier replaces it.
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();

    // Q8a: one event, one morning. A night runs 5 AM to 5 AM, so a rating
    // update made after 5 AM counts toward the NEXT night and would point
    // at the morning after. If a note for an earlier morning still waiting
    // already names this event, keep that one and add nothing, so the same
    // event is never announced on two mornings.
    const alreadyNoted = scheduled.some(
      (n) =>
        n.identifier !== identifier &&
        n.identifier.startsWith(RECAP_ID_PREFIX) &&
        notedEvents(n.content.data).some((e) => e.id === event.id),
    );
    if (alreadyNoted) return 'scheduled';

    const existing = scheduled.find((n) => n.identifier === identifier);
    const events = notedEvents(existing?.content.data).filter((e) => e.id !== event.id);
    events.push({ id: event.id, title: event.title });

    const text = recapNotificationText(events.map((e) => e.title));
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: text.title,
        body: text.body,
        data: { kind: RECAP_KIND, events },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: morning,
        channelId: RECAP_CHANNEL_ID,
      },
    });
    return 'scheduled';
  } catch {
    // For example Expo Go limits, or the phone refusing the alarm. The
    // recap is still on the Me screen, so carry on quietly.
    return 'unavailable';
  }
}

/** Scheduled recap notes all have identifiers starting with this. */
const RECAP_ID_PREFIX = 'recap-';

/**
 * Removes every recap note from this phone: the ones still waiting for
 * 11 AM AND the ones already delivered and sitting in the notification list.
 * Called on sign-out (cto privacy fix, VC-B12): a note names the event, so
 * the next person to sign in on this phone must never see the last person's
 * night.
 *
 * @returns once done. It never throws: sign-out must always work.
 */
export async function cancelRecapReminders(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.identifier.startsWith(RECAP_ID_PREFIX))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      shown
        .filter((n) => (n.request.content.data as { kind?: unknown } | null)?.kind === RECAP_KIND)
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch {
    // Nothing more we can do here; signing out carries on regardless.
  }
}

/**
 * Says whether a tapped notification is one of our recap notes.
 *
 * @param response - the tap, from expo-notifications (or null).
 * @returns true for a recap note.
 */
export function isRecapTap(response: Notifications.NotificationResponse | null): boolean {
  const data = response?.notification.request.content.data as { kind?: unknown } | undefined;
  return data?.kind === RECAP_KIND;
}

/**
 * Opens the recap screen when the guest taps a recap note.
 *
 * @param ready - true once the guest is signed in and past the 18+ gate.
 *   Before that the recap screen doesn't exist, so the tap waits.
 * Returns nothing; it listens while mounted.
 */
export function useRecapNotificationTaps(ready: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (!ready || Platform.OS === 'web') return;

    /** Opens the recap for one tap, if it's ours. */
    const open = (response: Notifications.NotificationResponse | null) => {
      if (isRecapTap(response)) router.push('/recap');
    };

    // A tap that STARTED the app (it was closed). Clear it once handled, so
    // signing out and in again doesn't open the recap a second time.
    try {
      const first = Notifications.getLastNotificationResponse();
      if (first) {
        Notifications.clearLastNotificationResponse();
        open(first);
      }
    } catch {
      // Not available on this phone: taps while running still work below.
    }

    // Taps while the app is running (in the background or open).
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [ready, router]);
}

/**
 * If the app is open when the note fires, show it anyway (by default a
 * phone hides notifications from the app that's on screen). Called once,
 * when the app starts.
 */
export function showRecapWhileOpen(): void {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}
