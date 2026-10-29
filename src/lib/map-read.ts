/**
 * The map view's data (VC-79, design/vc79-map-spec.md): reading the map's
 * points from the server and sorting them into what the map draws.
 *
 * What it does:
 *   - {@link listMapPoints} calls the server function `get_map_points` for
 *     the same date window as the Tonight list (filterWindow), and checks
 *     every row it gets back;
 *   - {@link groupMapPoints} turns the rows into one circle per AREA (every
 *     party in "Shaw, DC" shares one circle), venue pins (none for now), and
 *     a count of events the map can't place (typed free-text areas);
 *   - {@link areaAt} finds which circle a tap landed in (map circles can't
 *     be tapped by themselves in react-native-maps);
 *   - VC-83 (map v2): {@link tagState} and friends work out what each tag
 *     says (name plus score, start time, or "Too early") and its heat band.
 *
 * Privacy: the server only ever sends area CENTRES (the same fixed point for
 * every event in an area, at least 600 m of circle around it) while its
 * venue-pin switch is off, which it is until the founder decides
 * (migration 20261029110000_map_points.sql). This file never receives,
 * stores or works out a party's real location. A 'venue' row would only
 * arrive once the server's switch is turned on (a cto-reviewed change); the
 * app already knows how to draw one.
 */
import type { ErrorLike } from '@/lib/auth-errors';
import { filterWindow, THIS_WEEK } from '@/lib/date-filter';
import type { DateFilter } from '@/lib/date-filter';
import { describeReadError } from '@/lib/events-read';
import type { VibeLabel } from '@/lib/rating';
import { supabase } from '@/lib/supabase';
import { formatClock } from '@/lib/tonight';

/** How many points the map shows at most; the server sends one more to say "there are more". */
export const MAP_LIMIT = 300;

/** The smallest circle the app will ever draw, in metres (the server's floor too). */
export const MIN_CIRCLE_M = 600;

/** Where the map opens when there is nothing to show: central DC. */
export const DC_CENTRE = { latitude: 38.9072, longitude: -77.0369 } as const;

/** How the map draws one event. 'none' means it can't (free-text area). */
export type MapKind = 'area' | 'venue' | 'none';

/** One row from get_map_points (see the migration for each field). */
export interface MapPoint {
  event_id: string;
  title: string;
  area_label: string;
  starts_at: string;
  ends_at: string;
  source: 'host' | 'staff_pick';
  is_test: boolean;
  kind: MapKind;
  /** The area centre (or, later, the venue). Null for 'none'. */
  lat: number | null;
  lng: number | null;
  /** The circle's radius in metres ('area' only). */
  radius_m: number | null;
  has_started: boolean;
  is_live: boolean;
  /** "Hot", "Fire", "Early" ... only once started; null otherwise. */
  vibe_word: string | null;
  /**
   * VC-83: the published score, 0 to 10 with 1 decimal, only once started
   * and only with 5+ raters (the server's floor); null otherwise.
   */
  vibe_score: number | null;
  /** VC-83: true when that score is old (no new rating for 90+ minutes). */
  vibe_stale: boolean;
}

/** One circle: an area and the events in it, soonest first. */
export interface AreaGroup {
  /** The area label, e.g. "Shaw, DC" (also the circle's key). */
  label: string;
  latitude: number;
  longitude: number;
  radius: number;
  events: MapPoint[];
}

/** What the map draws, from {@link groupMapPoints}. */
export interface MapLayout {
  areas: AreaGroup[];
  venues: MapPoint[];
  /** How many events have no place on the map (shown in the list only). */
  unplaced: number;
}

/** The answer from {@link listMapPoints}. `more` is true past {@link MAP_LIMIT}. */
export type MapPointsOutcome =
  { ok: true; points: MapPoint[]; more: boolean } | { ok: false; message: string };

/**
 * Checks one row from the server, so a broken answer can't crash the map.
 *
 * @param row - one item of the server's answer.
 * @returns the row as a MapPoint, or null when it doesn't make sense (e.g.
 *   an 'area' row without coordinates). Coordinates are kept only for
 *   'area' and 'venue' rows; an 'area' circle is never smaller than 600 m.
 */
export function parseMapPoint(row: unknown): MapPoint | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const id = text(r.event_id);
  const title = text(r.title);
  const area = text(r.area_label);
  const starts = text(r.starts_at);
  const ends = text(r.ends_at);
  const kind = r.kind;
  if (!id || !title || !area || !starts || !ends) return null;
  if (kind !== 'area' && kind !== 'venue' && kind !== 'none') return null;
  const lat = num(r.lat);
  const lng = num(r.lng);
  // A placed row needs both coordinates; otherwise treat it as not placed.
  const placed = kind !== 'none' && lat !== null && lng !== null;
  const radius = num(r.radius_m);
  // VC-83: the score, like the word, only once the event has started.
  const score = r.has_started === true ? parseScore(r.vibe_score) : null;
  return {
    event_id: id,
    title,
    area_label: area,
    starts_at: starts,
    ends_at: ends,
    source: r.source === 'staff_pick' ? 'staff_pick' : 'host',
    is_test: r.is_test === true,
    kind: placed ? kind : 'none',
    lat: placed ? lat : null,
    lng: placed ? lng : null,
    // The privacy floor again on this side: never a circle under 600 m.
    radius_m: placed && kind === 'area' ? Math.max(MIN_CIRCLE_M, radius ?? MIN_CIRCLE_M) : null,
    has_started: r.has_started === true,
    is_live: r.is_live === true,
    // VC-61: nothing about ratings before the start, whatever the server said.
    vibe_word: r.has_started === true ? text(r.vibe_word) : null,
    vibe_score: score,
    // "Stale" only means something next to a score.
    vibe_stale: score !== null && r.vibe_stale === true,
  };
}

/**
 * Checks the score from the server.
 *
 * @param value - the vibe_score field. Postgres "numeric" normally arrives
 *   as a JSON number, but a string like "8.4" is accepted too.
 * @returns the score rounded to 1 decimal, or null when it is missing or
 *   not a number from 0 to 10.
 */
function parseScore(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 10) return null;
  return Math.round(n * 10) / 10;
}

/**
 * Reads the map's points for one date filter.
 *
 * @param now - the moment the window is worked out from (a parameter so
 *   tests can fix it).
 * @param filter - the date filter shared with the list (VC-63).
 * @returns up to {@link MAP_LIMIT} points and whether there were more, or a
 *   message to show. Never throws.
 */
export async function listMapPoints(
  now: Date = new Date(),
  filter: DateFilter = THIS_WEEK,
): Promise<MapPointsOutcome> {
  const { endsAfter, startsFrom, startsBefore } = filterWindow(filter, now);
  try {
    const { data, error } = await supabase.rpc('get_map_points', {
      p_ends_after: endsAfter.toISOString(),
      p_starts_from: startsFrom ? startsFrom.toISOString() : null,
      p_starts_before: startsBefore.toISOString(),
    });
    if (error) return { ok: false, message: describeReadError(error) };
    const rows = Array.isArray(data) ? data : [];
    const points = rows.map(parseMapPoint).filter((p): p is MapPoint => p !== null);
    return { ok: true, points: points.slice(0, MAP_LIMIT), more: rows.length > MAP_LIMIT };
  } catch (thrown) {
    // supabase-js normally returns errors, but a dropped connection can throw.
    return { ok: false, message: describeReadError(thrown as ErrorLike) };
  }
}

/**
 * Sorts the points into circles, pins and "not on the map".
 *
 * @param points - the rows from {@link listMapPoints}.
 * @returns one circle per area label (in the order the areas first appear,
 *   i.e. by their soonest event), venue pins, and the count of unplaced
 *   events. Every event in an area shares its circle, so the map shows no
 *   more than the area label already says.
 */
export function groupMapPoints(points: MapPoint[]): MapLayout {
  const byArea = new Map<string, AreaGroup>();
  const venues: MapPoint[] = [];
  let unplaced = 0;
  for (const p of points) {
    if (p.kind === 'venue' && p.lat !== null && p.lng !== null) {
      venues.push(p);
    } else if (p.kind === 'area' && p.lat !== null && p.lng !== null) {
      const group = byArea.get(p.area_label);
      if (group) group.events.push(p);
      else
        byArea.set(p.area_label, {
          label: p.area_label,
          latitude: p.lat,
          longitude: p.lng,
          radius: p.radius_m ?? MIN_CIRCLE_M,
          events: [p],
        });
    } else {
      unplaced += 1;
    }
  }
  return { areas: [...byArea.values()], venues, unplaced };
}

/**
 * The distance between two points on the Earth, in metres (the "haversine"
 * formula: accurate to well under 1% at city distances).
 *
 * @param a - the first point.
 * @param b - the second point.
 * @returns the distance in metres.
 */
export function metresBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6_371_000; // Earth's mean radius in metres.
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Finds the circle a tap on the map landed in.
 *
 * @param tap - where the finger touched the map.
 * @param areas - the circles on the map.
 * @returns the circle whose centre is nearest among those containing the
 *   tap (circles can overlap, e.g. Shaw and U Street), or null for a tap on
 *   empty map.
 */
export function areaAt(
  tap: { latitude: number; longitude: number },
  areas: AreaGroup[],
): AreaGroup | null {
  let best: AreaGroup | null = null;
  let bestDistance = Infinity;
  for (const area of areas) {
    const d = metresBetween(tap, area);
    if (d <= area.radius && d < bestDistance) {
      best = area;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * The area's short name for the map's labels: "Shaw, DC" becomes "Shaw".
 *
 * @param label - an area label.
 * @returns the label without its ", DC" / ", MD" / ", VA" ending.
 */
export function shortArea(label: string): string {
  return label.replace(/,\s*(DC|MD|VA)$/, '');
}

/**
 * The points the map should fit into view on its first load: each circle's
 * north, south, east and west edges (so whole circles show), and each pin.
 *
 * @param layout - what the map draws.
 * @returns a list of coordinates (empty when there is nothing to show).
 */
export function fitCoordinates(layout: MapLayout): { latitude: number; longitude: number }[] {
  const coords: { latitude: number; longitude: number }[] = [];
  for (const a of layout.areas) {
    // Degrees per metre: about 1/111,320 north-south; east-west it shrinks
    // with the cosine of the latitude.
    const dLat = a.radius / 111_320;
    const dLng = a.radius / (111_320 * Math.cos((a.latitude * Math.PI) / 180));
    coords.push(
      { latitude: a.latitude + dLat, longitude: a.longitude },
      { latitude: a.latitude - dLat, longitude: a.longitude },
      { latitude: a.latitude, longitude: a.longitude + dLng },
      { latitude: a.latitude, longitude: a.longitude - dLng },
    );
  }
  for (const v of layout.venues) {
    if (v.lat !== null && v.lng !== null) coords.push({ latitude: v.lat, longitude: v.lng });
  }
  return coords;
}

// ---------------------------------------------------------------------------
// VC-83 (map v2): what each tag says, and its heat band
// ---------------------------------------------------------------------------

/** The words for a started event without a published score (exported for tests). */
export const TOO_EARLY = 'Too early';

/** How many characters of an event's name a tag shows before "…" (spec §2). */
export const TAG_NAME_MAX = 16;

/** The four vibe bands, coolest first (the order "hottest" is judged by). */
export const BANDS: readonly VibeLabel[] = ['Quiet', 'Good', 'Hot', 'Fire'];

/**
 * What one event's tag shows after its name:
 *   before - not started yet: its start time ("10 PM"), nothing about ratings;
 *   early  - started, but no published score (nobody rated, 1-4 raters, or
 *            no snapshot yet): "Too early". The map never says which of
 *            these it is, so it can't hint at how many people rated;
 *   score  - a published score, its band (the server's word) and whether
 *            it is stale.
 */
export type TagState =
  | { kind: 'before'; time: string }
  | { kind: 'early' }
  | { kind: 'score'; score: number; band: VibeLabel; stale: boolean };

/**
 * Checks whether a word is one of the four vibe bands.
 *
 * @param word - e.g. "Hot", "Early" or null.
 * @returns true for Quiet, Good, Hot and Fire.
 */
function isBand(word: string | null): word is VibeLabel {
  return word !== null && (BANDS as readonly string[]).includes(word);
}

/**
 * Works out what an event's tag shows.
 *
 * @param point - the map row.
 * @returns before (with the start time in New York), early, or score. A
 *   score needs BOTH the number and a band word from the server (they come
 *   from the same snapshot); anything else reads "Too early".
 */
export function tagState(
  point: Pick<MapPoint, 'has_started' | 'starts_at' | 'vibe_word' | 'vibe_score' | 'vibe_stale'>,
): TagState {
  if (!point.has_started) return { kind: 'before', time: formatClock(new Date(point.starts_at)) };
  if (point.vibe_score === null || !isBand(point.vibe_word)) return { kind: 'early' };
  return { kind: 'score', score: point.vibe_score, band: point.vibe_word, stale: point.vibe_stale };
}

/**
 * The text after the name on a tag.
 *
 * @param state - from {@link tagState}.
 * @returns "8.4" (always 1 decimal), "10 PM" or "Too early".
 */
export function tagTrailing(state: TagState): string {
  if (state.kind === 'score') return state.score.toFixed(1);
  if (state.kind === 'before') return state.time;
  return TOO_EARLY;
}

/**
 * Shortens a name for a tag.
 *
 * @param title - the event's name.
 * @returns the name, or its first 16 characters (trimmed) and "…".
 */
export function tagName(title: string): string {
  const clean = title.trim();
  return clean.length <= TAG_NAME_MAX ? clean : `${clean.slice(0, TAG_NAME_MAX).trimEnd()}…`;
}

/**
 * The hottest PUBLISHED band among some events (cto review point 1): used
 * for the dot and glow of an area with 2+ parties.
 *
 * @param points - the events in one area.
 * @returns the highest band among events that show a score, or null when
 *   none does. Before-start and "Too early" events are ignored. Only the
 *   band word is used: never a number, an average or a count.
 */
export function hottestBand(points: MapPoint[]): VibeLabel | null {
  let best = -1;
  for (const p of points) {
    const state = tagState(p);
    if (state.kind === 'score') best = Math.max(best, BANDS.indexOf(state.band));
  }
  return best >= 0 ? BANDS[best] : null;
}

/**
 * How a tag or card is read out to a screen reader (spec §7).
 *
 * @param point - the map row.
 * @returns e.g. "Rooftop Sundown, house party, area only, Navy Yard, Hot,
 *   8.4"; "…, starts 10 PM" before the start; "…, Too early" without a
 *   score. Never a rater count or a headcount.
 */
export function tagSpoken(point: MapPoint): string {
  const state = tagState(point);
  const what =
    point.kind === 'venue'
      ? 'venue'
      : `${point.source === 'staff_pick' ? 'staff pick' : 'house party'}, area only`;
  const vibe =
    state.kind === 'score'
      ? `${state.band}, ${state.score.toFixed(1)}`
      : state.kind === 'before'
        ? `starts ${state.time}`
        : TOO_EARLY;
  return `${point.title}, ${what}, ${shortArea(point.area_label)}, ${vibe}`;
}
