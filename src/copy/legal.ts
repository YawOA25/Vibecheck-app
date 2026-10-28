/**
 * The words of the in-app Terms of Service and Privacy Policy (proposal
 * VC-32b). This is the ONE file that holds them: the Terms and Privacy
 * screens (app/terms.tsx, app/privacy.tsx) only draw what is here.
 *
 * PLACEHOLDER TEXT. The legal-advisor is drafting the real wording, and the
 * founder approves it before outside testers see it. Until then every
 * section below says so, and `isDraft: true` puts a "Draft" note at the top
 * of each screen.
 *
 * How to swap in the real text (no other file changes):
 *   1. Replace each document's `sections` with the approved headings and
 *      paragraphs (one string per paragraph; plain text, no formatting).
 *   2. Set `updated` to the date the text takes effect, e.g. 'November 14, 2026'.
 *   3. Set `isDraft` to false.
 * A test (__tests__/legal-screens.test.tsx) fails while any section still
 * contains the word PLACEHOLDER but `isDraft` is false, so the draft note
 * can't be removed by accident before the text is replaced.
 */

/** One heading and its paragraphs. */
export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

/** A whole document: its title, date, draft flag and sections. */
export interface LegalDocument {
  title: string;
  /** "Last updated" date, written out for people (or '' while a draft). */
  updated: string;
  /** True while the text is placeholder: shows the "Draft" note. */
  isDraft: boolean;
  sections: LegalSection[];
}

/** Every placeholder paragraph says the same, so it is easy to search for. */
const PLACEHOLDER = 'PLACEHOLDER: the final text for this section is being written and approved.';

/** The Terms of Service (placeholder until the legal-advisor's draft is approved). */
export const TERMS: LegalDocument = {
  title: 'Terms of Service',
  updated: '',
  isDraft: true,
  sections: [
    { heading: 'Who can use VibeCheck', paragraphs: [PLACEHOLDER] },
    { heading: 'Your account', paragraphs: [PLACEHOLDER] },
    { heading: 'Ratings and heads-up tags', paragraphs: [PLACEHOLDER] },
    { heading: 'Rules for using the app', paragraphs: [PLACEHOLDER] },
    { heading: 'Events and venues', paragraphs: [PLACEHOLDER] },
    { heading: 'Ending your account', paragraphs: [PLACEHOLDER] },
    { heading: 'Changes to these terms', paragraphs: [PLACEHOLDER] },
    { heading: 'Contact', paragraphs: [PLACEHOLDER] },
  ],
};

/** The Privacy Policy (placeholder until the legal-advisor's draft is approved). */
export const PRIVACY: LegalDocument = {
  title: 'Privacy Policy',
  updated: '',
  isDraft: true,
  sections: [
    { heading: 'What we collect', paragraphs: [PLACEHOLDER] },
    { heading: 'Location', paragraphs: [PLACEHOLDER] },
    { heading: 'How we use it', paragraphs: [PLACEHOLDER] },
    { heading: 'Who can see your ratings', paragraphs: [PLACEHOLDER] },
    { heading: 'Who we share it with', paragraphs: [PLACEHOLDER] },
    { heading: 'How long we keep it', paragraphs: [PLACEHOLDER] },
    { heading: 'Deleting your account', paragraphs: [PLACEHOLDER] },
    { heading: 'Age requirement', paragraphs: [PLACEHOLDER] },
    { heading: 'Contact', paragraphs: [PLACEHOLDER] },
  ],
};
