/**
 * Turns errors from Supabase into short, friendly messages for the screens.
 *
 * Why this file exists: errors arrive with technical codes such as
 * "over_email_send_rate_limit" or our own database codes such as "VCA18".
 * People should see plain words, and the screens shouldn't each repeat this
 * list.
 */

/**
 * The parts of an error we look at. Supabase's login errors and database
 * errors both have a `code` and a `message`; login errors may also have an
 * HTTP `status` (429 = too many requests).
 */
export interface ErrorLike {
  code?: string;
  message?: string;
  status?: number;
  name?: string;
}

/**
 * Our own error codes from `complete_profile` (see the migrations
 * supabase/migrations/20261026160000_complete_profile.sql and
 * 20261026170000_age_gate_lock.sql). Keep in sync.
 */
export const ProfileErrorCode = {
  // Version 1 of complete_profile raised this for under-18 answers. Version 2
  // returns a refusal instead, but we still understand it, just in case.
  under18: 'VCA18',
  // VC-30: this login was refused by the age gate before; nothing is accepted.
  locked: 'VCLCK',
  badName: 'VCNAM',
  badBirthdate: 'VCDOB',
  alreadyDone: 'VCDUP',
} as const;

/** Shown when something fails and we don't recognise why. */
const FALLBACK = 'Something went wrong. Please try again.';

/**
 * Says whether an error looks like "no internet" rather than a refusal.
 *
 * @param error - the error to inspect.
 * @returns true for network failures.
 */
function isNetworkError(error: ErrorLike): boolean {
  // supabase-js marks network failures as "AuthRetryableFetchError" (login)
  // or passes through the phone's "Network request failed" message (database).
  return (
    error.name === 'AuthRetryableFetchError' ||
    /network request failed|failed to fetch/i.test(error.message ?? '')
  );
}

/**
 * Says whether the server refused because the person is under 18, either now
 * (VCA18) or earlier (VCLCK: the login is locked).
 *
 * @param error - an error from `complete_profile`, or null.
 * @returns true only for the age refusals.
 */
export function isUnder18Error(error: ErrorLike | null | undefined): boolean {
  return error?.code === ProfileErrorCode.under18 || error?.code === ProfileErrorCode.locked;
}

/**
 * Picks the message to show for a sign-in error (sending or checking the code).
 *
 * @param error - the error Supabase returned.
 * @returns one short sentence for the screen.
 */
export function describeSignInError(error: ErrorLike): string {
  if (isNetworkError(error)) return "Can't reach VibeCheck. Check your connection and try again.";
  switch (error.code) {
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many codes asked for. Please wait a few minutes and try again.';
    // Supabase uses one code for both "wrong" and "expired".
    case 'otp_expired':
      return "That code didn't work. Check it, or ask for a new one.";
    case 'email_address_invalid':
    case 'validation_failed':
      return "That email address doesn't look right.";
    // Until real email delivery is set up (task VC-B11), Supabase only sends
    // sign-in emails to members of the founder's Supabase team.
    case 'email_address_not_authorized':
      return "Sign-in emails can only go to the VibeCheck team's addresses for now.";
  }
  if (error.status === 429) {
    return 'Too many tries. Please wait a few minutes and try again.';
  }
  return FALLBACK;
}

/**
 * Picks the message to show for an error from the reviewer email-and-password
 * sign-in (task B14, brought forward for founder testing on 2026-10-26).
 *
 * @param error - the error Supabase returned from `signInWithPassword`.
 * @returns one short sentence for the screen. It never repeats what was
 *   typed, so the password can't end up on screen or in a log.
 */
export function describePasswordSignInError(error: ErrorLike): string {
  if (isNetworkError(error)) return "Can't reach VibeCheck. Check your connection and try again.";
  switch (error.code) {
    // Supabase uses one code for "no such user" and "wrong password", on
    // purpose, so nobody can find out which emails have an account.
    case 'invalid_credentials':
      return "That email and password don't match. Check them and try again.";
    case 'email_not_confirmed':
      return 'This test account is not confirmed yet. Confirm it in the Supabase dashboard.';
    case 'over_request_rate_limit':
      return 'Too many tries. Please wait a few minutes and try again.';
  }
  if (error.status === 429) return 'Too many tries. Please wait a few minutes and try again.';
  // Older Supabase versions send no code, only this message.
  if (/invalid login credentials/i.test(error.message ?? '')) {
    return "That email and password don't match. Check them and try again.";
  }
  return FALLBACK;
}

/**
 * Picks the message to show for an error from `complete_profile`.
 *
 * @param error - the error the database returned.
 * @returns one short sentence for the screen.
 */
export function describeProfileError(error: ErrorLike): string {
  if (isNetworkError(error)) return "Can't reach VibeCheck. Check your connection and try again.";
  switch (error.code) {
    case ProfileErrorCode.under18:
    case ProfileErrorCode.locked:
      return 'Sorry, VibeCheck is for people 18 and older.';
    case ProfileErrorCode.badName:
      return 'Please enter a name of 1 to 40 characters.';
    case ProfileErrorCode.badBirthdate:
      return 'Please enter a valid date of birth.';
    case ProfileErrorCode.alreadyDone:
      return 'Your profile is already set up.';
    // 42501 = "insufficient privilege": the login has expired or is missing.
    case '42501':
      return 'Please sign in again.';
  }
  return FALLBACK;
}
