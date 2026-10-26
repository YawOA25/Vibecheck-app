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
 * Our own error codes from `complete_profile` (see the migration
 * supabase/migrations/20261026160000_complete_profile.sql). Keep in sync.
 */
export const ProfileErrorCode = {
  under18: 'VCA18',
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
 * Says whether the server refused because the person is under 18.
 *
 * @param error - an error from `complete_profile`, or null.
 * @returns true only for the under-18 refusal.
 */
export function isUnder18Error(error: ErrorLike | null | undefined): boolean {
  return error?.code === ProfileErrorCode.under18;
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
 * Picks the message to show for an error from `complete_profile`.
 *
 * @param error - the error the database returned.
 * @returns one short sentence for the screen.
 */
export function describeProfileError(error: ErrorLike): string {
  if (isNetworkError(error)) return "Can't reach VibeCheck. Check your connection and try again.";
  switch (error.code) {
    case ProfileErrorCode.under18:
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
