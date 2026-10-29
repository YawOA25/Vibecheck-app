/**
 * The old "/admin" address (VC-82): sends everyone to the Me tab.
 *
 * Why it exists: until VC-82, "/admin" was the Admin tab's hub (New event
 * and Reports). VC-82 removed that tab: New event is now the gold plus in
 * the bottom bar, and Reports lives on Me under "Admin tools" (admins
 * only). A saved link or an old notification could still open "/admin", so
 * instead of an "unmatched route" page it lands on Me (design spec section
 * 6, question 3).
 *
 * Who can reach it: the root layout lists it with the signed-in screens, so
 * a signed-out or blocked person is sent to their own screen first. A
 * normal guest lands on Me too, where no admin tools are shown; the admin
 * screens themselves stay locked in the root layout and on the server.
 */
import { Redirect } from 'expo-router';

/**
 * Renders nothing; replaces this address with "/me" straight away.
 *
 * @returns a redirect to the Me tab.
 */
export default function OldAdminAddress() {
  return <Redirect href="/me" />;
}
