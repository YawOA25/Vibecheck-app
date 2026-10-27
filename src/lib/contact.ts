/**
 * Contact settings (proposal VC-58).
 *
 * VENUE_CONTACT_EMAIL is the address venues and hosts can write to about a
 * heads-up tag (the legal review asks for a visible contact). It is empty on
 * purpose until the founder picks the address. While it is empty, the app
 * shows no email line at all; once it is set, the Heads-up card's report
 * area shows "Venue or host? Email <address>".
 *
 * To set it: put the address between the quotes below, e.g.
 *   export const VENUE_CONTACT_EMAIL = 'hello@example.com';
 * This is not a secret (it is shown in the app), so it lives in the code,
 * not in `.env`.
 */
export const VENUE_CONTACT_EMAIL = '';
