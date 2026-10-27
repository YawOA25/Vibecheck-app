/**
 * The words and buttons for every result on the rating screen (task
 * VC-B08, wireframe S5 and the v3 Rate screen).
 *
 * What it does: takes "what happened" (the server's answer, the quiet GPS
 * re-check saying "far away", or the staff rule) and returns the headline,
 * the sentence and which buttons to show. The screen (app/rate/[id].tsx)
 * just draws it.
 *
 * Why a separate file: the same reasons as check-in-screens.ts. All the
 * wording sits in one place for the designer, and tests can check every
 * case without drawing anything.
 */
import type { HeadsUpResult, RatingResult } from '@/lib/ratings-api';
import { vibeLabel } from '@/lib/rating';
import { formatClock } from '@/lib/tonight';

/**
 * A button on a result:
 *   done     back to the event page
 *   checkIn  open the check-in screen (to check in, or again)
 */
export type RateAction = 'done' | 'checkIn';

/** What happened, from the server or the phone. */
export type RateView =
  /** The server's answer to submit_rating. */
  | { source: 'server'; result: RatingResult }
  /** The quiet GPS re-check said the guest is outside the party area. */
  | { source: 'tooFar' }
  /** The guest is an admin: staff can't rate (VC-05). */
  | { source: 'staff' };

/** Everything a result shows. */
export interface RateScreen {
  /** The plain first part of the headline. */
  lead: string;
  /** The part in the gold pill. */
  highlight: string;
  /** One or two sentences under the headline. */
  body: string;
  /** true for the payoff (saved), false otherwise. */
  success: boolean;
  /** Buttons, top to bottom; the first is the main (gold) one. */
  actions: { action: RateAction; label: string }[];
}

/** The main button after a save (exported so tests use the same text). */
export const DONE_LABEL = 'Done';
const BACK = { action: 'done' as const, label: 'Back to the event' };

/**
 * "1 minute" or "5 minutes".
 *
 * @param minutes - a whole number of minutes.
 * @returns the number with the right word.
 */
function minutesText(minutes: number): string {
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/**
 * The payoff sentence: how many others rated, and the guest's own vibe.
 *
 * @param raters - how many people's ratings count at the event (theirs too).
 * @param eventTitle - the event's name.
 * @returns e.g. "You and 4 others have rated Rooftop." or, for the first
 *   rater, "You're the first to rate Rooftop."
 */
export function payoffCrowdLine(raters: number, eventTitle: string): string {
  // `raters` includes this guest's own rating, so the others are one fewer.
  const others = Math.max(0, raters - 1);
  if (others === 0) return `You're the first to rate ${eventTitle}.`;
  return `You and ${others} ${others === 1 ? 'other' : 'others'} have rated ${eventTitle}.`;
}

/**
 * Builds the result for what happened.
 *
 * @param view - the server's answer, or a phone-side reason.
 * @param eventTitle - the event's name, used in the sentences.
 * @returns the headline, sentence and buttons.
 */
export function rateResultScreen(view: RateView, eventTitle: string): RateScreen {
  if (view.source === 'tooFar') {
    // The quiet re-check said "too far". We don't send the rating: ratings
    // are for people who are at the party right now.
    return {
      lead: 'You seem',
      highlight: 'far away.',
      body: `Your phone puts you outside the party area for ${eventTitle}, so we can't take a rating right now. Ratings are only for people who are there.`,
      success: false,
      actions: [BACK],
    };
  }
  if (view.source === 'staff') {
    return {
      lead: 'Admins',
      highlight: "can't rate.",
      body: "Staff ratings would skew the score, so admins can't rate events. Use your guest account to rate.",
      success: false,
      actions: [BACK],
    };
  }
  const result = view.result;
  switch (result.status) {
    case 'saved': {
      const score = result.score.toFixed(1);
      const nextAt = formatClock(new Date(result.nextUpdateAt));
      return {
        lead: 'Vibe',
        highlight: 'logged.',
        body: `${payoffCrowdLine(result.raters, eventTitle)} Your vibe: ${vibeLabel(result.score)} (${score}). You can update it after ${nextAt}.`,
        success: true,
        actions: [{ action: 'done', label: DONE_LABEL }],
      };
    }
    case 'too_soon':
      return tooSoonScreen(result.minutesLeft, result.nextUpdateAt, eventTitle);
    case 'not_checked_in':
      return {
        lead: 'Check in',
        highlight: 'first.',
        body: `Only guests who are at ${eventTitle} can rate it. Check in, then rate.`,
        success: false,
        actions: [{ action: 'checkIn', label: "I'm here" }, BACK],
      };
    case 'check_in_stale':
      return {
        lead: 'Still',
        highlight: 'here?',
        body: `It's been a while since you checked in to ${eventTitle}. Check in again, then rate.`,
        success: false,
        actions: [{ action: 'checkIn', label: 'Check in again' }, BACK],
      };
    case 'outside_window':
      return result.reason === 'too_early'
        ? {
            lead: 'A little',
            highlight: 'early.',
            body: `Rating for ${eventTitle} opens at ${formatClock(new Date(result.opensAt))}, 30 minutes before it starts.`,
            success: false,
            actions: [BACK],
          }
        : {
            lead: 'Rating has',
            highlight: 'closed.',
            body: `Rating for ${eventTitle} closed at ${formatClock(new Date(result.closesAt))}, an hour after it ended.`,
            success: false,
            actions: [BACK],
          };
  }
}

/**
 * The "already rated, update later" screen. Used for the server's
 * 'too_soon' and when the app already knows on opening.
 *
 * @param minutesLeft - whole minutes until an update is allowed.
 * @param nextUpdateAt - when an update is allowed (ISO text).
 * @param eventTitle - the event's name.
 * @returns the screen.
 */
export function tooSoonScreen(
  minutesLeft: number,
  nextUpdateAt: string,
  eventTitle: string,
): RateScreen {
  return {
    lead: 'Already',
    highlight: 'rated.',
    body: `You rated ${eventTitle} less than an hour ago. You can update your rating in ${minutesText(minutesLeft)} (after ${formatClock(new Date(nextUpdateAt))}).`,
    success: false,
    actions: [BACK],
  };
}

/**
 * The sentence shown on the event page when a heads-up "+1" (VC-43) isn't
 * taken.
 *
 * @param result - the server's "not now" answer to add_heads_up.
 * @returns a short sentence saying why and what to do.
 */
export function headsUpRefusalMessage(
  result: Exclude<HeadsUpResult, { status: 'added' } | { status: 'already' }>,
): string {
  switch (result.status) {
    case 'not_checked_in':
      return 'Check in first: only guests who are here can +1 a heads-up.';
    case 'check_in_stale':
      return "It's been a while since you checked in. Check in again to +1.";
    case 'outside_window':
      return result.reason === 'too_early'
        ? `Heads-ups open at ${formatClock(new Date(result.opensAt))}.`
        : 'Heads-ups are closed for this event.';
  }
}
