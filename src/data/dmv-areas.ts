/**
 * The curated list of DMV neighbourhoods for the admin event form's Area
 * search, each tagged with its state, plus a rough offline "which state is
 * this map pin in?" check (proposal VC-37, approved by the founder
 * 2026-10-27, with the state-first clarification of the same day).
 *
 * What it is: about 50 neighbourhood labels across DC, Maryland and
 * Virginia (the DMV, plus Baltimore and Richmond since VC-62), written the way guests see them on the Tonight list and event
 * page ("Shaw, DC"). The admin picks the state, types, and picks a match;
 * anything missing goes in through "Use '<what they typed>'", which still
 * follows the free-text rules (no house numbers, 60 characters at most).
 *
 * Why a fixed list in the app: consistent names (no "Shaw DC" vs "shaw,
 * dc"), no typos, no house numbers, and no paid places service or API terms.
 * Adding a name is a one-line change here.
 *
 * Sources: the team's own list of DMV nightlife areas (proposal VC-37),
 * cross-checked against common neighbourhood names used by the DC Office of
 * Planning's neighbourhood clusters, Montgomery and Prince George's County
 * place names, and Arlington and Alexandria's named neighbourhoods. The
 * Baltimore and Richmond names (VC-62, approved 2026-10-27, for staff
 * picks there) are their best-known nightlife neighbourhoods. These are
 * everyday names, not legal boundaries.
 *
 * Rules every label follows (the server checks the last two again):
 *   - "<Neighbourhood>, <DC|MD|VA>", ending with its own state's code;
 *   - 60 characters or fewer;
 *   - never starts with a number (that looks like a street address).
 */

/** The three states, as saved in events.state (migration 12). */
export type AreaState = 'DC' | 'MD' | 'VA';

/** The states in the order the form shows them, with their button words. */
export const AREA_STATES: readonly { code: AreaState; name: string }[] = [
  { code: 'DC', name: 'DC' },
  { code: 'MD', name: 'Maryland' },
  { code: 'VA', name: 'Virginia' },
];

/** One neighbourhood in the list. */
export interface DmvArea {
  /** What guests see, e.g. "Shaw, DC". */
  label: string;
  /** Which state it's in. */
  state: AreaState;
}

/**
 * Builds the list entries for one state.
 *
 * @param state - the state code.
 * @param names - neighbourhood names without the ending, e.g. "Shaw".
 * @returns entries whose labels end with ", <state>".
 */
function inState(state: AreaState, names: string[]): DmvArea[] {
  return names.map((name) => ({ label: `${name}, ${state}`, state }));
}

/** Every area in the search, DC first, then Maryland, then Virginia. */
export const DMV_AREAS: readonly DmvArea[] = [
  ...inState('DC', [
    'Adams Morgan',
    'Anacostia',
    'Brookland',
    'Capitol Hill',
    'Columbia Heights',
    'Dupont Circle',
    'Foggy Bottom',
    'Georgetown',
    'H Street',
    'Logan Circle',
    'Mount Pleasant',
    'Navy Yard',
    'NoMa',
    'Penn Quarter/Chinatown',
    'Petworth',
    'Shaw',
    'Southwest Waterfront',
    'The Wharf',
    'U Street',
    'Union Market',
  ]),
  ...inState('MD', [
    'Bethesda',
    'College Park',
    'Hyattsville',
    'Largo',
    'National Harbor',
    'Rockville',
    'Silver Spring',
    'Takoma Park',
    'Wheaton',
    // Baltimore (VC-62). "Downtown Baltimore" and "Mount Vernon (Baltimore)"
    // name the city so they can't be mixed up with DC's Downtown or
    // Virginia's Mount Vernon.
    'Canton',
    'Downtown Baltimore',
    'Federal Hill',
    'Fells Point',
    'Mount Vernon (Baltimore)',
  ]),
  ...inState('VA', [
    'Ballston',
    'Clarendon',
    'Courthouse',
    'Crystal City/National Landing',
    'Del Ray',
    'Fairfax',
    'Falls Church',
    'Old Town Alexandria',
    'Reston',
    'Rosslyn',
    'Shirlington',
    'Tysons',
    // Richmond area (VC-62). Midlothian is a suburb just west of Richmond.
    'Downtown Richmond',
    'Midlothian',
    "Scott's Addition",
    'Shockoe Bottom',
    'The Fan',
  ]),
];

/**
 * Turns text into a simple form for searching: lower case, with anything
 * that isn't a letter or digit treated as a space.
 *
 * @param text - any text, e.g. "Penn Quarter/Chinatown, DC".
 * @returns e.g. "penn quarter chinatown dc". Apostrophes are dropped (not
 *   turned into spaces), so "scotts" finds "Scott's Addition, VA" (VC-62).
 */
function searchForm(text: string): string {
  return (
    text
      .toLowerCase()
      // Straight (') and curly (’) apostrophes: phone keyboards type either.
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  );
}

/**
 * Finds the areas in one state matching what the admin typed.
 *
 * @param query - the search text. Empty matches nothing (the search shows
 *   nothing until the admin types, founder's rule).
 * @param state - only areas in this state are searched.
 * @returns matching labels, in list order. The typed text may appear
 *   anywhere in the name, ignoring capitals and punctuation: "yard" finds
 *   "Navy Yard, DC", "chinatown" finds "Penn Quarter/Chinatown, DC".
 */
export function searchAreas(query: string, state: AreaState): string[] {
  const typed = searchForm(query);
  if (typed === '') return [];
  return DMV_AREAS.filter(
    (area) => area.state === state && searchForm(area.label).includes(typed),
  ).map((area) => area.label);
}

/**
 * Looks up which state a listed area is in.
 *
 * @param label - an area label, e.g. "Shaw, DC".
 * @returns its state, or null when it isn't on the list (typed through
 *   "Use ...").
 */
export function stateOfListedArea(label: string): AreaState | null {
  return DMV_AREAS.find((area) => area.label === label.trim())?.state ?? null;
}

// ---- Which state is a map pin in? (approximate, offline) -------------------
//
// APPROXIMATE on purpose: this only preselects the State buttons on the
// event form, and the admin can always change it. Plain rectangles ("bounding
// boxes") aren't enough here: the boxes around Maryland and Virginia overlap
// right across the DMV, and DC's box would swallow Rosslyn and Silver
// Spring. So:
//   1. DC: a rough outline (its north, east and south corners, then the
//      Potomac river up to Chain Bridge). Within about half a kilometre.
//   2. Outside DC but inside the big box around the three states: in the
//      overlap, the Potomac river divides Maryland (north/east) from
//      Virginia (south/west), approximated by a few points along it.
//   3. Anywhere else (e.g. New York): no guess.
// Baltimore and Richmond (VC-62) already fall inside the big box: Baltimore
// is east of the river line (Maryland) and Richmond is south of the river's
// mouth (Virginia), so no change was needed for them.

/** [latitude, longitude] corners of DC's rough outline, in order. */
const DC_OUTLINE: readonly [number, number][] = [
  [38.9955, -77.041], // north corner
  [38.8929, -76.9094], // east corner
  [38.7916, -77.039], // south corner (near the Wilson Bridge)
  [38.83, -77.032], // Potomac, east of Reagan National Airport
  [38.86, -77.025], // Potomac, off Hains Point
  [38.875, -77.045], // Potomac, by the 14th Street bridges
  [38.886, -77.056], // Potomac, Memorial Bridge
  [38.902, -77.07], // Potomac, Key Bridge
  [38.929, -77.115], // Potomac, Chain Bridge
  [38.9342, -77.1198], // west corner
];

/** Rough box around DC, Maryland and Virginia together (approximate). */
const DMV_BOX = { south: 36.54, north: 39.73, west: -83.68, east: -75.04 };

/**
 * Points along the Potomac, south to north, as [latitude, longitude]
 * (approximate). Virginia is west of this line, Maryland east of it.
 */
const POTOMAC: readonly [number, number][] = [
  [38.04, -76.32], // Point Lookout, where it meets the Chesapeake Bay
  [38.25, -76.97], // Colonial Beach
  [38.52, -77.29], // Quantico
  [38.71, -77.09], // Mount Vernon
  [38.79, -77.04], // Wilson Bridge
  // Through DC the river bends a lot, so it follows the same points as DC's
  // outline (otherwise Rosslyn and Crystal City would come out as Maryland).
  [38.83, -77.032],
  [38.86, -77.025],
  [38.875, -77.045],
  [38.886, -77.056],
  [38.902, -77.07],
  [38.93, -77.115], // Chain Bridge
  [39.0, -77.25], // Great Falls
  // Upriver the Potomac bends west; without this point Poolesville (MD)
  // would come out as Virginia.
  [39.155, -77.52], // Whites Ferry
  [39.27, -77.54], // Point of Rocks
  [39.32, -77.73], // Harpers Ferry
];

/**
 * Says whether a point is inside a polygon (the "ray casting" method: draw
 * a line from the point eastwards and count how many edges it crosses; an
 * odd count means inside).
 *
 * @param lat - the point's latitude.
 * @param lng - the point's longitude.
 * @param polygon - the corners, in order.
 * @returns true when inside.
 */
function insidePolygon(lat: number, lng: number, polygon: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];
    // Does this edge cross the point's latitude, east of the point?
    const crosses =
      latI > lat !== latJ > lat && lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * The river's longitude at a given latitude, by joining the dots in
 * {@link POTOMAC} with straight lines.
 *
 * @param lat - a latitude between Point Lookout and Harpers Ferry.
 * @returns the approximate longitude of the river there.
 */
function potomacLngAt(lat: number): number {
  for (let i = 1; i < POTOMAC.length; i++) {
    const [lat0, lng0] = POTOMAC[i - 1];
    const [lat1, lng1] = POTOMAC[i];
    if (lat <= lat1) return lng0 + ((lng1 - lng0) * (lat - lat0)) / (lat1 - lat0);
  }
  return POTOMAC[POTOMAC.length - 1][1];
}

/**
 * Guesses which state a map pin is in, offline (approximate; see above).
 *
 * @param lat - the pin's latitude.
 * @param lng - the pin's longitude.
 * @returns 'DC', 'MD' or 'VA', or null when the pin is outside the area.
 */
export function stateForPin(lat: number, lng: number): AreaState | null {
  if (insidePolygon(lat, lng, DC_OUTLINE)) return 'DC';
  const inBox =
    lat >= DMV_BOX.south && lat <= DMV_BOX.north && lng >= DMV_BOX.west && lng <= DMV_BOX.east;
  if (!inBox) return null;
  // South of the river's mouth is Virginia; north of Harpers Ferry is
  // Maryland (West Virginia isn't covered; it's an approximation).
  if (lat < POTOMAC[0][0]) return 'VA';
  if (lat > POTOMAC[POTOMAC.length - 1][0]) return 'MD';
  return lng < potomacLngAt(lat) ? 'VA' : 'MD';
}
