/**
 * The Tonight map (VC-79, founder approved 2026-10-28;
 * design/vc79-map-spec.md). It sits behind Tonight's List / Map switch and
 * follows the same date chips as the list.
 *
 * What it shows (iPhone only for now):
 *   - a dark Apple map (no shop or building clutter);
 *   - one translucent gold CIRCLE per area that has events, around the
 *     area's fixed centre (at least 600 m of radius), with a small pill in
 *     the middle: "Shaw · 2". It never shows where a party really is: the
 *     server only sends area centres (migration 20261029110000_map_points.sql)
 *     while its venue-pin switch is off, which it is until the founder
 *     decides about staff picks;
 *   - tapping a circle (or its pill) opens a card at the bottom with one
 *     mini card per event there (swipe sideways when there are several,
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
 *   - "Showing the first 300. Narrow the dates." past 300 events.
 *
 * Refreshing: the points (and so the vibe words) reload every minute while
 * the map is on screen, like the list's vibes. The map only re-frames
 * itself on the first load and after a filter change, never on a refresh.
 *
 * Screen readers: the map is ONE element with a spoken summary ("Map of 5
 * events in 3 areas. Circles show the area only, never the exact spot."),
 * so VoiceOver doesn't wander between circles, and a "See the list" button
 * is always there as the full alternative.
 *
 * Reduce Motion: the map jumps to its framing instead of gliding, and the
 * cards don't shrink when pressed.
 *
 * Android: no Google Maps key yet (a founder decision), so it shows "Map
 * coming soon" with a "See the list" button instead of a map.
 */
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import type { MapPressEvent, Region, UserLocationChangeEvent } from 'react-native-maps';

import { Button } from '@/components/Button';
import { CircleIconButton } from '@/components/CircleIconButton';
import { MapMiniCard } from '@/components/MapMiniCard';
import { StatusPanel } from '@/components/StatusPanel';
import { filterEmptyText } from '@/lib/date-filter';
import type { DateFilter } from '@/lib/date-filter';
import {
  DC_CENTRE,
  MAP_LIMIT,
  areaAt,
  fitCoordinates,
  groupMapPoints,
  listMapPoints,
  shortArea,
} from '@/lib/map-read';
import type { AreaGroup, MapPoint } from '@/lib/map-read';
import { motionAllowed, useReduceMotion } from '@/lib/reduce-motion';
import { formatClock } from '@/lib/tonight';
import { LIST_VIBE_REFRESH_MS } from '@/lib/vibe';
import { colors, fonts, minTapTarget, radius, spacing, typography } from '@/theme';

/** Words used on the map (exported so tests use the same text). */
export const SEE_LIST_LABEL = 'See the list';
export const MAP_LOADING_LABEL = 'Loading events…';
export const ANDROID_TITLE = 'Map coming soon';
export const ANDROID_BODY = 'The map is on iPhone for now. Everything is in the list.';
export const LOCATE_LABEL = 'Show my location';
export const MORE_THAN_LIMIT = `Showing the first ${MAP_LIMIT}. Narrow the dates.`;
export const LEGEND_TEXT = 'Circles show the area only, never the exact spot';

/**
 * The circle's look: gold (#D6B97B, colors.accent) at 12% inside and 45% on
 * the 1.5 px edge, so the map stays readable under it.
 */
export const CIRCLE_FILL = 'rgba(214, 185, 123, 0.12)';
export const CIRCLE_STROKE = 'rgba(214, 185, 123, 0.45)';

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

/**
 * The real map (iPhone).
 *
 * @returns the map with its circles, overlays and tap card.
 */
function IosMap({ filter, onSeeList, onOpenEvent }: TonightMapProps) {
  const mapRef = useRef<MapView>(null);
  const [state, setState] = useState<MapState>({ kind: 'loading' });
  // Bumped by "Try again".
  const [attempt, setAttempt] = useState(0);
  // Numbers each load, so a slow answer for an old filter is ignored.
  const loadSeq = useRef(0);
  // The picked circle's area label, "venue:<id>" for a venue pin, or null
  // (no card).
  const [selected, setSelected] = useState<string | null>(null);
  // True once the map can take framing commands.
  const [mapReady, setMapReady] = useState(false);
  // Which load the map last framed itself for (filter + "Try again"), so a
  // minute refresh never moves the map under the guest's finger.
  const framedFor = useRef<string | null>(null);
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

  // Load the points when the map opens, the filter changes, or "Try again".
  // State is only set inside `.then`, and a late answer for an older load
  // is ignored (the list's rule, VC-B03).
  useEffect(() => {
    let active = true;
    const now = new Date();
    const seq = ++loadSeq.current;
    listMapPoints(now, filter).then((outcome) => {
      if (!active || seq !== loadSeq.current) return;
      setSelected(null);
      setState(
        outcome.ok
          ? { kind: 'ready', points: outcome.points, more: outcome.more, at: now }
          : { kind: 'error', message: outcome.message },
      );
    });
    return () => {
      active = false;
    };
    // filterKey stands for filter (a new object with the same dates is the same filter).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, attempt]);

  // Every minute while the map is on screen: reload quietly for fresh vibe
  // words. A failed refresh keeps what is shown. The card stays open if its
  // area is still there.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const timer = setInterval(() => {
        if (AppState.currentState === 'background') return;
        const now = new Date();
        const seq = loadSeq.current;
        listMapPoints(now, filter).then((outcome) => {
          if (!active || seq !== loadSeq.current || !outcome.ok) return;
          setState({ kind: 'ready', points: outcome.points, more: outcome.more, at: now });
        });
      }, LIST_VIBE_REFRESH_MS);
      return () => {
        active = false;
        clearInterval(timer);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterKey]),
  );

  const layout = useMemo(() => groupMapPoints(state.kind === 'ready' ? state.points : []), [state]);

  // Frame the circles once per load (not on refreshes). With nothing to
  // show, centre on DC. Under Reduce Motion the map jumps instead of gliding.
  useEffect(() => {
    if (!mapReady || state.kind !== 'ready') return;
    const key = `${filterKey}#${attempt}`;
    if (framedFor.current === key) return;
    framedFor.current = key;
    const coords = fitCoordinates(layout);
    if (coords.length === 0) mapRef.current?.animateToRegion(DC_REGION, moving ? 300 : 0);
    else mapRef.current?.fitToCoordinates(coords, { edgePadding: FIT_PADDING, animated: moving });
  }, [mapReady, state.kind, layout, filterKey, attempt, moving]);

  const selectedArea = pickedGroup(layout.areas, layout.venues, selected);
  const now = state.kind === 'ready' ? state.at : new Date(0);
  const eventCount = layout.areas.reduce((n, a) => n + a.events.length, 0) + layout.venues.length;

  /**
   * A tap on the map: a circle opens its card, empty map closes it.
   *
   * @param event - where the tap landed. Taps on a pill also arrive here on
   *   iPhone (as "marker-press"); the pill handles those itself.
   */
  function onMapPress(event: MapPressEvent) {
    if (event.nativeEvent.action === 'marker-press') return;
    const hit = areaAt(event.nativeEvent.coordinate, layout.areas);
    setSelected(hit ? hit.label : null);
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
      {/* One element for screen readers (the summary); the circles inside
          stay for sighted guests. "See the list" below is the alternative. */}
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
          onPress={onMapPress}
        >
          {layout.areas.map((area) => (
            <AreaShape
              key={area.label}
              area={area}
              picked={area.label === selected}
              onPick={() => setSelected(area.label)}
            />
          ))}
          {/* Venue pins: none arrive while the server's switch is off. */}
          {layout.venues.map((venue) => (
            <VenuePin
              key={venue.event_id}
              venue={venue}
              picked={selected === venueKey(venue)}
              onPick={() => setSelected(venueKey(venue))}
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
                setState({ kind: 'loading' });
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
          <View style={styles.legend}>
            <View style={styles.legendRing} />
            <Text style={styles.legendText} maxFontSizeMultiplier={1.3}>
              {LEGEND_TEXT}
            </Text>
          </View>
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
 * The selection key of a venue pin.
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
 * @param venues - the venue pins.
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

/**
 * A staff pick's venue pin (only once the server's venue-pin switch is on;
 * none arrive today). It reads the start time before the event starts, and
 * the vibe word after ("Early" when there's no word yet). Never a number.
 *
 * @param props.venue - the 'venue' row.
 * @param props.picked - true while its card is open.
 * @param props.onPick - opens its card.
 * @returns the pin.
 */
function VenuePin({
  venue,
  picked,
  onPick,
}: {
  venue: MapPoint;
  picked: boolean;
  onPick: () => void;
}) {
  if (venue.lat === null || venue.lng === null) return null;
  const text = venue.has_started
    ? (venue.vibe_word ?? 'Early')
    : formatClock(new Date(venue.starts_at));
  return (
    <Marker
      coordinate={{ latitude: venue.lat, longitude: venue.lng }}
      onPress={onPick}
      tracksViewChanges={false}
      accessibilityLabel={`${venue.title}, venue, ${venue.area_label}, ${text}`}
      testID={`map-venue-${venue.event_id}`}
    >
      <View style={[styles.areaPill, picked && styles.areaPillPicked]}>
        <Text
          style={[styles.areaPillText, picked && styles.areaPillTextPicked]}
          maxFontSizeMultiplier={1.3}
        >
          {text}
        </Text>
      </View>
    </Marker>
  );
}

/**
 * One area's circle and its centre pill ("Shaw · 2").
 *
 * @param props.area - the area and its events.
 * @param props.picked - true while its card is open (the pill turns gold).
 * @param props.onPick - opens its card.
 * @returns the circle and the pill.
 */
function AreaShape({
  area,
  picked,
  onPick,
}: {
  area: AreaGroup;
  picked: boolean;
  onPick: () => void;
}) {
  const centre = { latitude: area.latitude, longitude: area.longitude };
  const n = area.events.length;
  return (
    <>
      <Circle
        center={centre}
        radius={area.radius}
        fillColor={CIRCLE_FILL}
        strokeColor={CIRCLE_STROKE}
        strokeWidth={1.5}
      />
      <Marker
        coordinate={centre}
        onPress={onPick}
        // The pill never changes while on screen, so the map needn't redraw it.
        tracksViewChanges={false}
        accessibilityLabel={`${shortArea(area.label)}, ${n} ${
          n === 1 ? 'event' : 'events'
        }, area only`}
        testID={`map-area-${area.label}`}
      >
        <View style={[styles.areaPill, picked && styles.areaPillPicked]}>
          <Text
            style={[styles.areaPillText, picked && styles.areaPillTextPicked]}
            maxFontSizeMultiplier={1.3}
          >
            {shortArea(area.label)} · {n}
          </Text>
        </View>
      </Marker>
    </>
  );
}

/**
 * The card at the bottom for a picked area: one mini card per event,
 * swiped sideways, with "1 of 2" when there are several.
 *
 * @param props.area - the picked area.
 * @param props.now - the moment the points were loaded (for "when" lines).
 * @param props.onOpenEvent - opens an event's page.
 * @param props.animatePress - false under Reduce Motion.
 * @returns the card.
 */
function AreaCard({
  area,
  now,
  onOpenEvent,
  animatePress,
}: {
  area: AreaGroup;
  now: Date;
  onOpenEvent: (id: string) => void;
  animatePress: boolean;
}) {
  // The card's inner width (a page of the pager), once laid out.
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const n = area.events.length;

  /** Works out which page the pager stopped on. */
  function onScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (width > 0) setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  }

  return (
    <View
      style={styles.tapCard}
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
  legend: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  legendRing: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  legendText: { ...typography.caption, fontSize: 12, lineHeight: 16, color: colors.muted },
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
  // The area's centre pill (v3 pin look): 32 tall, at least 44 wide.
  areaPill: {
    minHeight: 32,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  areaPillPicked: { backgroundColor: colors.accent, borderColor: colors.text },
  areaPillText: { fontFamily: fonts.bodyBold, fontSize: 13, lineHeight: 18, color: colors.text },
  areaPillTextPicked: { color: colors.onAccent },
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
