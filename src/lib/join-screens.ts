/**
 * The words for the party-code screen (app/join/[id].tsx, task VC-B07).
 *
 * What it does: turns the server's answer to a party-code (or tester)
 * check-in into what the screen shows. Two kinds of answer:
 *   - a wrong code stays on the code form, with a sentence under the boxes
 *     saying how many tries are left ({@link wrongCodeMessage});
 *   - everything else (checked in, locked, outside the window, code off,
 *     a limit) replaces the form with a result: headline, sentence, buttons
 *     ({@link joinResultScreen}).
 *
 * Why a separate file: the same reasons as check-in-screens.ts. The wording
 * lives in one place, and tests can check every case without drawing.
 * Answers shared with GPS check-in (passed, too early, too late, the limits)
 * reuse the GPS screen's wording, so both ways read the same.
 */
import { resultScreen } from '@/lib/check-in-screens';
import type { ResultScreen } from '@/lib/check-in-screens';
import type { CodeCheckInResult } from '@/lib/code-check-in-api';
import { MAX_WRONG_CODES, PARTY_CODE_LENGTH } from '@/lib/code-check-in-api';

/** Shown when "Check me in" is tapped before all 6 characters are typed. */
export const INCOMPLETE_CODE_MESSAGE = `Enter all ${PARTY_CODE_LENGTH} characters of the party code.`;

/**
 * The sentence under the boxes after a wrong code.
 *
 * @param triesLeft - wrong tries left before entry locks (1 to 4).
 * @returns e.g. "That code didn't work. 3 tries left." The typed code is
 *   never repeated.
 */
export function wrongCodeMessage(triesLeft: number): string {
  return `That code didn't work. Check the card and try again. ${triesLeft} ${
    triesLeft === 1 ? 'try' : 'tries'
  } left.`;
}

/**
 * The result screen for an answer that ends the code form.
 *
 * @param result - the server's answer (anything except 'wrong_code').
 * @param eventTitle - the event's name, used in the sentences.
 * @returns the headline, sentence and buttons to show.
 */
export function joinResultScreen(
  result: Exclude<CodeCheckInResult, { status: 'wrong_code' }>,
  eventTitle: string,
): ResultScreen {
  switch (result.status) {
    case 'locked': {
      const minutes = result.retryAfterMinutes;
      return {
        lead: 'Code entry is',
        highlight: 'locked.',
        body: `That's ${MAX_WRONG_CODES} wrong codes in the last hour, so code entry for ${eventTitle} is paused. Try again in ${minutes} ${
          minutes === 1 ? 'minute' : 'minutes'
        }, or check in with your location.`,
        success: false,
        actions: [{ action: 'back', label: 'Back to the event' }],
      };
    }
    case 'code_off':
      return {
        lead: 'No party',
        highlight: 'code.',
        body: `${eventTitle} doesn't use a party code. Check in with your location instead.`,
        success: false,
        actions: [{ action: 'back', label: 'Back to the event' }],
      };
    default:
      // passed, outside_window and the two limits read exactly like GPS.
      return resultScreen({ source: 'server', result }, eventTitle);
  }
}
