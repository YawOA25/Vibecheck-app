/**
 * The Privacy Policy screen (proposal VC-32b, task VC-B13's "privacy link").
 * Opened from Settings and from the sign-in screen, so it is open to
 * everyone (see app/_layout.tsx). The words live in src/copy/legal.ts
 * (PRIVACY).
 */
import { LegalDocumentView } from '@/components/LegalDocumentView';
import { PRIVACY } from '@/copy/legal';

/**
 * Renders the Privacy Policy.
 *
 * @returns the screen.
 */
export default function PrivacyScreen() {
  return <LegalDocumentView doc={PRIVACY} />;
}
