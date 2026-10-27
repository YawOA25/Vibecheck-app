/**
 * The search behind the State lookup on the admin event form (VC-37
 * follow-up, spec team/projects/vibecheck/design/state-lookup-spec.md).
 *
 * What it does: turns what the admin typed into at most three rows (DC,
 * Maryland, Virginia), the only states we run in for now. Anything else
 * gives no rows, and the form shows a "not yet" line instead.
 *
 * How matching works (spec section 1):
 *   - capitals, spaces at the ends, dots and commas are ignored, so "D.C."
 *     and "dc" are the same;
 *   - the typed text must match the START of a word in one of the state's
 *     search terms ("virg" finds Virginia, "inia" doesn't);
 *   - each state has a few search terms (aliases), e.g. "district" and
 *     "wash" both find DC;
 *   - before matching, the text is checked against the names of the other
 *     47 states. "West Virginia" contains the word "virginia" but must NOT
 *     offer Virginia, so a name like that is rejected first.
 *
 * Why it's a plain function (not inside the component): it's the logic
 * that matters, so it's easy to test on its own.
 */
import { AREA_STATES } from '@/data/dmv-areas';
import type { AreaState } from '@/data/dmv-areas';

/** One row in the State suggestions. */
export interface StateMatch {
  /** The code saved on the event ('DC', 'MD' or 'VA'). */
  code: AreaState;
  /** What the row shows, e.g. "Virginia", or "DC (Washington)" for "wash". */
  label: string;
  /** What a screen reader says for the row, e.g. "District of Columbia (DC)". */
  accessibilityLabel: string;
}

/**
 * The words each supported state can be found by. "Washington" terms are
 * kept apart for DC because a row found only through them reads
 * "DC (Washington)", so nobody thinks it means Washington state.
 */
const STATE_TERMS: Record<AreaState, { main: string[]; washington: string[] }> = {
  DC: {
    main: ['DC', 'D.C.', 'District of Columbia'],
    washington: ['Washington DC', 'Washington, DC'],
  },
  MD: { main: ['MD', 'Maryland'], washington: [] },
  VA: { main: ['VA', 'Virginia'], washington: [] },
};

/** What a screen reader says for each row (DC is spelled out). */
const SPOKEN_NAMES: Record<AreaState, string> = {
  DC: 'District of Columbia (DC)',
  MD: 'Maryland',
  VA: 'Virginia',
};

/**
 * The states we don't support yet (the other 47, plus "Washington State").
 * Only needed to stop false matches like "West Virginia" -> Virginia; any
 * other unmatched text gets the same "not yet" line anyway.
 */
const UNSUPPORTED_STATES: readonly string[] = [
  'Alabama',
  'Alaska',
  'Arizona',
  'Arkansas',
  'California',
  'Colorado',
  'Connecticut',
  'Delaware',
  'Florida',
  'Georgia',
  'Hawaii',
  'Idaho',
  'Illinois',
  'Indiana',
  'Iowa',
  'Kansas',
  'Kentucky',
  'Louisiana',
  'Maine',
  'Massachusetts',
  'Michigan',
  'Minnesota',
  'Mississippi',
  'Missouri',
  'Montana',
  'Nebraska',
  'Nevada',
  'New Hampshire',
  'New Jersey',
  'New Mexico',
  'New York',
  'North Carolina',
  'North Dakota',
  'Ohio',
  'Oklahoma',
  'Oregon',
  'Pennsylvania',
  'Rhode Island',
  'South Carolina',
  'South Dakota',
  'Tennessee',
  'Texas',
  'Utah',
  'Vermont',
  'Washington',
  'Washington State',
  'West Virginia',
  'Wisconsin',
  'Wyoming',
];

/**
 * Puts text into its search form: lower case, no dots or commas, single
 * spaces, no spaces at the ends.
 *
 * @param text - any text, typed or from the lists above.
 * @returns e.g. "Washington, D.C. " -> "washington dc".
 */
export function stateSearchForm(text: string): string {
  return text.toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Whether the typed text matches the start of any word in a term.
 *
 * @param typed - the typed text, already in search form (not empty).
 * @param term - a search term, already in search form.
 * @returns true when, e.g., typed "of col" and term "district of columbia".
 */
function matchesWordStart(typed: string, term: string): boolean {
  // Try the term from each word's first letter: the whole term, then after
  // each space. Typed text may run over several words ("washington d").
  for (let i = 0; i < term.length; i += 1) {
    const atWordStart = i === 0 || term[i - 1] === ' ';
    if (atWordStart && term.startsWith(typed, i)) return true;
  }
  return false;
}

/**
 * Whether the text is (or starts with) the name of a state we don't
 * support, and isn't also the start of one of our own terms.
 *
 * Why the second part: "washington" is a state name, but it's also how
 * "Washington DC" starts, so it should still find DC. "washington state"
 * isn't the start of any of our terms, so it's rejected.
 *
 * @param typed - the typed text, in search form.
 * @returns true when the "not yet" line should show.
 */
function isUnsupportedState(typed: string): boolean {
  const startsOurTerm = Object.values(STATE_TERMS).some(({ main, washington }) =>
    [...main, ...washington].some((term) => stateSearchForm(term).startsWith(typed)),
  );
  if (startsOurTerm) return false;
  return UNSUPPORTED_STATES.some((name) => typed.startsWith(stateSearchForm(name)));
}

/**
 * Finds the State rows for what the admin typed.
 *
 * @param query - the text in the State box.
 * @returns up to three rows, always in the order DC, Maryland, Virginia.
 *   Empty when nothing is typed (search-first) or nothing matches; the
 *   form then shows nothing, or the "not yet" line.
 */
export function searchStates(query: string): StateMatch[] {
  const typed = stateSearchForm(query);
  if (typed === '' || isUnsupportedState(typed)) return [];

  const matches: StateMatch[] = [];
  for (const { code, name } of AREA_STATES) {
    const { main, washington } = STATE_TERMS[code];
    const byMain = main.some((term) => matchesWordStart(typed, stateSearchForm(term)));
    const byWashington = washington.some((term) => matchesWordStart(typed, stateSearchForm(term)));
    if (!byMain && !byWashington) continue;
    matches.push({
      code,
      // Found only through "Washington ...": say it's DC, the city.
      label: !byMain && byWashington ? `${name} (Washington)` : name,
      accessibilityLabel: SPOKEN_NAMES[code],
    });
  }
  return matches;
}

/**
 * The name the State box shows for a picked state.
 *
 * @param code - a state code, or null for none.
 * @returns "DC", "Maryland" or "Virginia", or '' for none.
 */
export function stateName(code: AreaState | null): string {
  return AREA_STATES.find((s) => s.code === code)?.name ?? '';
}
