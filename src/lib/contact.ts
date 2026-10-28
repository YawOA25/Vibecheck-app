/**
 * Contact settings (proposals VC-58 and VC-32c).
 *
 * Both addresses are empty on purpose until the founder picks them. While
 * one is empty, the app shows no line or link for it at all (nothing broken,
 * no "email us at" with a blank).
 *
 * VENUE_CONTACT_EMAIL (VC-58) is the address venues and hosts can write to
 * about a heads-up tag (the legal review asks for a visible contact). Once
 * set, the Heads-up card's report area shows "Venue or host? Email <address>".
 *
 * SUPPORT_EMAIL (VC-32c, VC-B13) is where guests write for help. Once set,
 * a "Contact us" link shows on the Settings screen and on the "sorry"
 * screen of the 18+ gate (src/components/SupportEmailLink.tsx).
 *
 * To set one: put the address between the quotes, e.g.
 *   export const SUPPORT_EMAIL = 'help@example.com';
 * These aren't secrets (they're shown in the app), so they live in the code,
 * not in `.env`.
 */
export const VENUE_CONTACT_EMAIL = '';

/** The guests' help address (see above). Empty = the link is hidden. */
export const SUPPORT_EMAIL = '';

/**
 * Builds the "open my email app" link for an address.
 *
 * @param email - the address (blank spaces around it are ignored).
 * @returns a `mailto:` link, or null when the address is empty, so callers
 *   can hide the link.
 */
export function mailtoLink(email: string): string | null {
  const address = email.trim();
  return address ? `mailto:${address}` : null;
}
