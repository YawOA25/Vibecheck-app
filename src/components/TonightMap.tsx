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
 *   - your blue location dot, ONLY if you already allowed location for the
 *     app (for example at check-in). This screen never asks: it only reads
 *     the current permission. When it shows, a round button centres on you;
 *   - "Loading events…" while the points load (the map itself shows at
 *     once), a card with "Try again" when loading failed, the date filter's
 *     own empty words with "See the list" when there is nothing, and a pill
 *     "2 events aren't on the map. See the list" when some events have a
 *     typed area the map can't place (they are in the list only);
 *   - "Showing the first 300. Narrow the dates." past 300 events;
 *   - a legend: the four bands, and "Circles show the area, not the address".
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
 * and the cards don't shrink when pressed.
 *
 * Android: no Google Maps key yet (a founder decision), so it shows "Map
 * coming soon" with a "See the list" button instead of a map.
 */
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import MapView from 'react-native-maps';
import type { MapPressEvent, Region, UserLocationChangeEvent } from 'react-native-maps';

import { AreaHeat } from '@/components/AreaHeat';
import { Button } from '@/components/Button';
import { CircleIconButton } from '@/components/CircleIconButton';
import { MapMiniCard } from '@/components/MapMiniCard';
import { MapTag } from '@/components/MapTag';
import type { MapTagProps } from '@/components/MapTag';
import { StatusPanel } from '@/components/StatusPanel';
import { wordColour } from '@/components/VibeMeter';
import { useAuth } from '@/lib/auth-context';
import { filterEmptyText } from '@/lib/date-filter';
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
  tagTrailing,
} from '@/lib/map-read';
import type { AreaGroup, MapPoint } from '@/lib/map-read';
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

/** How long the camera takes to ease to a picked tag, in ms. */
export const CAMERA_MS = 350;

/** How long the bottom card takes to rise, in ms (spec §6). */
export const CARD_RISE_MS = 240;

/**
 * How far below a picked tag the camera centres, as a share of the map's
 * height: 0.18 puts the tag about a third of the way down, above the card.
 */
export const CARD_LIFT = 0.18;

/** Space kept around the circles when the map frames them (spec §4: 48 px). */
const FIT_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };

/** The map's view when there's nothing to show: central DC, about 12 km across. */
export const DC_REGION: Region = { ...DC_CENTRE, latitudeDelta: 0.11, longitudeDelta: 0.11 };

/** How close the "Show my location" button zooms (about 2 km across). */
const ME_DELTA = 0.02;

/**
 * Dark map colours for Google Maps (Android, later, once a key is approved).
 * Apple Maps on iPhone can't take a style list; it uses its own dark mode
 * (`userInterfaceStyle="dark"`), which is close to the v3 look.
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
  // The map's current view (updated after every pan or zoom), so easing to
  // a picked tag keeps the guest's own zoom level.
  const region = useRef<Region>(DC_REGION);
  // Location: shown only if already allowed. Never asked for here.
  const [locationAllowed, setLocationAllowed] = useState(false);
  // The last known spot of the blue dot (only on this phone, never sent).
  const myCoord = useRef<{ latitude: number; longitude: number } | null>(null);
  const reduceMotion = useReduceMotion();
  const moving = motionAllowed(reduceMotion);

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

  const layout = useMemo(() => groupMapPoints(state.kind === 'ready' ? state.points : []), [state]);

  // Frame the circles once per load (not on refreshes). With nothing to
  // show, centre on DC. Under Reduce Motion the map jumps instead of gliding.
  useEffect(() => {
    if (!mapReady || state.kind !== 'ready') return;
    const key = `${viewerId}#${filterKey}#${attempt}`;
    if (framedFor.current === key) return;
    framedFor.current = key;
    const coords = fitCoordinates(layout);
    if (coords.length === 0) mapRef.current?.animateToRegion(DC_REGION, moving ? 300 : 0);
    else mapRef.current?.fitToCoordinates(coords, { edgePadding: FIT_PADDING, animated: moving });
  }, [mapReady, state.kind, layout, filterKey, attempt, moving, viewerId]);

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
    const { latitudeDelta, longitudeDelta } = region.current;
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
   * A tap on the map: a circle opens its card, empty map closes it.
   *
   * @param event - where the tap landed. Taps on a tag also arrive here on
   *   iPhone (as "marker-press"); the tag handles those itself.
   */
  function onMapPress(event: MapPressEvent) {
    if (event.nativeEvent.action === 'marker-press') return;
    const hit = areaAt(event.nativeEvent.coordinate, layout.areas);
    if (hit) pick(hit.label, hit);
    else setSelected(null);
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
      >
        <MapView
          ref={mapRef}
          testID="tonight-map"
          style={styles.fill}
          initialRegion={DC_REGION}
          userInterfaceStyle="dark"
          customMapStyle={DARK_MAP_STYLE}
          showsPointsOfInterests={false}
          showsBuildings={false}
          showsTraffic={false}
          showsCompass={false}
          pitchEnabled={false}
          rotateEnabled={false}
          // The blue dot only with a permission the guest already gave.
          showsUserLocation={locationAllowed}
          onUserLocationChange={locationAllowed ? onUserLocation : undefined}
          onMapReady={() => setMapReady(true)}
          onRegionChangeComplete={(r: Region) => {
            region.current = r;
          }}
          onPress={onMapPress}
        >
          {layout.areas.map((area) => (
            <AreaShape
              key={area.label}
              area={area}
              picked={area.label === selected}
              onPick={() => pick(area.label, area)}
              animate={moving}
            />
          ))}
          {/* Venue tags: only for kind 'venue', and none arrive while the
              server's staff-pick pin switch is off. */}
          {layout.venues.map((venue) => (
            <VenueTag
              key={venue.event_id}
              venue={venue}
              picked={selected === venueKey(venue)}
              onPick={pick}
              animate={moving}
            />
          ))}
        </MapView>
      </View>

      {/* Top: loading, and the notes about what the map can't show. */}
      <View style={styles.topRow} pointerEvents="box-none">
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

      {/* Bottom: the legend, "See the list", the locate button, the card. */}
      <View style={styles.bottom} pointerEvents="box-none">
        <View style={styles.bottomRow} pointerEvents="box-none">
          <Legend />
          {locationAllowed ? (
            <CircleIconButton
              icon="pin"
              label={LOCATE_LABEL}
              onPress={showMe}
              testID="map-locate"
            />
          ) : null}
        </View>
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
        {selectedArea ? (
          <AreaCard
            key={selectedArea.label}
            area={selectedArea}
            now={now}
            onOpenEvent={onOpenEvent}
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
 * A staff pick's venue tag (only for kind 'venue', i.e. once the server's
 * venue-pin switch is on; none arrive today). One tag at the venue, no
 * circle.
 *
 * @param props.venue - the 'venue' row.
 * @param props.picked - true while its card is open.
 * @param props.onPick - opens its card (gets the key and the point).
 * @param props.animate - false under Reduce Motion.
 * @returns the tag, or nothing without coordinates.
 */
function VenueTag({
  venue,
  picked,
  onPick,
  animate,
}: {
  venue: MapPoint;
  picked: boolean;
  onPick: (key: string, at: { latitude: number; longitude: number }) => void;
  animate: boolean;
}) {
  if (venue.kind !== 'venue' || venue.lat === null || venue.lng === null) return null;
  const at = { latitude: venue.lat, longitude: venue.lng };
  return (
    <MapTag
      coordinate={at}
      {...eventTag(venue)}
      picked={picked}
      onPress={() => onPick(venueKey(venue), at)}
      animate={animate}
      testID={`map-venue-${venue.event_id}`}
    />
  );
}

/**
 * One area: its heat glow and its tag at the centre.
 *
 * @param props.area - the area and its events.
 * @param props.picked - true while its card is open (the tag turns gold).
 * @param props.onPick - opens its card.
 * @param props.animate - false under Reduce Motion.
 * @returns the glow circles and the tag.
 */
function AreaShape({
  area,
  picked,
  onPick,
  animate,
}: {
  area: AreaGroup;
  picked: boolean;
  onPick: () => void;
  animate: boolean;
}) {
  const look = area.events.length === 1 ? eventTag(area.events[0]) : groupTag(area);
  return (
    <>
      <AreaHeat
        latitude={area.latitude}
        longitude={area.longitude}
        radius={area.radius}
        band={hottestBand(area.events)}
      />
      <MapTag
        coordinate={{ latitude: area.latitude, longitude: area.longitude }}
        {...look}
        picked={picked}
        onPress={onPick}
        animate={animate}
        testID={`map-area-${area.label}`}
      />
    </>
  );
}

/**
 * The legend at the bottom left: the four bands as small gold swatches,
 * coolest to hottest, and a reminder that circles show areas only.
 *
 * @returns the legend (read out as one sentence).
 */
function Legend() {
  return (
    <View
      style={styles.legend}
      accessible
      accessibilityLabel={`Heat from ${BANDS.join(', ')}. ${LEGEND_TEXT}.`}
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
    </View>
  );
}

/**
 * The card at the bottom for a picked area: one mini card per event,
 * swiped sideways, with "1 of 2" when there are several. It rises into
 * place (spec §6: 240 ms), or simply appears under Reduce Motion.
 *
 * @param props.area - the picked area.
 * @param props.now - the moment the points were loaded (for "when" lines).
 * @param props.onOpenEvent - opens an event's page.
 * @param props.animatePress - false under Reduce Motion.
 * @param props.rise - false under Reduce Motion.
 * @returns the card.
 */
function AreaCard({
  area,
  now,
  onOpenEvent,
  animatePress,
  rise,
}: {
  area: AreaGroup;
  now: Date;
  onOpenEvent: (id: string) => void;
  animatePress: boolean;
  rise: boolean;
}) {
  // The card's inner width (a page of the pager), once laid out.
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const n = area.events.length;
  // 0 = lowered and clear, 1 = in place. The card is drawn anew for each
  // pick (its key is the pick), so this runs once per opened card.
  const [shown] = useState(() => new Animated.Value(rise ? 0 : 1));
  useEffect(() => {
    if (!rise) return;
    Animated.timing(shown, { toValue: 1, duration: CARD_RISE_MS, useNativeDriver: true }).start();
  }, [rise, shown]);
  // It rises the last 30 px into place.
  const lift = shown.interpolate({ inputRange: [0, 1], outputRange: [30, 0] });

  /** Works out which page the pager stopped on. */
  function onScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (width > 0) setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  }

  return (
    <Animated.View
      style={[styles.tapCard, { opacity: shown, transform: [{ translateY: lift }] }]}
      testID="map-tap-card"
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width - 2 * spacing.gap12)}
    >
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
      >
        {area.events.map((point) => (
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
      {n > 1 ? (
        <Text style={styles.pageText} maxFontSizeMultiplier={1.3}>
          {Math.min(page + 1, n)} of {n}
        </Text>
      ) : null}
    </Animated.View>
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
  topRow: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.gutter,
    right: spacing.gutter,
    alignItems: 'center',
    gap: spacing.sm,
  },
  // The small notes at the top (v3 pill: surface, 1 px strong edge).
  pill: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
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
  bottom: {
    position: 'absolute',
    left: spacing.gutter,
    right: spacing.gutter,
    bottom: spacing.md,
    gap: spacing.sm,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  // The legend (spec §3): a small card, bottom left.
  legend: {
    flexShrink: 1,
    gap: spacing.xs,
    paddingHorizontal: 10,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
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
  // "See the list": a 44 px tall gold-text pill.
  seeList: {
    alignSelf: 'flex-start',
    minHeight: minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  seeListText: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 20, color: colors.accent },
  // The tap card: surface, radius 20, padding 12.
  tapCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.gap12,
    gap: spacing.sm,
  },
  pageFallback: { width: 300 },
  pageText: { ...typography.caption, color: colors.muted, textAlign: 'center' },
});
