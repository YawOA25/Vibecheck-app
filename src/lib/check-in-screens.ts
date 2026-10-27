/**
 * The words and buttons for every check-in result screen (task VC-B06,
 * wireframe S4 in the v3 look).
 *
 * What it does: takes "what happened" (a permission problem, a GPS problem,
 * or the server's answer) and returns the headline, the sentence under it
 * and which buttons to show. The screen (app/check-in/[id].tsx) just draws
 * whatever this returns.
 *
 * Why a separate file: it keeps the screen simple, keeps all the wording in
 * one place for the designer, and lets tests check every case without
 * drawing anything.
 */
import type { CheckInResult } from '@/lib/check-in-api';
import type { ReadingOutcome } from '@/lib/check-in-location';
import { formatClock } from '@/lib/tonight';

/** What happened, from either the phone or the server. */
export type CheckInView =
  /** A phone-side reason there's no usable reading (never sent to the server). */
  | { source: 'phone'; kind: Exclude<ReadingOutcome['kind'], 'reading'> }
  /** The server's answer. */
  | { source: 'server'; result: CheckInResult };

/**
 * A button on a result screen:
 *   retry     take a new reading and try again ("Try again" or "Allow location")
 *   settings  open the phone's Settings for VibeCheck
 *   code      the party-code fallback (task VC-B07)
 *   back      back to the event page
 *   rate      open the rating screen (task VC-B08), after a check-in
 */
export type CheckInAction = 'retry' | 'settings' | 'code' | 'back' | 'rate';

/** One button: what it does and the words on it. */
export interface ActionButton {
  action: CheckInAction;
  label: string;
}

/** Everything a result screen shows. */
export interface ResultScreen {
  /** The plain first part of the headline. */
  lead: string;
  /** The part in the gold pill. */
  highlight: string;
  /** One or two sentences under the headline. */
  body: string;
  /** true for good news (passed), false for "not this time". */
  success: boolean;
  /** Buttons, top to bottom; the first is the main (gold) one. */
  actions: ActionButton[];
}

/** The most different events someone may check in to in 24 hours (server rule). */
export const MAX_EVENTS_PER_DAY = 8;

/** The sentence on the "GPS check-in is off" screen (VC-36). */
export const GPS_LOCKED_BODY = 'GPS check-in is off for this event. Enter the party code.';

/** Reused button labels. */
const BACK: ActionButton = { action: 'back', label: 'Back to the event' };
const RETRY: ActionButton = { action: 'retry', label: 'Try again' };
const CODE: ActionButton = { action: 'code', label: 'Enter the party code' };
const SETTINGS: ActionButton = { action: 'settings', label: 'Open Settings' };
/** The label of the button that opens the rating screen (exported for tests). */
export const RATE_THE_NIGHT = 'Rate the night';
const RATE: ActionButton = { action: 'rate', label: RATE_THE_NIGHT };

/**
 * Builds the result screen for what happened.
 *
 * @param view - the phone-side reason or the server's answer.
 * @param eventTitle - the event's name, used in the sentences.
 * @returns the headline, sentence and buttons to show.
 */
export function resultScreen(view: CheckInView, eventTitle: string): ResultScreen {
  if (view.source === 'phone') return phoneScreen(view.kind);
  const result = view.result;
  switch (result.status) {
    case 'passed':
      return {
        lead: "You're",
        highlight: 'in.',
        body: result.alreadyCheckedIn
          ? `You're still checked in to ${eventTitle}.`
          : `You're checked in to ${eventTitle}. Heading somewhere else later? You can check in there too.`,
        success: true,
        // Wireframe S4: "Rate the night" first, then a quiet way back.
        actions: [RATE, BACK],
      };
    case 'too_far':
      return {
        lead: 'You seem',
        highlight: 'far away.',
        body: `Your phone puts you outside the party area for ${eventTitle}. Move closer and try again, or pick a different event.`,
        success: false,
        actions: [RETRY, BACK],
      };
    case 'weak_signal':
      return weakSignalScreen();
    case 'outside_window':
      return result.reason === 'too_early'
        ? {
            lead: 'A little',
            highlight: 'early.',
            body: `Check-in for ${eventTitle} opens at ${formatClock(new Date(result.opensAt))}, 30 minutes before it starts.`,
            success: false,
            actions: [BACK],
          }
        : {
            lead: 'Check-in has',
            highlight: 'closed.',
            body: `Check-in for ${eventTitle} closed at ${formatClock(new Date(result.closesAt))}, an hour after it ended.`,
            success: false,
            actions: [BACK],
          };
    case 'too_many_attempts': {
      const minutes = result.retryAfterMinutes;
      return {
        lead: 'Too many',
        highlight: 'tries.',
        body: `You've tried a lot in the last hour. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
        success: false,
        actions: [BACK],
      };
    }
    case 'too_many_events':
      return {
        lead: "That's a",
        highlight: 'big night.',
        body: `You've checked in to ${MAX_EVENTS_PER_DAY} events in the last 24 hours, the most we allow. You can still go back to events you've already checked in to.`,
        success: false,
        actions: [BACK],
      };
    case 'gps_locked':
      // VC-36: after 5 "too far" answers for this event, the server won't
      // judge GPS for this person again (so nobody can hunt for a private
      // party's pin). The party code is the way in, so it's the main button.
      // No "Try again": GPS would give the same answer all night.
      return {
        lead: 'GPS check-in',
        highlight: 'is off.',
        body: GPS_LOCKED_BODY,
        success: false,
        actions: [CODE, BACK],
      };
  }
}

/**
 * The weak-signal screen, shared by the server's 'weak_signal' answer and the
 * phone's "no fix" (couldn't get a position in time).
 *
 * @returns the screen, offering the party code.
 */
function weakSignalScreen(): ResultScreen {
  return {
    lead: 'Weak',
    highlight: 'signal.',
    body: "We couldn't pin down where you are. That happens indoors. Step near a window and try again, or ask the host for the party code.",
    success: false,
    actions: [RETRY, CODE, BACK],
  };
}

/**
 * Screens for phone-side problems (permission, location switched off, no fix).
 *
 * @param kind - why the phone has no usable reading.
 * @returns the screen.
 */
function phoneScreen(kind: Exclude<ReadingOutcome['kind'], 'reading'>): ResultScreen {
  switch (kind) {
    case 'denied':
      // "Ask again later": the phone still lets us ask, so the main button
      // shows the phone's question again. "Not now" just goes back.
      return {
        lead: 'Location',
        highlight: 'needed.',
        body: "We check your location once, only when you tap \"I'm here\", to confirm you're at the party. We don't track you or save where you are.",
        success: false,
        actions: [
          { action: 'retry', label: 'Allow location' },
          CODE,
          { action: 'back', label: 'Not now' },
        ],
      };
    case 'blocked':
      return {
        lead: 'Location is',
        highlight: 'off.',
        body: 'Location access for VibeCheck is turned off. Turn it on in Settings ("While using the app"), then try again. Or use the party code.',
        success: false,
        actions: [SETTINGS, RETRY, CODE],
      };
    case 'approximate':
      // Approximate location is a few kilometres wide: as good as a weak
      // signal. We don't send it to the server at all.
      return {
        lead: 'Precise location',
        highlight: 'is off.',
        body: 'VibeCheck can only see your approximate location, which is too rough to check you in. Turn on Precise location for VibeCheck in Settings, then try again. Or use the party code.',
        success: false,
        actions: [SETTINGS, RETRY, CODE],
      };
    case 'servicesOff':
      return {
        lead: 'Location services',
        highlight: 'are off.',
        body: "Your phone's location is switched off. Turn it on in Settings, then try again. Or use the party code.",
        success: false,
        actions: [SETTINGS, RETRY, CODE],
      };
    case 'noFix':
      return weakSignalScreen();
  }
}
