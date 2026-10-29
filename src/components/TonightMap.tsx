/**
 * The Tonight map (VC-79, founder approved 2026-10-28;
 * design/vc79-map-spec.md; map v2 VC-83, design/vc83-map-v2-spec.md). It
 * sits behind Tonight's List / Map switch and follows the same date chips
 * as the list.
 *
 * What it shows (iPhone only for now):
 *   - a dark Apple map (no shop or building clutter);
 *   - VC-83: one soft gold HEAT GLOW per area that has events, around the
 *     area's fixed centre (at least 600 m of radius; the size is the area's,
 *     never the score's), brighter for hotter published bands
 *     (src/components/AreaHeat.tsx), and a TAG at the centre
 *     (src/components/MapTag.tsx): the event's name and its published score
 *     ("Rooftop Sundown 9.1"), its start time before it starts, or "Too
 *     early" without a published score. An area with 2+ events gets one
 *     tag, "Shaw 2 parties", with its dot in the hottest published band. It
 *     never shows where a party really is: the server only sends area
 *     centres (migrations 20261029110000_map_points.sql and
 *     20261029130000_map_scores.sql) while its venue-pin switch is off,
 *     which it is until the founder decides about staff picks. No rater
 *     count and no headcount reach this screen at all;
 *   - tapping a tag (or inside a circle) eases the camera so the spot sits
 *     in the upper part of the map, and raises a card at the bottom with
 *     one mini card per event there (swipe sideways when there are several,
 *     "1 of 2"). Each mini card opens the event page. Tapping empty map
 *     closes it;
 *   - VC-83 Batch 2, ZOOM LEVELS (src/lib/map-cluster.ts): zoomed far out
 *     (over 25 km, or over 12 places on screen) the names drop away: places
 *     close together on screen merge into round COUNT BUBBLES ("5"), edged
 *     in the hottest published band inside (a word band, never a score),
 *     and a place with one event is a small heat dot. Tapping a bubble zooms
 *     in on it. In the middle, the 8 hottest places get full tags and the
 *     rest are dots (a tag that would overlap a hotter one becomes a dot;
 *     tags are never moved). Close in (under 6 km), every tag shows;
 *   - VC-83 Batch 2, PULSE: up to 5 live Hot/Fire tags (fresh scores only)
 *     pulse slowly; still rings under Reduce Motion or when the screen
 *     isn't in view. A band change cross-fades in 400 ms (tag dot and glow);
 *   - the card's pages go hottest first, then by start time, and the card
 *     closes with a swipe down (or the screen reader's "escape" gesture).
 *     VC-84 fix (cto, VC-83 Batch 2 debt): when a refresh re-sorts the
 *     pages, the card stays on the event the guest was looking at (by id);
 *   - your blue location dot, ONLY if you already allowed location for the
 *     app (for example at check-in). This screen never asks: it only reads
 *     the current permission. When it shows, a round button centres on you;
 *   - "Loading events…" while the points load (the map itself shows at
 *     once), a card with "Try again" when loading failed, the date filter's
 *     own empty words with "See the list" when there is nothing, and a pill
 *     "2 events aren't on the map. See the list" when some events have a
 *     typed area the map can't place (they are in the list only);
 *   - "Showing the first 300. Narrow the dates." past 300 events;
 *   - a map key (legend): the four bands, and "Circles show the area, not
 *     the address". Since VC-85 it lives behind the round menu button.
 *
 * VC-85 step 1, the "sleek" look (design/vc85-map-brand-spec.md; founder
 * chose Tier 2 on 2026-10-29, and this step is the part both tiers share).
 * Everything still works in Expo Go: no new native package.
 *   - The Apple base is made as quiet as Apple allows: the "muted" map type
 *     (flattest, least colour), no points of interest, and zoom limits
 *     (from street level out to the whole DC / Baltimore / Richmond area).
 *     Apple Maps can't be recoloured; that is step 2 (a custom base map,
 *     which needs a development build).
 *   - A dark edge fade over the map (src/components/MapGlass.tsx) pulls the
 *     eye to the middle. It is only a picture: touches go through it.
 *   - The chrome floats as "glass": a pill at the top ("Tonight ·
 *     Washington") with one round menu button that opens the map key; the
 *     key's "Circles show the area" line also shows once per app run as a
 *     hint. Smaller 26 px tags, a 34 px count bubble, a softer area glow,
 *     a glass card with a gold hairline and dots for its pages.
 *   - Slower, softer motion: the camera takes 520 ms to a picked tag (450
 *     ms into a bubble), the card slides up in 280 ms with no bounce, and
 *     new tags fade in one after another, hottest first. Reduce Motion:
 *     all instant, as before.
 * The privacy rules are unchanged: area circles only, no counts of people
 * or raters, published scores only.
 *
 * Refreshing: the points (and so the published scores) reload every minute
 * while the map is on screen, like the list's vibes. A score only changes
 * when the server publishes a new snapshot, never per rating. The map only
 * re-frames itself on the first load and after a filter change, never on a
 * refresh.
 *
 * Sign-out: what was loaded belongs to the person who loaded it (a tester
 * sees test events). It is only shown while that same person is signed in,
 * and is loaded again for anyone else on the same phone (cto, VC-83).
 *
 * Screen readers: the map is ONE element with a spoken summary ("Map of 5
 * events in 3 areas. Circles show the area only, never the exact spot."),
 * so VoiceOver doesn't wander between circles, and a "See the list" button
 * is always there as the full alternative. Each tag also carries its own
 * label (for switch control users), e.g. "Rooftop Sundown, house party,
 * area only, Navy Yard, Hot, 8.4".
 *
 * Reduce Motion: the map jumps (to its framing, or to a picked tag) instead
 * of gliding, the card appears without rising, a picked tag doesn't grow,
 * new tags don't fade in, and the cards don't shrink when pressed.
 *
 * Android: no Google Maps key yet (a founder decision), so it shows "Map
 * coming soon" with a "See the list" button instead of a map.
 */
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollViewInstance,
} from 'react-native';
import MapView from 'react-native-maps';
import type { MapPressEvent, Region, UserLocationChangeEvent } from 'react-native-maps';

import { AreaHeat } from '@/components/AreaHeat';
import { Button } from '@/components/Button';
import {
  EDGE_FADE_SHARE,
  GLASS_BUTTON_SIZE,
  GlassCircleButton,
  MAP_EASE,
  MapVignette,
  glass,
} from '@/components/MapGlass';
import { MapCluster, MapDot } from '@/components/MapDots';
import { MapMiniCard } from '@/components/MapMiniCard';
import { MapTag } from '@/components/MapTag';
import type { MapTagProps, PulseMode } from '@/components/MapTag';
import { StatusPanel } from '@/components/StatusPanel';
import { wordColour } from '@/components/VibeMeter';
import { useAuth } from '@/lib/auth-context';
import { filterEmptyText, filterTitle } from '@/lib/date-filter';
import type { DateFilter } from '@/lib/date-filter';
import {
  BANDS,
  DC_CENTRE,
  MAP_LIMIT,
  areaAt,
  fitCoordinates,
  groupMapPoints,
  hottestBand,
  listMapPoints,
  shortArea,
  tagName,
  tagSpoken,
  tagState,
  pagerOrder,
  tagTrailing,
} from '@/lib/map-read';
import type { AreaGroup, MapPoint } from '@/lib/map-read';
import {
  DEFAULT_MAP_SIZE,
  estimateTagWidth,
  planMap,
  pulseDelay,
  regionToFit,
  tagAppearDelays,
} from '@/lib/map-cluster';
import type { MapSize, MapSpot, PlannedMarker } from '@/lib/map-cluster';
import { motionAllowed, useReduceMotion } from '@/lib/reduce-motion';
import { LIST_VIBE_REFRESH_MS } from '@/lib/vibe';
import { colors, fonts, minTapTarget, radius, spacing, typography } from '@/theme';

/** Words used on the map (exported so tests use the same text). */
export const SEE_LIST_LABEL = 'See the list';
export const MAP_LOADING_LABEL = 'Loading events…';
export const ANDROID_TITLE = 'Map coming soon';
export const ANDROID_BODY = 'The map is on iPhone for now. Everything is in the list.';
export const LOCATE_LABEL = 'Show my location';
export const MORE_THAN_LIMIT = `Showing the first ${MAP_LIMIT}. Narrow the dates.`;
export const LEGEND_TEXT = 'Circles show the area, not the address';
/** The legend's extra line while count bubbles show (far zoom; the mock's words). */
export const LEGEND_BUBBLE_TEXT = 'Bubble colour = hottest inside';
/** The round menu button's spoken label (VC-85: it opens the map key). */
export const MENU_LABEL = 'Map key';
/** The muted place name in the top bar (VC-85 spec "Chrome"). */
export const MAP_CITY = 'Washington';
/** How long the first-open hint stays, in ms, unless the guest acts first. */
export const HINT_MS = 6000;

/**
 * Whether the "Circles show the area" hint has been shown in this app run
 * (VC-85: "first-open hint once"). Kept in memory only: it shows again
 * after the app restarts, which is fine for a short hint.
 */
let hintShown = false;

/**
 * Lets tests start with the hint unseen again.
 *
 * @param shown - true to act as if it was already shown (default false).
 */
export function resetMapHintForTests(shown = false): void {
  hintShown = shown;
}

/** A swipe down at least this far (in px) closes the card. */
export const SWIPE_CLOSE_PX = 60;

/** ...or a quicker flick down than this (px per ms) closes it too. */
const SWIPE_CLOSE_SPEED = 0.5;

/**
 * Whether a finger movement on the card is a swipe DOWN (so the card takes
 * it), rather than a sideways swipe for the pager or a tap.
 *
 * @param dx - how far the finger moved sideways, in px.
 * @param dy - how far it moved down (negative: up), in px.
 * @returns true when it moved down more than 10 px and mostly downwards.
 */
export function isSwipeDown(dx: number, dy: number): boolean {
  return dy > 10 && Math.abs(dy) > Math.abs(dx) * 2;
}

/**
 * Whether a finished swipe down closes the card.
 *
 * @param dy - how far down the finger moved, in px.
 * @param vy - its speed downwards when let go, in px per ms.
 * @returns true for a long enough drag or a quick flick.
 */
export function swipeCloses(dy: number, vy: number): boolean {
  return dy >= SWIPE_CLOSE_PX || (dy > 10 && vy > SWIPE_CLOSE_SPEED);
}

/**
 * How long the camera takes to ease to a picked tag, in ms (VC-85: 520,
 * was 350). Apple Maps uses its own ease-out curve; we can only set the time.
 */
export const CAMERA_MS = 520;

/** How long the camera takes to open up a tapped count bubble, in ms (VC-85: 450). */
export const CLUSTER_MS = 450;

/** How long the bottom card takes to slide up and fade in, in ms (VC-85: 280, no bounce). */
export const CARD_RISE_MS = 280;

/**
 * How far below a picked tag the camera centres, as a share of the map's
 * height: 0.18 puts the tag about a third of the way down, above the card.
 */
export const CARD_LIFT = 0.18;

/** Space kept at the sides when the map frames the circles (spec §4: 48 px). */
const FIT_SIDE = 48;

/**
 * The least space kept at the top and bottom when framing: the floating
 * top bar (40 px) with 12 px of margin above and below it.
 */
const FIT_MIN_EDGE = 12 + GLASS_BUTTON_SIZE + 12;

/**
 * The space kept round the circles when the map frames them (cto, VC-85).
 *
 * Why: the edge fade darkens the top and bottom 22% of the map, and the
 * glass bar floats over the top. A tag framed inside those bands would sit
 * on a dark wash (or under the bar) and lose its strong text contrast. So
 * the top and bottom keep 22% of the map's height clear, and never less
 * than the bar plus its margins.
 *
 * @param size - the map's size on screen, in px.
 * @returns the edge padding for fitToCoordinates.
 */
export function fitPadding(size: MapSize): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const edge = Math.max(Math.round(size.height * EDGE_FADE_SHARE), FIT_MIN_EDGE);
  return { top: edge, right: FIT_SIDE, bottom: edge, left: FIT_SIDE };
}

/** The map's view when there's nothing to show: central DC, about 12 km across. */
export const DC_REGION: Region = { ...DC_CENTRE, latitudeDelta: 0.11, longitudeDelta: 0.11 };

/** How close the "Show my location" button zooms (about 2 km across). */
const ME_DELTA = 0.02;

/**
 * How far in and out the guest can zoom (VC-85 spec "Zoom limits"), as the
 * camera's height above the map's centre, in metres. Apple Maps only.
 *   - 400 m is about street level: closer, Apple shows road names and
 *     shop clutter, and our tags would cover whole blocks;
 *   - 400 km still frames DC, Baltimore and Richmond together (about 240
 *     km from end to end), but no further: there are no events beyond.
 * It is a ZOOM limit only; Apple Maps (through react-native-maps) has no
 * way to stop panning away, so the guest can still drag elsewhere.
 */
export const ZOOM_RANGE = {
  minCenterCoordinateDistance: 400,
  maxCenterCoordinateDistance: 400_000,
  animated: true,
};

/**
 * Dark map colours for Google Maps ONLY (kept for Android, once a Google
 * key is approved; VC-85 step 2 may replace it with a custom base map).
 *
 * VC-85: this does NOTHING on iPhone. Apple Maps ignores style lists, so
 * the iPhone map no longer passes it; it uses Apple's own dark mode and
 * the "muted" map type instead. Nothing draws an Android map yet either
 * (it shows "Map coming soon"), so today this list is unused.
 */
export const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#141417' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#A19C92' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0A0A0C' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#24242A' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0A0A0C' }] },
];

/** What a TonightMap needs. */
export interface TonightMapProps {
  /** The date filter shared with the list. */
  filter: DateFilter;
  /** Switches Tonight back to the list. */
  onSeeList: () => void;
  /** Opens an event's page. */
  onOpenEvent: (id: string) => void;
}

/**
 * Renders the map, or the Android stand-in.
 *
 * @returns the map view with its overlays.
 */
export function TonightMap(props: TonightMapProps) {
  if (Platform.OS !== 'ios') return <AndroidFallback onSeeList={props.onSeeList} />;
  return <IosMap {...props} />;
}

/**
 * Android for now: no map (no Google key yet), just a way back to the list.
 *
 * @param props.onSeeList - switches to the list.
 * @returns a quiet card with "Map coming soon" and "See the list".
 */
function AndroidFallback({ onSeeList }: { onSeeList: () => void }) {
  return (
    <View style={styles.fallback} testID="map-android-fallback">
      <StatusPanel tone="quiet" title={ANDROID_TITLE} message={ANDROID_BODY}>
        <Button label={SEE_LIST_LABEL} variant="outline" size="small" onPress={onSeeList} />
      </StatusPanel>
    </View>
  );
}

/**
 * What the map is showing:
 *   loading - the first load for this filter is on its way;
 *   error   - it failed (message plus "Try again");
 *   ready   - the points (maybe none), whether more than 300 exist, and the
 *             moment they were loaded (for the "when" lines).
 */
type MapState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; points: MapPoint[]; more: boolean; at: Date };

/** The "loading" state (one shared object). */
const LOADING: MapState = { kind: 'loading' };

/**
 * A MapState together with WHO it was loaded for (their profile id), so a
 * map loaded by one person is never shown to the next person who signs in
 * on the same phone (cto, VC-83: e.g. a tester's test events).
 */
interface LoadedFor {
  viewer: string | null;
  state: MapState;
}

/**
 * The real map (iPhone).
 *
 * @returns the map with its glows, tags, overlays and tap card.
 */
function IosMap({ filter, onSeeList, onOpenEvent }: TonightMapProps) {
  const mapRef = useRef<MapView>(null);
  // Who is signed in. Signing out (or another person signing in) hides what
  // was loaded before, and loads again for the new person.
  const { profile } = useAuth();
  const viewerId = profile?.id ?? null;
  const [loaded, setLoaded] = useState<LoadedFor>({ viewer: null, state: LOADING });
  // Only what was loaded for THIS person counts; anything else reads as loading.
  const state: MapState = viewerId !== null && loaded.viewer === viewerId ? loaded.state : LOADING;
  // Bumped by "Try again".
  const [attempt, setAttempt] = useState(0);
  // Numbers each load, so a slow answer for an old filter (or an old
  // person) is ignored.
  const loadSeq = useRef(0);
  // The picked area's label, "venue:<id>" for a venue tag, or null (no card).
  const [selected, setSelected] = useState<string | null>(null);
  // True once the map can take framing commands.
  const [mapReady, setMapReady] = useState(false);
  // Which load the map last framed itself for (person + filter + "Try
  // again"), so a minute refresh never moves the map under the guest's finger.
  const framedFor = useRef<string | null>(null);
  // The map's current view (updated after every pan or zoom): easing to a
  // picked tag keeps the guest's own zoom level, and the zoom level decides
  // between bubbles, dots and tags (VC-83 Batch 2). Only updated when a pan
  // or zoom ENDS, so markers aren't re-planned mid-gesture.
  const [region, setRegion] = useState<Region>(DC_REGION);
  // The map's size on screen (null until measured; Jest never measures).
  const [mapSize, setMapSize] = useState<MapSize | null>(null);
  // Whether this screen is in view: the pulse rests (still rings) when not.
  const [focused, setFocused] = useState(true);
  // Location: shown only if already allowed. Never asked for here.
  const [locationAllowed, setLocationAllowed] = useState(false);
  // The last known spot of the blue dot (only on this phone, never sent).
  const myCoord = useRef<{ latitude: number; longitude: number } | null>(null);
  const reduceMotion = useReduceMotion();
  const moving = motionAllowed(reduceMotion);
  // VC-85: the map key's panel under the round menu button.
  const [menuOpen, setMenuOpen] = useState(false);
  // VC-85: the "Circles show the area" hint, the first time the map opens
  // in this app run (read once, when the map first draws).
  const [hint, setHint] = useState(() => !hintShown);
  useEffect(() => {
    if (!hint) return;
    hintShown = true;
    // VoiceOver doesn't read a note that just appears, so say it once.
    // (Android reads it through the pill's live region below.)
    AccessibilityInfo.announceForAccessibility(LEGEND_TEXT);
    // It goes away by itself after a few seconds.
    const timer = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(timer);
  }, [hint]);

  // The filter as text, so effects restart only when it really changes.
  const filterKey = JSON.stringify(filter);

  // Read (never request) the location permission once.
  useEffect(() => {
    let active = true;
    Location.getForegroundPermissionsAsync()
      .then((answer) => {
        if (active) setLocationAllowed(answer.granted === true);
      })
      // If the phone can't say, act as "not allowed": no dot.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Load the points when the map opens, the filter changes, "Try again", or
  // a different person signs in. Nothing loads while signed out. State is
  // only set inside `.then`, and a late answer for an older load is ignored
  // (the list's rule, VC-B03).
  useEffect(() => {
    // A new load (or signing out) makes any answer still on its way stale.
    const seq = ++loadSeq.current;
    if (viewerId === null) return;
    let active = true;
    const now = new Date();
    listMapPoints(now, filter).then((outcome) => {
      if (!active || seq !== loadSeq.current) return;
      setSelected(null);
      setLoaded({
        viewer: viewerId,
        state: outcome.ok
          ? { kind: 'ready', points: outcome.points, more: outcome.more, at: now }
          : { kind: 'error', message: outcome.message },
      });
    });
    return () => {
      active = false;
    };
    // filterKey stands for filter (a new object with the same dates is the same filter).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, attempt, viewerId]);

  // Every minute while the map is on screen: reload quietly for fresh
  // published scores. A failed refresh keeps what is shown. The card stays
  // open if its area is still there.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const timer = setInterval(() => {
        if (AppState.currentState === 'background' || viewerId === null) return;
        const now = new Date();
        const seq = loadSeq.current;
        listMapPoints(now, filter).then((outcome) => {
          if (!active || seq !== loadSeq.current || !outcome.ok) return;
          setLoaded({
            viewer: viewerId,
            state: { kind: 'ready', points: outcome.points, more: outcome.more, at: now },
          });
        });
      }, LIST_VIBE_REFRESH_MS);
      return () => {
        active = false;
        clearInterval(timer);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterKey, viewerId]),
  );

  // The pulse only moves while this screen is in view (spec §4).
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const layout = useMemo(() => groupMapPoints(state.kind === 'ready' ? state.points : []), [state]);
  // Every spot on the map (areas, then venues), with its tag's width.
  const spots = useMemo(() => mapSpots(layout), [layout]);
  // What to draw for this zoom: bubbles, dots or tags (src/lib/map-cluster.ts).
  const plan = useMemo(
    () => planMap(spots, region, mapSize ?? DEFAULT_MAP_SIZE, selected),
    [spots, region, mapSize, selected],
  );

  // Frame the circles once per load (not on refreshes). With nothing to
  // show, centre on DC. Under Reduce Motion the map jumps instead of gliding.
  useEffect(() => {
    if (!mapReady || state.kind !== 'ready') return;
    const key = `${viewerId}#${filterKey}#${attempt}`;
    if (framedFor.current === key) return;
    framedFor.current = key;
    const coords = fitCoordinates(layout);
    if (coords.length === 0) mapRef.current?.animateToRegion(DC_REGION, moving ? 300 : 0);
    else {
      // Before the map has been measured, assume a typical phone's size.
      const edgePadding = fitPadding(mapSize ?? DEFAULT_MAP_SIZE);
      mapRef.current?.fitToCoordinates(coords, { edgePadding, animated: moving });
    }
    // Framing happens once per load (framedFor), so a later size change
    // never moves the map; mapSize is listed only to read its latest value.
  }, [mapReady, state.kind, layout, filterKey, attempt, moving, viewerId, mapSize]);

  // VC-85: how long each new tag waits before fading in (hottest first).
  const appearDelays = useMemo(() => tagAppearDelays(plan.markers), [plan]);

  const selectedArea = pickedGroup(layout.areas, layout.venues, selected);
  const now = state.kind === 'ready' ? state.at : new Date(0);
  const eventCount = layout.areas.reduce((n, a) => n + a.events.length, 0) + layout.venues.length;

  /**
   * Picks a tag: opens its card and eases the camera so the tag sits in the
   * upper part of the map, above the card. The zoom level stays the
   * guest's own. Under Reduce Motion the camera jumps.
   *
   * @param key - the selection key (an area label, or "venue:<id>").
   * @param at - the tag's point (exactly what the server sent).
   */
  function pick(key: string, at: { latitude: number; longitude: number }) {
    setSelected(key);
    // The guest has found their way around: the hint and the key can go.
    setHint(false);
    setMenuOpen(false);
    const { latitudeDelta, longitudeDelta } = region;
    mapRef.current?.animateToRegion(
      {
        // Centre a little SOUTH of the tag, so the tag shows above the centre.
        latitude: at.latitude - latitudeDelta * CARD_LIFT,
        longitude: at.longitude,
        latitudeDelta,
        longitudeDelta,
      },
      moving ? CAMERA_MS : 0,
    );
  }

  /**
   * A tap on a count bubble: zooms in just enough to open it up (450 ms
   * since VC-85, or a jump under Reduce Motion). One area with several parties zooms to
   * the close level around its centre, where its tag shows.
   *
   * @param cluster - the tapped bubble.
   */
  function openCluster(cluster: Extract<PlannedMarker, { kind: 'cluster' }>) {
    mapRef.current?.animateToRegion(regionToFit(cluster.spots, region), moving ? CLUSTER_MS : 0);
  }

  /** Closes the card (empty map tap, swipe down, or the screen reader's escape). */
  const closeCard = useCallback(() => setSelected(null), []);

  /**
   * Draws one planned marker: a count bubble, a heat dot or a full tag.
   *
   * @param marker - from the plan.
   * @returns the map marker.
   */
  function renderMarker(marker: PlannedMarker) {
    if (marker.kind === 'cluster') {
      const events = marker.spots.flatMap((s) => s.events);
      return (
        <MapCluster
          key={`cluster-${marker.key}`}
          coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
          count={marker.count}
          band={marker.band}
          noun={events.every((e) => e.source === 'host') ? 'parties' : 'events'}
          onPress={() => openCluster(marker)}
          testID={`map-cluster-${marker.key}`}
        />
      );
    }
    const { spot } = marker;
    const at = { latitude: spot.latitude, longitude: spot.longitude };
    const look = spotLook(spot);
    if (marker.kind === 'dot') {
      return (
        <MapDot
          key={`dot-${spot.key}`}
          coordinate={at}
          dot={look.dot}
          picked={spot.key === selected}
          onPress={() => pick(spot.key, at)}
          spoken={look.spoken}
          testID={`map-dot-${spot.key}`}
        />
      );
    }
    // A pulsing tag moves only with motion allowed and the screen in view;
    // otherwise its ring stays still.
    const pulse: PulseMode = !marker.pulse ? 'off' : moving && focused ? 'moving' : 'still';
    return (
      <MapTag
        key={`tag-${spot.key}`}
        coordinate={at}
        {...look}
        picked={spot.key === selected}
        onPress={() => pick(spot.key, at)}
        animate={moving}
        pulse={pulse}
        pulseDelay={pulseDelay(spot.key)}
        appearDelay={appearDelays.get(spot.key) ?? 0}
        testID={spotTestID(spot)}
      />
    );
  }

  /**
   * A tap on the map: a circle opens its card, empty map closes it.
   *
   * @param event - where the tap landed. Taps on a tag also arrive here on
   *   iPhone (as "marker-press"); the tag handles those itself.
   */
  function onMapPress(event: MapPressEvent) {
    if (event.nativeEvent.action === 'marker-press') return;
    const hit = areaAt(event.nativeEvent.coordinate, layout.areas);
    if (hit) pick(hit.label, hit);
    else {
      setSelected(null);
      setMenuOpen(false);
    }
  }

  /** Remembers the blue dot's spot for the "Show my location" button (stays on the phone). */
  function onUserLocation(event: UserLocationChangeEvent) {
    const c = event.nativeEvent.coordinate;
    if (c) myCoord.current = { latitude: c.latitude, longitude: c.longitude };
  }

  /** Centres the map on the guest's own dot, if the phone knows it yet. */
  function showMe() {
    const me = myCoord.current;
    if (!me) return;
    mapRef.current?.animateToRegion(
      { ...me, latitudeDelta: ME_DELTA, longitudeDelta: ME_DELTA },
      moving ? 300 : 0,
    );
  }

  const spokenSummary =
    state.kind === 'ready'
      ? `Map of ${eventCount} ${eventCount === 1 ? 'event' : 'events'} in ${layout.areas.length} ${
          layout.areas.length === 1 ? 'area' : 'areas'
        }. Circles show the area only, never the exact spot.`
      : 'Map of events. Loading.';

  return (
    <View style={styles.fill}>
      {/* One element for screen readers (the summary); the glows and tags
          inside stay for sighted guests. "See the list" below is the
          alternative. */}
      <View
        style={styles.fill}
        accessible
        accessibilityLabel={spokenSummary}
        testID="tonight-map-region"
        onLayout={(e: LayoutChangeEvent) => {
          const { width, height } = e.nativeEvent.layout;
          if (width > 0 && height > 0) setMapSize({ width, height });
        }}
      >
        <MapView
          ref={mapRef}
          testID="tonight-map"
          style={styles.fill}
          initialRegion={DC_REGION}
          userInterfaceStyle="dark"
          // VC-85: Apple's flattest, least colourful map. (No
          // customMapStyle: that list is Google-only; see DARK_MAP_STYLE.)
          mapType="mutedStandard"
          // No shop, food or other place icons. An EMPTY filter tells
          // react-native-maps to fall back to the switch below, which hides
          // every category (Apple's "exclude all" filter).
          pointsOfInterestFilter={[]}
          showsPointsOfInterests={false}
          cameraZoomRange={ZOOM_RANGE}
          showsBuildings={false}
          showsTraffic={false}
          showsCompass={false}
          pitchEnabled={false}
          rotateEnabled={false}
          // The blue dot only with a permission the guest already gave.
          showsUserLocation={locationAllowed}
          onUserLocationChange={locationAllowed ? onUserLocation : undefined}
          onMapReady={() => setMapReady(true)}
          onRegionChangeComplete={(r: Region) => setRegion(r)}
          onPress={onMapPress}
        >
          {/* Every area's glow, at every zoom (its size is the area's). */}
          {layout.areas.map((area) => (
            <AreaHeat
              key={`heat-${area.label}`}
              latitude={area.latitude}
              longitude={area.longitude}
              radius={area.radius}
              band={hottestBand(area.events)}
              fade={moving}
            />
          ))}
          {/* Then the markers this zoom calls for. Venue spots exist only for
              kind 'venue', and none arrive while the server's staff-pick pin
              switch is off. */}
          {plan.markers.map(renderMarker)}
        </MapView>
      </View>

      {/* VC-85: the dark edge fade (a picture; touches go through it). */}
      <MapVignette />

      {/* Top: the floating glass bar and its menu button, then loading, the
          first-open hint, and the notes about what the map can't show. */}
      <View style={styles.topRow} pointerEvents="box-none">
        <View style={styles.topBar} pointerEvents="box-none">
          <View
            style={styles.topPill}
            accessible
            accessibilityLabel={`${filterTitle(filter, new Date())}, ${MAP_CITY}`}
            testID="map-top-bar"
          >
            <View style={styles.topDot} />
            <Text style={styles.topTitle} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {filterTitle(filter, new Date())}
              <Text style={styles.topCity}> · {MAP_CITY}</Text>
            </Text>
          </View>
          <GlassCircleButton
            icon="info"
            label={MENU_LABEL}
            onPress={() => {
              setMenuOpen((open) => !open);
              setHint(false);
            }}
            animate={moving}
            expanded={menuOpen}
            testID="map-menu-button"
          />
        </View>
        {menuOpen ? (
          <View
            style={styles.menu}
            testID="map-menu"
            onAccessibilityEscape={() => setMenuOpen(false)}
          >
            <Legend bubbles={plan.markers.some((m) => m.kind === 'cluster')} />
          </View>
        ) : null}
        {hint && !menuOpen ? (
          <View style={styles.pill} testID="map-hint" accessibilityLiveRegion="polite">
            <Text style={styles.pillText} maxFontSizeMultiplier={1.3}>
              {LEGEND_TEXT}
            </Text>
          </View>
        ) : null}
        {state.kind === 'loading' ? (
          <View style={styles.pill} accessibilityLiveRegion="polite">
            <Text style={styles.pillText} maxFontSizeMultiplier={1.3}>
              {MAP_LOADING_LABEL}
            </Text>
          </View>
        ) : null}
        {state.kind === 'ready' && layout.unplaced > 0 ? (
          <Pressable
            style={styles.pill}
            onPress={onSeeList}
            accessibilityRole="link"
            testID="map-unplaced"
          >
            <Text style={styles.pillText} maxFontSizeMultiplier={1.3}>
              {unplacedText(layout.unplaced)}
            </Text>
          </Pressable>
        ) : null}
        {state.kind === 'ready' && state.more ? (
          <View style={styles.pill}>
            <Text style={styles.pillText} maxFontSizeMultiplier={1.3}>
              {MORE_THAN_LIMIT}
            </Text>
          </View>
        ) : null}
      </View>

      {state.kind === 'error' ? (
        <View style={styles.overlayCard}>
          <StatusPanel tone="error" message={state.message}>
            <Button
              label="Try again"
              variant="outline"
              onPress={() => {
                setLoaded({ viewer: viewerId, state: LOADING });
                setAttempt((n) => n + 1);
              }}
            />
          </StatusPanel>
        </View>
      ) : null}

      {state.kind === 'ready' && eventCount === 0 && layout.unplaced === 0 ? (
        <EmptyCard filter={filter} onSeeList={onSeeList} />
      ) : null}

      {/* Bottom: "See the list" and the locate button, 12 px above the card. */}
      <View style={styles.bottom} pointerEvents="box-none">
        <View style={styles.bottomRow} pointerEvents="box-none">
          <Pressable
            style={styles.seeList}
            onPress={onSeeList}
            accessibilityRole="button"
            accessibilityLabel={SEE_LIST_LABEL}
            testID="map-see-list"
          >
            <Text style={styles.seeListText} maxFontSizeMultiplier={1.3}>
              {SEE_LIST_LABEL}
            </Text>
          </Pressable>
          {locationAllowed ? (
            <GlassCircleButton
              icon="pin"
              label={LOCATE_LABEL}
              onPress={showMe}
              iconColour={colors.accent}
              animate={moving}
              testID="map-locate"
            />
          ) : null}
        </View>
        {selectedArea ? (
          <AreaCard
            key={selectedArea.label}
            area={selectedArea}
            now={now}
            onOpenEvent={onOpenEvent}
            onClose={closeCard}
            animatePress={moving}
            rise={moving}
          />
        ) : null}
      </View>
    </View>
  );
}

/**
 * "2 events aren't on the map. See the list" (free-text areas).
 *
 * @param n - how many events have no place on the map.
 * @returns the pill's words.
 */
export function unplacedText(n: number): string {
  return n === 1
    ? "1 event isn't on the map. See the list"
    : `${n} events aren't on the map. See the list`;
}

/**
 * The selection key of a venue tag.
 *
 * @param venue - a 'venue' row.
 * @returns "venue:<event id>" (area labels never start with "venue:").
 */
function venueKey(venue: MapPoint): string {
  return `venue:${venue.event_id}`;
}

/**
 * What the tap card shows for the current selection.
 *
 * @param areas - the circles.
 * @param venues - the venue tags.
 * @param selected - the selection key, or null.
 * @returns the picked area, a one-event group for a picked venue, or null.
 */
function pickedGroup(
  areas: AreaGroup[],
  venues: MapPoint[],
  selected: string | null,
): AreaGroup | null {
  if (selected === null) return null;
  const area = areas.find((a) => a.label === selected);
  if (area) return area;
  const venue = venues.find((v) => venueKey(v) === selected);
  if (!venue || venue.lat === null || venue.lng === null) return null;
  return { label: selected, latitude: venue.lat, longitude: venue.lng, radius: 0, events: [venue] };
}

/** What eventTag and groupTag work out for a MapTag (the rest comes from the map). */
export type TagLook = Pick<MapTagProps, 'name' | 'trailing' | 'trailingIsScore' | 'dot' | 'spoken'>;

/**
 * The tag for ONE event: its name, then its published score, its start
 * time, or "Too early".
 *
 * @param point - the map row.
 * @returns the tag's words, dot and spoken label (no counts of any kind).
 */
export function eventTag(point: MapPoint): TagLook {
  const state = tagState(point);
  return {
    name: tagName(point.title),
    trailing: tagTrailing(state),
    trailingIsScore: state.kind === 'score',
    dot:
      state.kind === 'score'
        ? { kind: 'band', band: state.band }
        : state.kind === 'before'
          ? { kind: 'muted' }
          : { kind: 'dashed' },
    spoken: tagSpoken(point),
  };
}

/**
 * The tag for an area with 2+ events: "Shaw" and "2 parties" ("2 events"
 * when a staff pick is among them), with the dot in the hottest PUBLISHED
 * band there (cto review point 1: a word band only, never a number). Each
 * event's own name and score are in the card's pager.
 *
 * @param area - the area and its events.
 * @returns the tag's words, dot and spoken label.
 */
export function groupTag(area: AreaGroup): TagLook {
  const n = area.events.length;
  const noun = area.events.every((e) => e.source === 'host') ? 'parties' : 'events';
  const band = hottestBand(area.events);
  const name = shortArea(area.label);
  return {
    name,
    trailing: `${n} ${noun}`,
    trailingIsScore: false,
    dot: band ? { kind: 'band', band } : { kind: 'muted' },
    spoken: `${name}, ${n} ${noun}, area only${band ? `, hottest vibe ${band}` : ''}`,
  };
}

/**
 * What a spot's tag (or the dot standing in for it) says.
 *
 * @param spot - an area's spot or a venue's spot.
 * @returns the one event's tag, or the "Shaw 2 parties" group tag.
 */
function spotLook(spot: MapSpot): TagLook {
  if (spot.events.length === 1) return eventTag(spot.events[0]);
  return groupTag({ label: spot.key, ...spot, radius: 0 });
}

/**
 * The test id of a spot's tag (unchanged from Batch 1).
 *
 * @param spot - an area's spot or a venue's spot.
 * @returns "map-venue-<event id>" for a venue, "map-area-<label>" for an area.
 */
function spotTestID(spot: MapSpot): string {
  const one = spot.events[0];
  return spot.key === venueKey(one) ? `map-venue-${one.event_id}` : `map-area-${spot.key}`;
}

/**
 * Turns the map's layout into spots for the zoom planner: one per area (all
 * its parties share the area's centre) and one per venue (only kind
 * 'venue', none while the server's pin switch is off).
 *
 * @param layout - from groupMapPoints.
 * @returns the spots, each with its full tag's estimated width.
 */
function mapSpots(layout: { areas: AreaGroup[]; venues: MapPoint[] }): MapSpot[] {
  const spots: MapSpot[] = [];
  /** Adds one spot, measuring its tag from what the tag will say. */
  const add = (key: string, latitude: number, longitude: number, events: MapPoint[]) => {
    const spot: MapSpot = { key, latitude, longitude, events, tagWidth: 0 };
    const look = spotLook(spot);
    spot.tagWidth = estimateTagWidth(look.name, look.trailing);
    spots.push(spot);
  };
  for (const area of layout.areas) add(area.label, area.latitude, area.longitude, area.events);
  for (const venue of layout.venues) {
    if (venue.kind === 'venue' && venue.lat !== null && venue.lng !== null) {
      add(venueKey(venue), venue.lat, venue.lng, [venue]);
    }
  }
  return spots;
}

/**
 * The map key (legend): the four bands as small gold swatches, coolest to
 * hottest, and a reminder that circles show areas only. While count
 * bubbles show, one more line: "Bubble colour = hottest inside". VC-85: it
 * sits inside the menu panel (it used to float at the bottom left).
 *
 * @param props.bubbles - true while the map shows count bubbles (far zoom).
 * @returns the legend (read out as one sentence).
 */
function Legend({ bubbles }: { bubbles: boolean }) {
  return (
    <View
      style={styles.legend}
      accessible
      accessibilityLabel={`Heat from ${BANDS.join(', ')}. ${LEGEND_TEXT}.${
        bubbles ? ` ${LEGEND_BUBBLE_TEXT}.` : ''
      }`}
      testID="map-legend"
    >
      <View style={styles.legendBands}>
        {BANDS.map((band) => (
          <View key={band} style={styles.legendBand}>
            <View style={[styles.legendSwatch, { backgroundColor: wordColour(band) }]} />
            <Text style={styles.legendWord} maxFontSizeMultiplier={1.3}>
              {band}
            </Text>
          </View>
        ))}
      </View>
      <Text style={styles.legendText} maxFontSizeMultiplier={1.3}>
        {LEGEND_TEXT}
      </Text>
      {bubbles ? (
        <Text style={styles.legendText} maxFontSizeMultiplier={1.3}>
          {LEGEND_BUBBLE_TEXT}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The card at the bottom for a picked area: one mini card per event,
 * swiped sideways, with small dots ("1 of 2" to screen readers) when there
 * are several. It slides up and fades in (VC-85: 280 ms, easing out with
 * no bounce), or simply appears under Reduce Motion.
 *
 * VC-83 Batch 2: the pages go hottest first (each with its own published
 * score; there is no area score), then by start time. A swipe down closes
 * the card; screen reader users close it with the "escape" gesture (two
 * fingers in a Z on iPhone), or by tapping elsewhere.
 *
 * @param props.area - the picked area.
 * @param props.now - the moment the points were loaded (for "when" lines).
 * @param props.onOpenEvent - opens an event's page.
 * @param props.onClose - closes the card (must stay the same function).
 * @param props.animatePress - false under Reduce Motion.
 * @param props.rise - false under Reduce Motion (no rise, no spring back).
 * @returns the card.
 */
function AreaCard({
  area,
  now,
  onOpenEvent,
  onClose,
  animatePress,
  rise,
}: {
  area: AreaGroup;
  now: Date;
  onOpenEvent: (id: string) => void;
  onClose: () => void;
  animatePress: boolean;
  rise: boolean;
}) {
  // The card's inner width (a page of the pager), once laid out.
  const [width, setWidth] = useState(0);
  const n = area.events.length;
  // Hottest first, then by start time (spec §6).
  const pages = useMemo(() => pagerOrder(area.events), [area.events]);
  // The event the guest is looking at, by id, plus the page number it was
  // on. VC-84 fix: the minute refresh can re-sort the pages (a party turns
  // Fire and jumps to the front). Remembering only the page NUMBER made the
  // card switch to a different event under the guest's finger, so we
  // remember the event itself. It starts on the first page's event (the
  // card is drawn anew for each pick).
  const [viewed, setViewed] = useState(() => ({
    id: pagerOrder(area.events)[0]?.event_id ?? null,
    index: 0,
  }));
  // Where that event sits in the (maybe re-sorted) pages now. If it left
  // the area (it ended or was removed), stay on the same page number,
  // or the last page if there are fewer now.
  const found = pages.findIndex((p) => p.event_id === viewed.id);
  // The event moved to another page: note its new page number too (React's
  // "adjust state while drawing" pattern), so if it later leaves, the card
  // stays where the guest last saw it rather than on an old number.
  if (found >= 0 && found !== viewed.index) setViewed({ id: viewed.id, index: found });
  const page = found >= 0 ? found : Math.max(0, Math.min(viewed.index, n - 1));
  // The pager itself, so it can be moved to that page.
  const pagerRef = useRef<ScrollViewInstance>(null);
  // Keep the pager on the viewed event's page: after a re-sort its page
  // number changes, so scroll there at once (no animation, so nothing
  // seems to slide by itself). When the guest swiped, it is already there,
  // so this does nothing visible.
  useEffect(() => {
    if (width > 0) pagerRef.current?.scrollTo({ x: page * width, animated: false });
  }, [page, width]);

  // Swipe down to close. How far the card has been dragged down, in px.
  const [drag] = useState(() => new Animated.Value(0));
  // Bumped when a swipe should close the card. The swipe handler is built
  // once, so it can't call the latest onClose itself; an effect does
  // (expo lint's rule about values reachable from such handlers, VC-76).
  const [closeAsks, setCloseAsks] = useState(0);
  const [swipe] = useState(() =>
    PanResponder.create({
      // Take the touch only for a clear downward drag, so sideways swipes
      // still turn the pager's pages and taps still open the event.
      onMoveShouldSetPanResponderCapture: (_e, g) => isSwipeDown(g.dx, g.dy),
      onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (swipeCloses(g.dy, g.vy)) setCloseAsks((k) => k + 1);
        else
          Animated.timing(drag, {
            toValue: 0,
            duration: rise ? 160 : 0,
            useNativeDriver: true,
          }).start();
      },
      // Another view took the touch over: put the card back.
      onPanResponderTerminate: () => drag.setValue(0),
    }),
  );
  useEffect(() => {
    if (closeAsks > 0) onClose();
  }, [closeAsks, onClose]);
  // 0 = lowered and clear, 1 = in place. The card is drawn anew for each
  // pick (its key is the pick), so this runs once per opened card.
  const [shown] = useState(() => new Animated.Value(rise ? 0 : 1));
  useEffect(() => {
    if (!rise) return;
    Animated.timing(shown, {
      toValue: 1,
      duration: CARD_RISE_MS,
      easing: MAP_EASE,
      useNativeDriver: true,
    }).start();
  }, [rise, shown]);
  // It rises the last 30 px into place.
  const lift = shown.interpolate({ inputRange: [0, 1], outputRange: [30, 0] });

  /**
   * Works out which page the pager stopped on, and remembers that page's
   * event (by id, so a later re-sort can't swap it; VC-84 fix).
   *
   * @param event - the scroll view's "momentum ended" event; its sideways
   *   offset divided by the page width is the page number.
   */
  function onScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (width <= 0) return;
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    setViewed({ id: pages[index]?.event_id ?? null, index });
  }

  return (
    <Animated.View
      style={[
        styles.tapCard,
        // It rises into place, and follows the finger down while swiped.
        { opacity: shown, transform: [{ translateY: Animated.add(lift, drag) }] },
      ]}
      testID="map-tap-card"
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width - 2 * spacing.gap12)}
      onAccessibilityEscape={onClose}
      {...swipe.panHandlers}
    >
      <ScrollView
        ref={pagerRef}
        testID="map-card-pager"
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
      >
        {pages.map((point) => (
          <View key={point.event_id} style={width > 0 ? { width } : styles.pageFallback}>
            <MapMiniCard
              point={point}
              now={now}
              onPress={onOpenEvent}
              animatePress={animatePress}
            />
          </View>
        ))}
      </ScrollView>
      {n > 1 ? <PagerDots page={Math.min(page, n - 1)} count={n} /> : null}
    </Animated.View>
  );
}

/**
 * The card's page dots (VC-85: 5 px, the current one gold). Only drawn for
 * 2 or more pages.
 *
 * @param props.page - the page showing now (0 = first).
 * @param props.count - how many pages.
 * @returns a row of dots, read to screen readers as e.g. "1 of 2".
 */
function PagerDots({ page, count }: { page: number; count: number }) {
  return (
    <View
      style={styles.dots}
      accessible
      accessibilityLabel={`${page + 1} of ${count}`}
      testID="map-card-dots"
    >
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.dotMark, i === page && styles.dotMarkOn]} />
      ))}
    </View>
  );
}

/**
 * Shown over the map when the filter's nights have no events.
 *
 * @param props.filter - the filter in use (its own empty words).
 * @param props.onSeeList - switches to the list.
 * @returns a card with the heading, the sentence and "See the list".
 */
function EmptyCard({ filter, onSeeList }: { filter: DateFilter; onSeeList: () => void }) {
  const text = filterEmptyText(filter, new Date());
  return (
    <View style={styles.overlayCard} testID="map-empty">
      <StatusPanel tone="quiet" title={text.title} message={text.body}>
        <Button label={SEE_LIST_LABEL} variant="outline" size="small" onPress={onSeeList} />
      </StatusPanel>
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  fallback: { flex: 1, paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  // VC-85: the floating chrome sits 12 px from the map's edges.
  topRow: {
    position: 'absolute',
    top: spacing.gap12,
    left: spacing.gap12,
    right: spacing.gap12,
    alignItems: 'center',
    gap: spacing.sm,
  },
  // The glass bar and the round menu button beside it.
  topBar: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  topPill: {
    flex: 1,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: glass.fill,
    borderWidth: 1,
    borderColor: glass.hairline,
  },
  topDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.accent },
  topTitle: {
    flexShrink: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  topCity: { fontFamily: fonts.bodyMedium, color: colors.muted },
  // The map key's glass panel, under the menu button.
  menu: {
    alignSelf: 'flex-end',
    maxWidth: 300,
    paddingHorizontal: spacing.gap12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: glass.fill,
    borderWidth: 1,
    borderColor: glass.hairline,
  },
  // The small notes at the top (glass pills since VC-85).
  pill: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: glass.fill,
    borderWidth: 1,
    borderColor: glass.hairline,
  },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 13, lineHeight: 18, color: colors.text },
  overlayCard: {
    position: 'absolute',
    top: 56,
    left: spacing.gutter,
    right: spacing.gutter,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
  },
  // VC-85: 12 px from the sides, 14 above the tab bar, 12 between rows.
  bottom: {
    position: 'absolute',
    left: spacing.gap12,
    right: spacing.gap12,
    bottom: 14,
    gap: spacing.gap12,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  // The map key: no box of its own (the menu panel is its glass).
  legend: { flexShrink: 1, gap: spacing.xs },
  legendBands: { flexDirection: 'row', gap: 6 },
  legendBand: { alignItems: 'center', gap: 3 },
  legendSwatch: { width: 28, height: 6, borderRadius: 3 },
  legendWord: {
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  legendText: { ...typography.caption, fontSize: 11, lineHeight: 14, color: colors.muted },
  // "See the list": a 44 px tall gold-text glass pill.
  seeList: {
    minHeight: minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: glass.fill,
    borderWidth: 1,
    borderColor: glass.hairline,
  },
  seeListText: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 20, color: colors.accent },
  // The tap card (VC-85): glass, radius 22, a gold hairline, padding 12.
  tapCard: {
    backgroundColor: glass.fill,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: glass.goldHairline,
    padding: spacing.gap12,
    gap: spacing.sm,
  },
  pageFallback: { width: 300 },
  // The pager's 5 px dots, the current one gold.
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 4 },
  dotMark: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.borderStrong },
  dotMarkOn: { backgroundColor: colors.accent },
});
