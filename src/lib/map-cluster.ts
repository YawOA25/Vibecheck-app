/**
 * Zoom levels, clusters, which tags show, and which tags pulse on the Tonight
 * map (VC-83 map v2 Batch 2, design/vc83-map-v2-spec.md §4 and §5).
 *
 * Why it exists: with every event drawn as a full name tag, a zoomed-out map
 * becomes a pile of overlapping pills. So the map decides, from how far out
 * the guest is zoomed, how to draw each "spot" (an area's centre, or a venue
 * once that switch is on):
 *   - FAR (more than 25 km across, or more than 12 spots on screen): no
 *     names. Spots within 56 px of each other on screen merge into a round
 *     COUNT BUBBLE ("5"), tinted by the hottest published band inside (a
 *     word band only: never a score number, never "3 hot"). A spot holding
 *     just one event is a small heat dot;
 *   - MIDDLE: full tags for up to 8 spots, hottest first; the rest are dots.
 *     A tag that would overlap a hotter tag becomes a dot (it is HIDDEN,
 *     never moved: cto rule, tags always sit exactly where the server said);
 *   - CLOSE (less than 6 km across): every tag.
 *
 * It also picks the (at most 5) tags that pulse: live Hot and Fire events
 * with a fresh (not stale) score, highest scores first (spec §4).
 *
 * Everything here is a plain function of its inputs (no React, no server),
 * so it can be tested on its own. Events number in the tens (300 at most),
 * so the simple "compare every pair" approach is fast enough and no
 * clustering package is needed (spec §9).
 *
 * Privacy (cto review 2026-10-29, point 1): the app only ever receives area
 * centres, so no amount of grouping can place a party more precisely than
 * its area. A cluster sits at the plain average of its events' points, and
 * its colour is the hottest band among events that SHOW a published score;
 * "Too early" and not-started events never count towards it.
 */
import type { Region } from 'react-native-maps';

import { compareHeat, hottestBand, pagerOrder, tagState } from '@/lib/map-read';
import type { MapPoint } from '@/lib/map-read';
import type { VibeLabel } from '@/lib/rating';

/** Spots closer than this on screen (in px) merge into one bubble at far zoom. */
export const CLUSTER_PX = 56;

/** Wider than this (in km) is the far zoom. */
export const FAR_KM = 25;

/** Narrower than this (in km) is the close zoom. */
export const CLOSE_KM = 6;

/** More spots than this on screen also counts as far zoom (spec §5). */
export const FAR_SPOTS = 12;

/** At middle zoom, at most this many full tags; the rest are dots. */
export const MIDDLE_TAGS = 8;

/** At most this many tags pulse at once (spec §4). */
export const MAX_PULSES = 5;

/** One pulse ring's length, in ms (spec §4: every 2.4 s). */
export const PULSE_MS = 2400;

/** A tag pill's height on screen, in px (spec §2). */
export const TAG_HEIGHT = 32;

/**
 * How far in (as degrees of latitude across the screen) tapping a bubble
 * zooms when its events all share one point: about 4.4 km, so "close".
 */
export const CLOSE_DELTA = 0.04;

/**
 * The map's size before it has been measured (Jest never measures): a
 * typical phone map area, in px.
 */
export const DEFAULT_MAP_SIZE = { width: 390, height: 640 } as const;

/** Kilometres per degree of latitude (and of longitude at the equator). */
const KM_PER_DEGREE = 111.32;

/** The map's size on screen, in px. */
export interface MapSize {
  width: number;
  height: number;
}

/** A place on the map. */
export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * One spot on the map: everything that shares one point. An area's centre
 * (all its parties), or one venue.
 */
export interface MapSpot extends LatLng {
  /** A stable name: the area label, or "venue:<event id>". */
  key: string;
  /** The events there (at least one). */
  events: MapPoint[];
  /** How wide its full tag is on screen, in px (from estimateTagWidth). */
  tagWidth: number;
}

/** How far out the map is zoomed. */
export type ZoomLevel = 'far' | 'middle' | 'close';

/**
 * One thing to draw:
 *   tag     - a full name tag (pulse: true when it should pulse);
 *   dot     - a small heat dot for one spot;
 *   cluster - a count bubble for several events close together on screen.
 *             It carries a COUNT of events and a BAND WORD only: no score.
 */
export type PlannedMarker =
  | { kind: 'tag'; spot: MapSpot; pulse: boolean }
  | { kind: 'dot'; spot: MapSpot }
  | {
      kind: 'cluster';
      key: string;
      latitude: number;
      longitude: number;
      spots: MapSpot[];
      count: number;
      band: VibeLabel | null;
    };

/** What the map draws for the current view. */
export interface MapPlan {
  level: ZoomLevel;
  markers: PlannedMarker[];
}

/**
 * Guesses how wide a tag will be, without drawing it (good enough to tell
 * whether two tags would overlap).
 *
 * @param name - the (shortened) name on the tag.
 * @param trailing - the text after it ("8.4", "10 PM", "Too early").
 * @returns the width in px: padding, the dot, gaps and about 7 px per
 *   letter of the name and 8 px per letter of the score.
 */
export function estimateTagWidth(name: string, trailing: string): number {
  // 9 left padding + 10 dot + 6 gap + 6 gap + 12 right padding + 2 border.
  return 45 + name.length * 7.2 + trailing.length * 7.8;
}

/**
 * How many km the map shows across its wider side.
 *
 * @param region - the map's current view.
 * @returns the span in km. East-west degrees shrink with the latitude.
 */
export function spanKm(region: Region): number {
  const northSouth = region.latitudeDelta * KM_PER_DEGREE;
  const eastWest =
    region.longitudeDelta * KM_PER_DEGREE * Math.cos((region.latitude * Math.PI) / 180);
  return Math.max(northSouth, eastWest);
}

/**
 * Where a place lands on screen, in px from the map's top-left corner.
 *
 * @param p - the place.
 * @param region - the map's current view.
 * @param size - the map's size on screen.
 * @returns x (rightwards) and y (downwards). A straight-line approximation:
 *   at city distances the map's curvature is far below a pixel's worth.
 */
export function toScreen(p: LatLng, region: Region, size: MapSize): { x: number; y: number } {
  const west = region.longitude - region.longitudeDelta / 2;
  const north = region.latitude + region.latitudeDelta / 2;
  return {
    x: ((p.longitude - west) / region.longitudeDelta) * size.width,
    y: ((north - p.latitude) / region.latitudeDelta) * size.height,
  };
}

/**
 * Whether a place is inside the map's current view.
 *
 * @param p - the place.
 * @param region - the map's current view.
 * @returns true when it is on screen.
 */
export function inView(p: LatLng, region: Region): boolean {
  return (
    Math.abs(p.latitude - region.latitude) <= region.latitudeDelta / 2 &&
    Math.abs(p.longitude - region.longitude) <= region.longitudeDelta / 2
  );
}

/**
 * Orders spots hottest first, by their hottest event (see compareHeat),
 * then by key so the order is always the same for the same data.
 *
 * @param a - one spot.
 * @param b - another spot.
 * @returns negative when `a` comes first.
 */
export function compareSpots(a: MapSpot, b: MapSpot): number {
  const byHeat = compareHeat(pagerOrder(a.events)[0], pagerOrder(b.events)[0]);
  if (byHeat !== 0) return byHeat;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Works out the zoom level (spec §5 table).
 *
 * @param spots - every spot on the map.
 * @param region - the map's current view.
 * @returns 'close' under 6 km across; 'far' over 25 km, or when more than
 *   12 spots are on screen; 'middle' otherwise.
 */
export function zoomLevel(spots: MapSpot[], region: Region): ZoomLevel {
  const km = spanKm(region);
  if (km < CLOSE_KM) return 'close';
  if (km > FAR_KM) return 'far';
  const onScreen = spots.filter((s) => inView(s, region)).length;
  return onScreen > FAR_SPOTS ? 'far' : 'middle';
}

/**
 * Groups spots that sit close together on screen (far zoom).
 *
 * How: take the hottest spot not yet grouped, and put every other
 * ungrouped spot within 56 px of it into its group. Repeat. Starting from
 * the hottest keeps the hottest place as the anchor of its bubble.
 *
 * @param spots - every spot on the map.
 * @param region - the map's current view.
 * @param size - the map's size on screen.
 * @returns the groups (each one or more spots), hottest group first.
 */
export function groupNearby(spots: MapSpot[], region: Region, size: MapSize): MapSpot[][] {
  const ordered = [...spots].sort(compareSpots);
  const at = new Map(ordered.map((s) => [s.key, toScreen(s, region, size)]));
  const used = new Set<string>();
  const groups: MapSpot[][] = [];
  for (const seed of ordered) {
    if (used.has(seed.key)) continue;
    used.add(seed.key);
    const a = at.get(seed.key)!;
    const group = [seed];
    for (const other of ordered) {
      if (used.has(other.key)) continue;
      const b = at.get(other.key)!;
      if (Math.hypot(a.x - b.x, a.y - b.y) <= CLUSTER_PX) {
        group.push(other);
        used.add(other.key);
      }
    }
    groups.push(group);
  }
  return groups;
}

/**
 * Turns a group of spots into what the far zoom draws.
 *
 * @param group - one group from groupNearby.
 * @returns a dot when the group holds exactly one event; otherwise a count
 *   bubble at the AVERAGE of its events' points (cto rule), with the count
 *   of events and the hottest published band (a word, or null). Never a
 *   score, an average score or a count of anything but events.
 */
export function clusterOf(group: MapSpot[]): PlannedMarker {
  const events = group.flatMap((s) => s.events);
  if (events.length === 1) return { kind: 'dot', spot: group[0] };
  // Every event of a spot shares the spot's point, so averaging the events
  // is the same as averaging the spots weighted by their events.
  let lat = 0;
  let lng = 0;
  for (const s of group) {
    lat += s.latitude * s.events.length;
    lng += s.longitude * s.events.length;
  }
  return {
    kind: 'cluster',
    // Sorted member keys: the same group always gets the same key.
    key: group
      .map((s) => s.key)
      .sort()
      .join('|'),
    latitude: lat / events.length,
    longitude: lng / events.length,
    spots: group,
    count: events.length,
    band: hottestBand(events),
  };
}

/**
 * Whether an event may pulse (spec §4): on now, a fresh published score,
 * and in the Hot or Fire band. A stale score never pulses (cto).
 *
 * @param point - the map row.
 * @returns true when it qualifies.
 */
export function canPulse(point: MapPoint): boolean {
  const state = tagState(point);
  return (
    point.is_live &&
    state.kind === 'score' &&
    !state.stale &&
    (state.band === 'Hot' || state.band === 'Fire')
  );
}

/**
 * Picks which of the shown tags pulse: at most 5, highest scores first.
 *
 * @param tags - the spots drawn as full tags.
 * @returns the keys of the spots whose tag pulses. A spot with several
 *   events pulses when any of them qualifies, ranked by that event.
 */
export function pulsingKeys(tags: MapSpot[]): Set<string> {
  const ranked: { key: string; best: MapPoint }[] = [];
  for (const spot of tags) {
    const best = pagerOrder(spot.events.filter(canPulse))[0];
    if (best) ranked.push({ key: spot.key, best });
  }
  ranked.sort((a, b) => compareHeat(a.best, b.best) || (a.key < b.key ? -1 : 1));
  return new Set(ranked.slice(0, MAX_PULSES).map((r) => r.key));
}

/**
 * Decides which spots get a full tag at middle zoom.
 *
 * How: go through the on-screen spots hottest first (the picked one, if
 * any, goes first so its gold tag always shows). Each gets a tag while
 * fewer than 8 tags are placed AND its tag doesn't overlap a tag already
 * placed; otherwise it becomes a dot. Off-screen spots keep a tag without
 * counting towards the 8 (nobody sees them, and a guest panning towards
 * them then sees a tag rather than a dot until the pan ends).
 *
 * @param spots - every spot on the map.
 * @param region - the map's current view.
 * @param size - the map's size on screen.
 * @param selectedKey - the picked spot's key, or null.
 * @returns the keys of the spots that get a full tag.
 */
export function chooseTags(
  spots: MapSpot[],
  region: Region,
  size: MapSize,
  selectedKey: string | null,
): Set<string> {
  const keys = new Set(spots.filter((s) => !inView(s, region)).map((s) => s.key));
  const ordered = spots
    .filter((s) => inView(s, region))
    .sort((a, b) => {
      if (a.key === selectedKey) return -1;
      if (b.key === selectedKey) return 1;
      return compareSpots(a, b);
    });
  // The rectangles of the tags placed so far (centred on their point).
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  for (const spot of ordered) {
    if (placed.length >= MIDDLE_TAGS) break;
    const { x, y } = toScreen(spot, region, size);
    const box = {
      left: x - spot.tagWidth / 2,
      right: x + spot.tagWidth / 2,
      top: y - TAG_HEIGHT / 2,
      bottom: y + TAG_HEIGHT / 2,
    };
    const hits = placed.some(
      (p) => box.left < p.right && box.right > p.left && box.top < p.bottom && box.bottom > p.top,
    );
    if (hits) continue;
    placed.push(box);
    keys.add(spot.key);
  }
  return keys;
}

/**
 * Plans the whole map for the current view.
 *
 * @param spots - every spot on the map.
 * @param region - the map's current view.
 * @param size - the map's size on screen.
 * @param selectedKey - the picked spot's key, or null.
 * @returns the zoom level and the markers to draw: bubbles and dots at far
 *   zoom; tags and dots at middle; every spot a tag at close. Tags that
 *   should pulse say so (at most 5, on screen only).
 */
export function planMap(
  spots: MapSpot[],
  region: Region,
  size: MapSize,
  selectedKey: string | null,
): MapPlan {
  const level = zoomLevel(spots, region);
  if (level === 'far') {
    return { level, markers: groupNearby(spots, region, size).map(clusterOf) };
  }
  const tagKeys =
    level === 'close'
      ? new Set(spots.map((s) => s.key))
      : chooseTags(spots, region, size, selectedKey);
  // Only tags on screen compete for the 5 pulses.
  const pulsing = pulsingKeys(spots.filter((s) => tagKeys.has(s.key) && inView(s, region)));
  return {
    level,
    markers: spots.map((spot): PlannedMarker =>
      tagKeys.has(spot.key)
        ? { kind: 'tag', spot, pulse: pulsing.has(spot.key) }
        : { kind: 'dot', spot },
    ),
  };
}

/**
 * The view to zoom to when a bubble is tapped: just big enough to fit its
 * spots, and never wider than half the current view, so the bubble always
 * opens up.
 *
 * @param points - the bubble's spots.
 * @param current - the map's current view.
 * @returns a region around the spots. When they all share one point (one
 *   area with several parties), a close view (about 4.4 km) around it.
 */
export function regionToFit(points: LatLng[], current: Region): Region {
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const north = Math.max(...lats);
  const south = Math.min(...lats);
  const east = Math.max(...lngs);
  const west = Math.min(...lngs);
  // 1.6 leaves room around the outer spots for their tags.
  const latitudeDelta = Math.min(
    Math.max((north - south) * 1.6, CLOSE_DELTA),
    Math.max(current.latitudeDelta / 2, CLOSE_DELTA),
  );
  // Keep the map's own width-to-height shape.
  const shape = current.longitudeDelta / current.latitudeDelta;
  const longitudeDelta = Math.max((east - west) * 1.6, latitudeDelta * shape);
  return {
    latitude: (north + south) / 2,
    longitude: (east + west) / 2,
    latitudeDelta,
    longitudeDelta,
  };
}

/**
 * A fixed start delay for an event's pulse, so tags don't pulse in step
 * ("offset per event", spec §4). Worked out from the id only, never from
 * the score or the time of a rating.
 *
 * @param id - the event's id.
 * @returns 0 to 2399 ms.
 */
export function pulseDelay(id: string): number {
  // A simple text hash (the classic "times 31" recipe), kept to 32 bits.
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % PULSE_MS;
}
