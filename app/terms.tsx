/**
 * The Terms of Service screen (proposal VC-32b). Opened from Settings and
 * from the sign-in screen, so it is open to everyone (see app/_layout.tsx).
 * The words live in src/copy/legal.ts (TERMS).
 */
import { LegalDocumentView } from '@/components/LegalDocumentView';
import { TERMS } from '@/copy/legal';

/**
 * Renders the Terms of Service.
 *
 * @returns the screen.
 */
export default function TermsScreen() {
  return <LegalDocumentView doc={TERMS} />;
}
