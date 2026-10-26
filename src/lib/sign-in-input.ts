/**
 * Small helpers that tidy up what people type on the sign-in screen.
 *
 * Why a separate file: route files in app/ should only hold screens, and
 * these rules are easier to test on their own.
 */

/** Supabase's email codes are 6 digits by default; a project can set up to 10. */
export const MIN_CODE_LENGTH = 6;
export const MAX_CODE_LENGTH = 10;

/**
 * Tidies an email address: removes spaces at the ends and lowercases it,
 * because email addresses aren't case-sensitive in practice.
 *
 * @param email - what was typed.
 * @returns the cleaned address, for example " Ava@X.com " -> "ava@x.com".
 */
export function cleanEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * A light check that text looks like an email address (something@something.tld).
 * The real check is that the code arrives.
 *
 * @param email - the cleaned address.
 * @returns true if it looks like an email address.
 */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Cleans what was typed or pasted in the code box: keeps digits only (so
 * "123 456" works) and cuts it to the longest code Supabase can send.
 *
 * @param text - what was typed or pasted.
 * @returns digits only, at most MAX_CODE_LENGTH of them.
 */
export function cleanCode(text: string): string {
  return text.replace(/\D/g, '').slice(0, MAX_CODE_LENGTH);
}
