/**
 * The "Contact us" email link (proposal VC-32c, task VC-B13), shown on the
 * Settings screen and the 18+ gate's "sorry" screen.
 *
 * It reads SUPPORT_EMAIL from src/lib/contact.ts. While that is empty (the
 * founder hasn't picked an address yet), this renders NOTHING, so the
 * screens look complete without it. Once set, a tap opens the phone's email
 * app with the address filled in.
 */
import { Linking } from 'react-native';

import { Button } from '@/components/Button';
import { mailtoLink, SUPPORT_EMAIL } from '@/lib/contact';

/** What a SupportEmailLink needs. Both are optional. */
export interface SupportEmailLinkProps {
  /** The address; defaults to SUPPORT_EMAIL. Tests pass their own. */
  email?: string;
  /** The words before the address. Defaults to "Contact us". */
  label?: string;
}

/**
 * Renders the link, or nothing while no address is set.
 *
 * @returns a gold text link "Contact us: <address>", or null.
 */
export function SupportEmailLink({
  email = SUPPORT_EMAIL,
  label = 'Contact us',
}: SupportEmailLinkProps) {
  const link = mailtoLink(email);
  if (!link) return null;
  const address = email.trim();
  return (
    <Button
      label={`${label}: ${address}`}
      accessibilityLabel={`${label}, email ${address}`}
      variant="text"
      size="small"
      // A phone with no email app refuses the link; there's nothing more to
      // do then, and the address is on screen to copy by hand.
      onPress={() => {
        Linking.openURL(link).catch(() => undefined);
      }}
    />
  );
}
