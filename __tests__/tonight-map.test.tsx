/**
 * Tests for the Tonight map (VC-79, map v2 VC-83): src/components/TonightMap.tsx,
 * its tags (MapTag.tsx), heat glow (AreaHeat.tsx) and the mini card
 * (MapMiniCard.tsx).
 *
 * The map itself is replaced by the fake in __mocks__/react-native-maps.js
 * (plain Views that keep their props), the server by a fake `supabase.rpc`,
 * the signed-in person by a fake useAuth, and location by a fake
 * expo-location. We check:
 *   - one heat glow per AREA (two Shaw parties share one), around the centre
 *     the server sent, its strength by band and its SIZE always the area's
 *     (never the score's);
 *   - tags: name + published score once started, start time before, "Too
 *     early" without a published score; an area with 2+ parties reads
 *     "Shaw" + "2 parties"; each tag has a spoken label;
 *   - NO rater count and NO headcount anywhere on the map, the card or the
 *     spoken labels, even if the server sent them;
 *   - tapping a tag eases the camera (jumps under Reduce Motion) and opens
 *     the card; the card's mini cards show the gauge or "Too early" only for
 *     started events, "1 of 2" for two events, and open the event page; a
 *     tap on empty map closes it;
 *   - a tag redraws for a moment after a change, then stops (map speed);
 *   - signing out hides the map's data; the next person gets a fresh load;
 *   - the map asks the server with the list's date window, and frames the
 *     circles once (not again on the minute refresh);
 *   - location: the dot and the locate button only with a permission
 *     already given; the screen NEVER asks for permission;
 *   - loading, empty, error with "Try again", "not on the map" and "more
 *     than 300" notes;
 *   - the map region's spoken summary and the always-there "See the list";
 *   - Reduce Motion: the framing doesn't glide;
 *   - Android: "Map coming soon" with "See the list", and no map at all;
 *   - VC-83 Batch 2: far zoom draws count bubbles (a count of events and a
 *     band colour only: never a score or a rater count) and heat dots, and a
 *     tapped bubble zooms in; the card's pages go hottest first; at most 5
 *     tags pulse, still under Reduce Motion; a band change cross-fades the
 *     glow (instant under Reduce Motion); a swipe down or the screen
 *     reader's escape closes the card; a stale score is spoken as "stale".
 *   - VC-85 step 1 (sleek): the quiet Apple base (muted map type, no places,
 *     zoom limits, no Google-only style list), the edge fade that never
 *     takes touches, the glass top bar with the menu button that opens the
 *     map key, the once-per-run hint, the card's page dots and score
 *     column, the slower camera and the soft five-ring glow (outer ring
 *     still the area's size).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { AccessibilityInfo, Animated, Platform, ScrollView, StyleSheet } from 'react-native';
import * as Maps from 'react-native-maps';

import { GLOW_FADE_MS, heatLayers, ringAlphas } from '@/components/AreaHeat';
import { BUBBLE_SIZE, bubbleEdge } from '@/components/MapDots';
import { MAP_EASE } from '@/components/MapGlass';
import { TAG_REDRAW_MS } from '@/components/MapTag';
import {
  ANDROID_TITLE,
  CAMERA_MS,
  CARD_LIFT,
  CARD_RISE_MS,
  CLUSTER_MS,
  DC_REGION,
  HINT_MS,
  LEGEND_TEXT,
  LOCATE_LABEL,
  MAP_CITY,
  MAP_LOADING_LABEL,
  MENU_LABEL,
  MORE_THAN_LIMIT,
  LEGEND_BUBBLE_TEXT,
  SEE_LIST_LABEL,
  TonightMap,
  ZOOM_RANGE,
  isSwipeDown,
  resetMapHintForTests,
  swipeCloses,
} from '@/components/TonightMap';
import { useAuth } from '@/lib/auth-context';
import { THIS_WEEK, filterWindow } from '@/lib/date-filter';
import { CLOSE_DELTA, MAX_PULSES } from '@/lib/map-cluster';
import { TOO_EARLY } from '@/lib/map-read';
import { resetReduceMotionForTests } from '@/lib/reduce-motion';
import { supabase } from '@/lib/supabase';
import { LIST_VIBE_REFRESH_MS } from '@/lib/vibe';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
}));
jest.mock('expo-router', () => ({
  // Outside a real navigator the screen is "in view" once: run the effect
  // like a normal useEffect. (require inside: jest.mock can't use outer imports.)
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(effect, [effect]);
  },
}));

const rpc = supabase.rpc as jest.Mock;
const authed = useAuth as jest.Mock;
const getPermission = Location.getForegroundPermissionsAsync as jest.Mock;
const askPermission = Location.requestForegroundPermissionsAsync as jest.Mock;
// The fake map's recorder of framing commands (__mocks__/react-native-maps.js).
const commands = (Maps as unknown as { mapCommands: unknown }).mapCommands as {
  fitToCoordinates: jest.Mock;
  animateToRegion: jest.Mock;
};

const HOUR = 60 * 60 * 1000;

/**
 * Makes one server row.
 *
 * @param overrides - fields to change from a not-started Shaw house party.
 * @returns a get_map_points row.
 */
function row(overrides: Record<string, unknown> = {}) {
  const starts = new Date(Date.now() + HOUR);
  return {
    event_id: 'e1',
    title: 'Shaw kickback',
    area_label: 'Shaw, DC',
    starts_at: starts.toISOString(),
    ends_at: new Date(starts.getTime() + 4 * HOUR).toISOString(),
    source: 'host',
    is_test: false,
    kind: 'area',
    lat: 38.9123,
    lng: -77.0219,
    radius_m: 600,
    has_started: false,
    is_live: false,
    vibe_word: null,
    vibe_score: null,
    vibe_stale: false,
    ...overrides,
  };
}

/** Two Shaw parties (one started, "Hot" 7.4) and one staff pick in Clarendon. */
const THREE_ROWS = [
  row({
    event_id: 'e1',
    title: 'Shaw kickback',
    has_started: true,
    is_live: true,
    vibe_word: 'Hot',
    vibe_score: 7.4,
    starts_at: new Date(Date.now() - HOUR).toISOString(),
  }),
  // The server never sends a word or score before the start; even if it
  // did, they're hidden.
  row({ event_id: 'e2', title: 'Shaw later', vibe_word: 'Fire', vibe_score: 9.6 }),
  row({
    event_id: 'e3',
    title: 'Clarendon pick',
    area_label: 'Clarendon, VA',
    source: 'staff_pick',
    lat: 38.8868,
    lng: -77.0953,
    radius_m: 600,
  }),
];

/**
 * Sets the fake signed-in person (a profile id is all the map reads).
 *
 * @param id - the profile id, or null for signed out.
 */
function signedInAs(id: string | null) {
  authed.mockReturnValue({ profile: id ? { id, role: 'user', is_tester: false } : null });
}

const onSeeList = jest.fn();
const onOpenEvent = jest.fn();

/** The map element with the default filter and fake callbacks. */
const mapElement = () => (
  <TonightMap filter={THIS_WEEK} onSeeList={onSeeList} onOpenEvent={onOpenEvent} />
);

/** Draws the map. */
async function drawMap() {
  await render(mapElement());
}

/**
 * Every circle's props around one area centre.
 *
 * @param latitude - the area centre's latitude.
 * @returns the props of each circle there, outer first.
 */
function circlesAt(latitude: number) {
  return screen
    .getAllByTestId('map-circle')
    .filter((c) => c.props.center.latitude === latitude)
    .map((c) => c.props);
}

const realOS = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  resetReduceMotionForTests();
  // VC-85: every test starts as the app's first map visit (hint unseen).
  resetMapHintForTests();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  getPermission.mockResolvedValue({ granted: false, status: 'denied' });
  rpc.mockResolvedValue({ data: THREE_ROWS, error: null });
  signedInAs('user-1');
});

afterEach(() => {
  Platform.OS = realOS;
  jest.useRealTimers();
});

describe('TonightMap heat glow', () => {
  it('draws one glow per area around the centre the server sent, by band', async () => {
    await drawMap();
    // Shaw's hottest published band is Hot: five soft stacked rings (VC-85),
    // the outer one exactly the area's size.
    const shaw = circlesAt(38.9123);
    const hot = heatLayers('Hot');
    expect(shaw.map((c) => c.radius)).toEqual([600, 480, 360, 240, 120]);
    expect(shaw.map((c) => c.fillColor)).toEqual(hot.map((l) => l.fill));
    expect(shaw[0].center).toEqual({ latitude: 38.9123, longitude: -77.0219 });
    // Clarendon hasn't started: one faint dashed circle, no glow.
    const clarendon = circlesAt(38.8868);
    expect(clarendon).toHaveLength(1);
    expect(clarendon[0].fillColor).toBe(heatLayers(null)[0].fill);
    expect(clarendon[0].lineDashPattern).toEqual([6, 6]);
  });

  it('never lets the score change the circle size', async () => {
    rpc.mockResolvedValue({
      data: [
        row({ has_started: true, vibe_word: 'Fire', vibe_score: 9.8 }),
        row({
          event_id: 'q',
          area_label: 'Petworth, DC',
          lat: 38.942,
          lng: -77.024,
          radius_m: 600,
          has_started: true,
          vibe_word: 'Quiet',
          vibe_score: 2.1,
        }),
      ],
      error: null,
    });
    await drawMap();
    // Fire and Quiet areas of the same size get the same circles.
    expect(circlesAt(38.9123).map((c) => c.radius)).toEqual(circlesAt(38.942).map((c) => c.radius));
    // Only the colour strength differs.
    expect(circlesAt(38.9123)[2].fillColor).toBe(heatLayers('Fire')[2].fill);
    expect(circlesAt(38.942)[2].fillColor).toBe(heatLayers('Quiet')[2].fill);
  });

  it('never draws a circle smaller than 600 m, even if told to', async () => {
    rpc.mockResolvedValue({ data: [row({ radius_m: 50 })], error: null });
    await drawMap();
    expect(screen.getByTestId('map-circle').props.radius).toBe(600);
  });

  it('keeps the map key behind the menu button, with a hint the first time', async () => {
    await drawMap();
    // VC-85: no legend box on the map; the area line shows once as a hint.
    expect(screen.queryByTestId('map-legend')).toBeNull();
    expect(screen.getByTestId('map-hint')).toHaveTextContent(LEGEND_TEXT);
    const menu = screen.getByRole('button', { name: MENU_LABEL });
    expect(menu.props.accessibilityState).toEqual(expect.objectContaining({ expanded: false }));
    await fireEvent.press(menu);
    expect(screen.getByTestId('map-legend').props.accessibilityLabel).toBe(
      `Heat from Quiet, Good, Hot, Fire. ${LEGEND_TEXT}.`,
    );
    // Opening the key retires the hint; pressing again closes the key.
    expect(screen.queryByTestId('map-hint')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: MENU_LABEL }));
    expect(screen.queryByTestId('map-legend')).toBeNull();
  });

  it('shows the hint only once per app run, and only for a few seconds', async () => {
    jest.useFakeTimers();
    await drawMap();
    expect(screen.getByTestId('map-hint')).toBeOnTheScreen();
    await act(() => jest.advanceTimersByTimeAsync(HINT_MS));
    expect(screen.queryByTestId('map-hint')).toBeNull();
    // Back to the list and to the map again: no second hint.
    await screen.unmount();
    await drawMap();
    expect(screen.queryByTestId('map-hint')).toBeNull();
  });
});

describe('TonightMap sleek look (VC-85 step 1)', () => {
  it('makes the Apple map as quiet as Apple allows', async () => {
    await drawMap();
    const map = screen.getByTestId('tonight-map');
    expect(map.props.mapType).toBe('mutedStandard');
    expect(map.props.userInterfaceStyle).toBe('dark');
    // No places: an empty filter falls back to "show none".
    expect(map.props.pointsOfInterestFilter).toEqual([]);
    expect(map.props.showsPointsOfInterests).toBe(false);
    expect(map.props.cameraZoomRange).toEqual(ZOOM_RANGE);
    // The Google-only style list is not passed to Apple Maps (it did nothing).
    expect(map.props.customMapStyle).toBeUndefined();
  });

  it('draws the edge fade without taking touches or screen reader focus', async () => {
    await drawMap();
    const fade = screen.getByTestId('map-vignette', { includeHiddenElements: true });
    expect(fade.props.pointerEvents).toBe('none');
    expect(fade.props.accessibilityElementsHidden).toBe(true);
  });

  it('slides the card up with the map ease, no spring', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    const spring = jest.spyOn(Animated, 'spring');
    await drawMap();
    await fireEvent.press(screen.getByTestId('map-area-Shaw, DC'));
    expect(timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        toValue: 1,
        duration: CARD_RISE_MS,
        easing: MAP_EASE,
        useNativeDriver: true,
      }),
    );
    expect(spring).not.toHaveBeenCalled();
  });

  it('builds the soft glow so the middle reaches the spec strength', () => {
    // Stacked see-through rings: what shows in the middle is 1 - (each
    // ring's see-through share multiplied together).
    const middle = (alphas: number[]) => 1 - alphas.reduce((left, a) => left * (1 - a), 1);
    expect(middle(ringAlphas(0.55))).toBeCloseTo(0.55, 5);
    expect(middle(ringAlphas(0.38))).toBeCloseTo(0.38, 5);
    // The outer ring alone is faint (12% of the middle): a soft edge.
    expect(ringAlphas(0.55)[0]).toBeCloseTo(0.066, 3);
    // No ring gets a hard edge.
    expect(heatLayers('Fire').every((l) => l.strokeWidth === 0 && !l.stroke)).toBe(true);
  });

  it('draws a 34 px glass bubble edged in the hottest band at 55%', async () => {
    await drawMap();
    await moveMapTo(FAR_VIEW);
    const style = StyleSheet.flatten(screen.getByTestId('map-cluster-Shaw, DC-bubble').props.style);
    expect(style.width).toBe(BUBBLE_SIZE);
    expect(BUBBLE_SIZE).toBe(34);
    expect(style.borderColor).toBe(bubbleEdge('Hot'));
    expect(bubbleEdge('Hot')).toBe('rgba(214, 185, 123, 0.55)');
  });

  it('floats a glass top bar naming the dates and the city', async () => {
    await drawMap();
    expect(screen.getByTestId('map-top-bar').props.accessibilityLabel).toBe(
      `This week, ${MAP_CITY}`,
    );
  });
});

describe('TonightMap tags', () => {
  it('shows name and published score once started, start time before', async () => {
    rpc.mockResolvedValue({
      data: [
        row({
          title: 'Rooftop Sundown',
          area_label: 'Navy Yard, DC',
          lat: 38.8764,
          lng: -77.003,
          has_started: true,
          vibe_word: 'Fire',
          vibe_score: 9.1,
        }),
        THREE_ROWS[2],
      ],
      error: null,
    });
    await drawMap();
    expect(screen.getByText('Rooftop Sundown')).toBeOnTheScreen();
    expect(screen.getByText('9.1')).toBeOnTheScreen();
    expect(screen.getByTestId('map-area-Navy Yard, DC').props.accessibilityLabel).toBe(
      'Rooftop Sundown, house party, area only, Navy Yard, Fire, 9.1',
    );
    // Not started: the name and its start time, nothing about ratings.
    const pick = screen.getByTestId('map-area-Clarendon, VA');
    expect(pick).toHaveTextContent(/^Clarendon pick\d{1,2}(:\d\d)? (AM|PM)$/);
  });

  it('reads Too early for nobody rated and for 1-4 raters alike', async () => {
    rpc.mockResolvedValue({
      data: [
        row({ has_started: true, vibe_word: null }),
        row({
          event_id: 'e5',
          title: 'Few raters',
          area_label: 'Petworth, DC',
          lat: 38.942,
          lng: -77.024,
          has_started: true,
          vibe_word: 'Early',
        }),
      ],
      error: null,
    });
    await drawMap();
    expect(screen.getAllByText(TOO_EARLY)).toHaveLength(2);
    expect(screen.queryByText('Early')).toBeNull();
  });

  it('gives an area with 2+ parties one tag with a count of parties', async () => {
    await drawMap();
    const shaw = screen.getByTestId('map-area-Shaw, DC');
    expect(shaw).toHaveTextContent('Shaw2 parties');
    expect(shaw.props.accessibilityLabel).toBe('Shaw, 2 parties, area only, hottest vibe Hot');
    // The not-started party's (impossible) score never shows.
    expect(screen.queryByText('9.6')).toBeNull();
  });

  it('redraws a tag for a moment after a change, then stops', async () => {
    jest.useFakeTimers();
    await drawMap();
    const tag = () => screen.getByTestId('map-area-Clarendon, VA');
    expect(tag().props.tracksViewChanges).toBe(true);
    await act(() => jest.advanceTimersByTimeAsync(TAG_REDRAW_MS));
    expect(tag().props.tracksViewChanges).toBe(false);
    // Picking it changes its look: it redraws again for a moment.
    await fireEvent.press(tag());
    expect(tag().props.tracksViewChanges).toBe(true);
    await act(() => jest.advanceTimersByTimeAsync(TAG_REDRAW_MS));
    expect(tag().props.tracksViewChanges).toBe(false);
  });
});

describe('TonightMap shows no counts', () => {
  it('never shows a rater count or headcount, even if the server sent one', async () => {
    // Fields the real function never returns: if they ever arrived, they
    // must still go nowhere. Unusual numbers so a leak is easy to spot.
    const leaky = THREE_ROWS.map((r) => ({ ...r, raters: 4321, here: 8765, headcount: 8765 }));
    rpc.mockResolvedValue({ data: leaky, error: null });
    await drawMap();
    await fireEvent.press(screen.getByTestId('map-area-Shaw, DC'));
    expect(screen.getByTestId('map-tap-card')).toBeOnTheScreen();
    const drawn = JSON.stringify(screen.toJSON());
    expect(drawn).not.toMatch(/4321|8765/);
    // No count words on tags, the card or any spoken label.
    expect(drawn).not.toMatch(/\b(raters?|ratings?|people|person|here|checked in|headcount)\b/i);
  });
});

describe('TonightMap tap card', () => {
  it('eases the camera to the tag, above the card', async () => {
    await drawMap();
    commands.animateToRegion.mockClear();
    await fireEvent.press(screen.getByTestId('map-area-Clarendon, VA'));
    expect(commands.animateToRegion).toHaveBeenCalledWith(
      {
        latitude: 38.8868 - DC_REGION.latitudeDelta * CARD_LIFT,
        longitude: -77.0953,
        latitudeDelta: DC_REGION.latitudeDelta,
        longitudeDelta: DC_REGION.longitudeDelta,
      },
      CAMERA_MS,
    );
  });

  it('keeps the guest zoom and jumps under Reduce Motion', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
    await drawMap();
    const region = { latitude: 38.9, longitude: -77, latitudeDelta: 0.04, longitudeDelta: 0.05 };
    await fireEvent(screen.getByTestId('tonight-map'), 'regionChangeComplete', region);
    await fireEvent.press(screen.getByTestId('map-area-Shaw, DC'));
    expect(commands.animateToRegion).toHaveBeenLastCalledWith(
      {
        latitude: 38.9123 - 0.04 * CARD_LIFT,
        longitude: -77.0219,
        latitudeDelta: 0.04,
        longitudeDelta: 0.05,
      },
      0,
    );
  });

  it('opens the area card with a mini card per event; vibe only once started', async () => {
    await drawMap();
    expect(screen.queryByTestId('map-tap-card')).toBeNull();
    await fireEvent.press(screen.getByTestId('map-area-Shaw, DC'));
    const cards = screen.getAllByTestId('map-mini-card');
    expect(cards).toHaveLength(2);
    // VC-85: page dots, read as "1 of 2".
    expect(screen.getByLabelText('1 of 2')).toBeOnTheScreen();
    // The started party shows its score; the later one shows nothing about ratings.
    expect(screen.getAllByTestId('map-mini-card-score')).toHaveLength(1);
    expect(screen.queryByTestId('map-mini-card-early')).toBeNull();
    // Where: the area only, never more.
    expect(screen.getAllByText('Somewhere in Shaw, DC')).toHaveLength(2);
    expect(cards[0].props.accessibilityLabel).toMatch(
      /^Shaw kickback, Somewhere in Shaw, DC, .*vibe Hot, 7\.4$/,
    );
    expect(cards[1].props.accessibilityLabel).not.toMatch(/vibe|Too early/);
  });

  it('opens the event page from a mini card', async () => {
    await drawMap();
    await fireEvent.press(screen.getByTestId('map-area-Clarendon, VA'));
    expect(screen.getByText('Staff pick')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('map-mini-card'));
    expect(onOpenEvent).toHaveBeenCalledWith('e3');
  });

  it('opens a card from a tap inside a circle, and closes it on empty map', async () => {
    await drawMap();
    const map = screen.getByTestId('tonight-map');
    await fireEvent(map, 'press', {
      nativeEvent: { coordinate: { latitude: 38.913, longitude: -77.022 } },
    });
    expect(screen.getAllByTestId('map-mini-card')).toHaveLength(2);
    await fireEvent(map, 'press', {
      nativeEvent: { coordinate: { latitude: 39.5, longitude: -76 } },
    });
    expect(screen.queryByTestId('map-tap-card')).toBeNull();
  });

  it('shows "Too early" for a started party without a published score', async () => {
    rpc.mockResolvedValue({
      data: [row({ has_started: true, is_live: true, vibe_word: 'Early' })],
      error: null,
    });
    await drawMap();
    await fireEvent.press(screen.getByTestId('map-area-Shaw, DC'));
    expect(screen.getByTestId('map-mini-card-early')).toHaveTextContent(TOO_EARLY);
    expect(screen.queryByTestId('map-mini-card-score')).toBeNull();
  });
});

describe('TonightMap sign-out', () => {
  it('hides what was loaded when signed out, and loads afresh for the next person', async () => {
    // A tester's map has a test event.
    rpc.mockResolvedValue({
      data: [row({ event_id: 't1', title: 'Tester night', is_test: true })],
      error: null,
    });
    signedInAs('tester-1');
    const view = await render(mapElement());
    expect(screen.getByText('Tester night')).toBeOnTheScreen();

    // Signed out on this phone: nothing of the tester's map stays.
    signedInAs(null);
    await view.rerender(mapElement());
    expect(screen.queryByText('Tester night')).toBeNull();
    expect(screen.queryAllByTestId('map-circle')).toHaveLength(0);
    expect(screen.getByText(MAP_LOADING_LABEL)).toBeOnTheScreen();
    expect(rpc).toHaveBeenCalledTimes(1);

    // A guest signs in: a fresh load, with only what the guest may see.
    rpc.mockResolvedValue({ data: [THREE_ROWS[2]], error: null });
    signedInAs('guest-1');
    await view.rerender(mapElement());
    await act(async () => {});
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Tester night')).toBeNull();
    expect(screen.getByText('Clarendon pick')).toBeOnTheScreen();
  });

  it('ignores an answer that arrives after signing out', async () => {
    let answer: (value: unknown) => void = () => undefined;
    rpc.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const view = await render(mapElement());
    signedInAs(null);
    await view.rerender(mapElement());
    await act(async () => answer({ data: THREE_ROWS, error: null }));
    expect(screen.queryAllByTestId('map-circle')).toHaveLength(0);
    expect(screen.queryByText('Clarendon pick')).toBeNull();
  });
});

describe('TonightMap framing', () => {
  it('asks with the list window and frames the circles once', async () => {
    jest.useFakeTimers();
    await drawMap();
    const args = rpc.mock.calls[0];
    expect(args[0]).toBe('get_map_points');
    // Same window as the list (checked to the hour; the test's clock moves).
    const window = filterWindow(THIS_WEEK, new Date());
    expect(
      Math.abs(Date.parse(args[1].p_starts_before) - window.startsBefore.getTime()),
    ).toBeLessThan(HOUR);
    expect(args[1].p_starts_from).toBeNull();
    expect(commands.fitToCoordinates).toHaveBeenCalledTimes(1);
    expect(commands.fitToCoordinates.mock.calls[0][1]).toEqual(
      expect.objectContaining({ animated: true }),
    );
    // The minute refresh reloads the points but never re-frames the map.
    expect(rpc).toHaveBeenCalledTimes(1);
    await act(() => jest.advanceTimersByTimeAsync(LIST_VIBE_REFRESH_MS));
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(commands.fitToCoordinates).toHaveBeenCalledTimes(1);
  });

  it('jumps instead of gliding under Reduce Motion', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
    await drawMap();
    expect(commands.fitToCoordinates).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({ animated: false }),
    );
  });
});

describe('TonightMap location', () => {
  it('shows no dot and no locate button without permission, and never asks', async () => {
    await drawMap();
    expect(getPermission).toHaveBeenCalled();
    expect(askPermission).not.toHaveBeenCalled();
    expect(screen.getByTestId('tonight-map').props.showsUserLocation).toBe(false);
    expect(screen.queryByRole('button', { name: LOCATE_LABEL })).toBeNull();
  });

  it('shows the dot and the locate button when permission was already given', async () => {
    getPermission.mockResolvedValue({ granted: true, status: 'granted' });
    await drawMap();
    expect(screen.getByTestId('tonight-map').props.showsUserLocation).toBe(true);
    expect(screen.getByRole('button', { name: LOCATE_LABEL })).toBeOnTheScreen();
    expect(askPermission).not.toHaveBeenCalled();
  });
});

describe('TonightMap states', () => {
  it('shows the map at once with a loading pill', async () => {
    rpc.mockReturnValue(new Promise(() => {}));
    await drawMap();
    expect(screen.getByTestId('tonight-map')).toBeOnTheScreen();
    expect(screen.getByText(MAP_LOADING_LABEL)).toBeOnTheScreen();
  });

  it('shows the filter empty words with See the list, and centres on DC', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await drawMap();
    expect(screen.getByTestId('map-empty')).toBeOnTheScreen();
    expect(commands.animateToRegion).toHaveBeenCalled();
    const buttons = screen.getAllByRole('button', { name: SEE_LIST_LABEL });
    await fireEvent.press(buttons[0]);
    expect(onSeeList).toHaveBeenCalled();
  });

  it('shows an error with Try again, which loads again', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await drawMap();
    expect(screen.getByText("We couldn't load events. Please try again.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('map-area-Shaw, DC')).toBeOnTheScreen();
    expect(screen.getByTestId('map-area-Clarendon, VA')).toBeOnTheScreen();
  });

  it('counts free-text areas as not on the map, behind See the list', async () => {
    rpc.mockResolvedValue({
      data: [
        ...THREE_ROWS,
        row({
          event_id: 'e9',
          area_label: 'Behind the mill, DC',
          kind: 'none',
          lat: null,
          lng: null,
        }),
      ],
      error: null,
    });
    await drawMap();
    expect(screen.getByText("1 event isn't on the map. See the list")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('map-unplaced'));
    expect(onSeeList).toHaveBeenCalled();
    // Still only the two real areas get a tag.
    expect(screen.queryByTestId('map-area-Behind the mill, DC')).toBeNull();
  });

  it('says when more than 300 events came back', async () => {
    const many = Array.from({ length: 301 }, (_, i) => row({ event_id: `m${i}` }));
    rpc.mockResolvedValue({ data: many, error: null });
    await drawMap();
    expect(screen.getByText(MORE_THAN_LIMIT)).toBeOnTheScreen();
    expect(screen.getByText('300 parties')).toBeOnTheScreen();
  });

  it('gives the map region a spoken summary and keeps See the list there', async () => {
    await drawMap();
    const region = screen.getByTestId('tonight-map-region');
    expect(region.props.accessible).toBe(true);
    expect(region.props.accessibilityLabel).toBe(
      'Map of 3 events in 2 areas. Circles show the area only, never the exact spot.',
    );
    expect(screen.getByRole('button', { name: SEE_LIST_LABEL })).toBeOnTheScreen();
  });
});

describe('TonightMap on Android', () => {
  it('shows Map coming soon with See the list, and no map', async () => {
    Platform.OS = 'android';
    await drawMap();
    expect(screen.getByText(ANDROID_TITLE)).toBeOnTheScreen();
    expect(screen.queryByTestId('tonight-map')).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: SEE_LIST_LABEL }));
    expect(onSeeList).toHaveBeenCalled();
  });
});

/**
 * Moves the fake map's view, as the real map reports after a pan or zoom.
 *
 * @param region - the new view.
 */
async function moveMapTo(region: {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}) {
  await fireEvent(screen.getByTestId('tonight-map'), 'regionChangeComplete', region);
}

/** Zoomed far out over DC (about 55 km across). */
const FAR_VIEW = { latitude: 38.9, longitude: -77.05, latitudeDelta: 0.5, longitudeDelta: 0.5 };

describe('TonightMap far zoom (VC-83 Batch 2)', () => {
  it('draws a count bubble and a heat dot instead of names', async () => {
    await drawMap();
    await moveMapTo(FAR_VIEW);
    // Shaw's two parties: one bubble "2", edged in the hottest published band.
    const bubble = screen.getByTestId('map-cluster-Shaw, DC');
    expect(bubble).toHaveTextContent('2');
    expect(bubble.props.accessibilityLabel).toBe(
      '2 parties close together, hottest vibe Hot. Zooms in.',
    );
    // Clarendon's single event: a heat dot that still speaks its tag's words.
    expect(screen.getByTestId('map-dot-Clarendon, VA').props.accessibilityLabel).toMatch(
      /^Clarendon pick, staff pick, area only, Clarendon, starts /,
    );
    // No names and no tags at this zoom.
    expect(screen.queryByText('Clarendon pick')).toBeNull();
    expect(screen.queryByTestId('map-area-Shaw, DC')).toBeNull();
    // The map key (behind the menu button) explains the bubble colour.
    await fireEvent.press(screen.getByRole('button', { name: MENU_LABEL }));
    expect(screen.getByText(LEGEND_BUBBLE_TEXT)).toBeOnTheScreen();
    // The glows stay, at the areas' own size.
    expect(circlesAt(38.9123).map((c) => c.radius)).toEqual([600, 480, 360, 240, 120]);
  });

  it('merges nearby areas into one bubble at the average of their events', async () => {
    await drawMap();
    await moveMapTo({ ...FAR_VIEW, latitudeDelta: 1, longitudeDelta: 1 });
    const bubble = screen.getByTestId('map-cluster-Clarendon, VA|Shaw, DC');
    expect(bubble).toHaveTextContent('3');
    // A staff pick inside: "events", not "parties".
    expect(bubble.props.accessibilityLabel).toBe(
      '3 events close together, hottest vibe Hot. Zooms in.',
    );
    // Two Shaw events and one Clarendon: the plain average of the three.
    expect(bubble.props.coordinate.latitude).toBeCloseTo((2 * 38.9123 + 38.8868) / 3, 10);
    expect(bubble.props.coordinate.longitude).toBeCloseTo((2 * -77.0219 + -77.0953) / 3, 10);
  });

  it('never shows a score, a rater count or "N hot" in bubbles', async () => {
    const leaky = [
      ...THREE_ROWS,
      row({
        event_id: 'e4',
        title: 'Shaw fire',
        has_started: true,
        is_live: true,
        vibe_word: 'Fire',
        vibe_score: 9.3,
        starts_at: new Date(Date.now() - HOUR).toISOString(),
      }),
    ].map((r) => ({ ...r, raters: 4321, here: 8765 }));
    rpc.mockResolvedValue({ data: leaky, error: null });
    await drawMap();
    await moveMapTo({ ...FAR_VIEW, latitudeDelta: 1, longitudeDelta: 1 });
    const bubble = screen.getByTestId('map-cluster-Clarendon, VA|Shaw, DC');
    // Only the number of events, and the band as a word in the spoken label.
    expect(bubble).toHaveTextContent(/^4$/);
    expect(bubble.props.accessibilityLabel).toBe(
      '4 events close together, hottest vibe Fire. Zooms in.',
    );
    const drawn = JSON.stringify(screen.toJSON());
    expect(drawn).not.toMatch(/9\.3|7\.4|4321|8765/);
    expect(drawn).not.toMatch(/\d+ (hot|fire)\b/i);
    expect(drawn).not.toMatch(/\b(raters?|ratings?|people|headcount)\b/i);
  });

  it('zooms in on a tapped bubble (close zoom for one area)', async () => {
    await drawMap();
    await moveMapTo(FAR_VIEW);
    commands.animateToRegion.mockClear();
    await fireEvent.press(screen.getByTestId('map-cluster-Shaw, DC'));
    expect(commands.animateToRegion).toHaveBeenCalledWith(
      {
        latitude: 38.9123,
        longitude: -77.0219,
        latitudeDelta: CLOSE_DELTA,
        longitudeDelta: CLOSE_DELTA,
      },
      CLUSTER_MS,
    );
    // No card: a bubble only zooms.
    expect(screen.queryByTestId('map-tap-card')).toBeNull();
  });

  it('opens the card from a heat dot', async () => {
    await drawMap();
    await moveMapTo(FAR_VIEW);
    await fireEvent.press(screen.getByTestId('map-dot-Clarendon, VA'));
    expect(String(screen.getByTestId('map-mini-card').props.accessibilityLabel)).toMatch(
      /^Clarendon pick, /,
    );
  });
});

describe('TonightMap card pager order (VC-83 Batch 2)', () => {
  it('puts the hottest party first, then the rest by start time', async () => {
    const started = new Date(Date.now() - HOUR).toISOString();
    rpc.mockResolvedValue({
      data: [
        row({ event_id: 'later', title: 'Later one' }),
        row({
          event_id: 'good',
          title: 'Good one',
          has_started: true,
          starts_at: started,
          vibe_word: 'Good',
          vibe_score: 6.1,
        }),
        row({ event_id: 'early', title: 'Early one', has_started: true, starts_at: started }),
        row({
          event_id: 'fire',
          title: 'Fire one',
          has_started: true,
          starts_at: started,
          vibe_word: 'Fire',
          vibe_score: 9.2,
        }),
      ],
      error: null,
    });
    await drawMap();
    await fireEvent.press(screen.getByTestId('map-area-Shaw, DC'));
    const titles = screen
      .getAllByTestId('map-mini-card')
      .map((c) => String(c.props.accessibilityLabel).split(',')[0]);
    expect(titles).toEqual(['Fire one', 'Good one', 'Early one', 'Later one']);
    expect(screen.getByLabelText('1 of 4')).toBeOnTheScreen();
  });

  it('stays on the event being viewed when a refresh re-sorts the pages (VC-84 fix)', async () => {
    jest.useFakeTimers();
    const started = new Date(Date.now() - HOUR).toISOString();
    /**
     * A started Shaw party with a published score.
     *
     * @param id - its id; the title is "<id> one".
     * @param score - its score.
     * @param word - its word (default Hot).
     * @returns a server row.
     */
    const scored = (id: string, score: number, word = 'Hot') =>
      row({
        event_id: id,
        title: `${id} one`,
        has_started: true,
        is_live: true,
        starts_at: started,
        vibe_word: word,
        vibe_score: score,
      });
    /** The pages' titles, in order. */
    const titles = () =>
      screen
        .getAllByTestId('map-mini-card')
        .map((c) => String(c.props.accessibilityLabel).split(',')[0]);
    // The mocked ScrollView's scrollTo (one shared fake on its prototype).
    const scrollTo = (ScrollView.prototype as unknown as { scrollTo: jest.Mock }).scrollTo;

    rpc.mockResolvedValue({
      data: [scored('A', 8), scored('B', 7.5), scored('C', 7)],
      error: null,
    });
    await drawMap();
    await fireEvent.press(screen.getByTestId('map-area-Shaw, DC'));
    // The card lays out 324 px wide: 300 px pages inside its 12 px padding.
    // (The handlers are called directly: RNTL's fireEvent skips views under
    // the card's swipe handler, which declines plain touches.)
    const W = 300;
    await act(async () =>
      screen.getByTestId('map-tap-card').props.onLayout({
        nativeEvent: { layout: { width: W + 24, height: 120, x: 0, y: 0 } },
      }),
    );
    // The guest swipes to page 2: "B one".
    await act(async () =>
      screen.getByTestId('map-card-pager').props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { x: W, y: 0 } },
      }),
    );
    expect(screen.getByLabelText('2 of 3')).toBeOnTheScreen();
    scrollTo.mockClear();

    // B turns Fire: the refresh puts it first. The card follows B to page 1
    // (before the fix it stayed on page 2, which was now "A one").
    rpc.mockResolvedValue({
      data: [scored('A', 8), scored('B', 9.4, 'Fire'), scored('C', 7)],
      error: null,
    });
    await act(() => jest.advanceTimersByTimeAsync(LIST_VIBE_REFRESH_MS));
    expect(titles()).toEqual(['B one', 'A one', 'C one']);
    expect(screen.getByLabelText('1 of 3')).toBeOnTheScreen();
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 0, animated: false });

    // If the viewed event leaves the area, the card keeps the page number
    // it was last seen on (page 1, where B had moved), now showing A.
    rpc.mockResolvedValue({ data: [scored('A', 8), scored('C', 7)], error: null });
    await act(() => jest.advanceTimersByTimeAsync(LIST_VIBE_REFRESH_MS));
    expect(titles()).toEqual(['A one', 'C one']);
    expect(screen.getByLabelText('1 of 2')).toBeOnTheScreen();
  });
});

/** Seven live Fire parties in seven areas close together. */
function sevenFireRows() {
  return Array.from({ length: 7 }, (_, i) =>
    row({
      event_id: `f${i}`,
      title: `Fire ${i}`,
      area_label: `Area ${i}, DC`,
      lat: 38.9 + i * 0.002,
      lng: -77,
      has_started: true,
      is_live: true,
      vibe_word: 'Fire',
      vibe_score: 9 + i / 10,
      starts_at: new Date(Date.now() - HOUR).toISOString(),
    }),
  );
}

/** A close view over the seven areas (about 4.4 km across). */
const CLOSE_VIEW = { latitude: 38.906, longitude: -77, latitudeDelta: 0.04, longitudeDelta: 0.04 };

/** Every pulse ring on the map (they are hidden from screen readers). */
const pulseRings = () => screen.queryAllByTestId(/-pulse$/, { includeHiddenElements: true });

describe('TonightMap pulse (VC-83 Batch 2)', () => {
  it('pulses at most 5 tags, the highest scores', async () => {
    // Each fake loop counts itself as running until it is stopped. (A tag
    // that pulsed at the first, middle zoom may stop once the close zoom
    // picks its own top 5, so we count running loops, not started ones.)
    let running = 0;
    const loop = jest.spyOn(Animated, 'loop').mockImplementation(() => {
      running += 1;
      return { start: jest.fn(), stop: jest.fn(() => (running -= 1)), reset: jest.fn() };
    });
    rpc.mockResolvedValue({ data: sevenFireRows(), error: null });
    await drawMap();
    await moveMapTo(CLOSE_VIEW);
    expect(pulseRings()).toHaveLength(MAX_PULSES);
    // The two lowest (9.0 and 9.1) stay still.
    const ids = pulseRings().map((r) => r.props.testID);
    expect(ids).not.toContain('map-area-Area 0, DC-pulse');
    expect(ids).not.toContain('map-area-Area 1, DC-pulse');
    expect(running).toBe(MAX_PULSES);
    loop.mockRestore();
  });

  it('never pulses a stale score', async () => {
    rpc.mockResolvedValue({
      data: sevenFireRows().map((r) => ({ ...r, vibe_stale: true })),
      error: null,
    });
    await drawMap();
    await moveMapTo(CLOSE_VIEW);
    expect(pulseRings()).toHaveLength(0);
  });

  it('shows still rings and starts no animation under Reduce Motion', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
    const loop = jest.spyOn(Animated, 'loop');
    rpc.mockResolvedValue({ data: sevenFireRows(), error: null });
    await drawMap();
    await moveMapTo(CLOSE_VIEW);
    expect(pulseRings()).toHaveLength(MAX_PULSES);
    expect(loop).not.toHaveBeenCalled();
    loop.mockRestore();
  });
});

describe('TonightMap band change (VC-83 Batch 2)', () => {
  /** Shaw's started party turns from Hot to Fire on the next refresh. */
  const FIRE_ROWS = [
    { ...THREE_ROWS[0], vibe_word: 'Fire', vibe_score: 9.1 },
    THREE_ROWS[1],
    THREE_ROWS[2],
  ];

  it('cross-fades the glow over 400 ms', async () => {
    jest.useFakeTimers();
    await drawMap();
    expect(circlesAt(38.9123)).toHaveLength(5);
    rpc.mockResolvedValue({ data: FIRE_ROWS, error: null });
    await act(() => jest.advanceTimersByTimeAsync(LIST_VIBE_REFRESH_MS));
    // The old Hot glow (still fully on) plus the new Fire glow (not in yet).
    const fading = circlesAt(38.9123);
    expect(fading).toHaveLength(10);
    expect(fading.slice(0, 5).map((c) => c.fillColor)).toEqual(
      heatLayers('Hot').map((l) => l.fill),
    );
    expect(fading.slice(5).map((c) => c.fillColor)).toEqual(
      heatLayers('Fire', 0).map((l) => l.fill),
    );
    await act(() => jest.advanceTimersByTimeAsync(GLOW_FADE_MS));
    expect(circlesAt(38.9123).map((c) => c.fillColor)).toEqual(
      heatLayers('Fire').map((l) => l.fill),
    );
  });

  it('changes the glow at once under Reduce Motion', async () => {
    jest.useFakeTimers();
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
    await drawMap();
    rpc.mockResolvedValue({ data: FIRE_ROWS, error: null });
    await act(() => jest.advanceTimersByTimeAsync(LIST_VIBE_REFRESH_MS));
    expect(circlesAt(38.9123).map((c) => c.fillColor)).toEqual(
      heatLayers('Fire').map((l) => l.fill),
    );
  });
});

/**
 * A fake touch for the card's swipe handler (React Native's responder
 * system reads the finger's path from `touchHistory`).
 *
 * @param time - the moment of this touch, in ms.
 * @param fromY - where the finger was at the previous touch.
 * @param toY - where it is now.
 * @returns the event.
 */
function touch(time: number, fromY: number, toY: number) {
  return {
    nativeEvent: {},
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: time,
      touchBank: [
        {
          touchActive: true,
          startPageX: 100,
          startPageY: fromY,
          startTimeStamp: 0,
          currentPageX: 100,
          currentPageY: toY,
          currentTimeStamp: time,
          previousPageX: 100,
          previousPageY: fromY,
          previousTimeStamp: time - 1,
        },
      ],
    },
  };
}

/**
 * Drags a finger down the card and lets go.
 *
 * @param distance - how far down, in px.
 * @param ms - how long the drag takes.
 */
async function swipeCardDown(distance: number, ms: number) {
  const card = screen.getByTestId('map-tap-card');
  await act(async () => {
    card.props.onResponderGrant(touch(1, 300, 300));
    card.props.onResponderMove(touch(1 + ms, 300, 300 + distance));
    card.props.onResponderRelease(touch(2 + ms, 300 + distance, 300 + distance));
  });
}

describe('TonightMap card closing (VC-83 Batch 2)', () => {
  it('tells a downward swipe from a sideways one or a tap', () => {
    expect(isSwipeDown(2, 30)).toBe(true);
    expect(isSwipeDown(40, 30)).toBe(false); // the pager's sideways swipe
    expect(isSwipeDown(0, 5)).toBe(false); // a tap that wobbled
    expect(isSwipeDown(0, -30)).toBe(false); // upwards
    expect(swipeCloses(80, 0.1)).toBe(true);
    expect(swipeCloses(30, 1)).toBe(true); // a quick flick
    expect(swipeCloses(30, 0.1)).toBe(false);
  });

  it('closes with a swipe down, and stays open after a short drag', async () => {
    await drawMap();
    await fireEvent.press(screen.getByTestId('map-area-Shaw, DC'));
    await swipeCardDown(20, 400);
    expect(screen.getByTestId('map-tap-card')).toBeOnTheScreen();
    await swipeCardDown(120, 300);
    expect(screen.queryByTestId('map-tap-card')).toBeNull();
  });

  it('closes with the screen reader escape gesture', async () => {
    await drawMap();
    await fireEvent.press(screen.getByTestId('map-area-Shaw, DC'));
    await act(async () => screen.getByTestId('map-tap-card').props.onAccessibilityEscape());
    expect(screen.queryByTestId('map-tap-card')).toBeNull();
  });
});

describe('TonightMap stale score (VC-83 Batch 2)', () => {
  it('speaks "stale" on the tag and the card', async () => {
    rpc.mockResolvedValue({
      data: [
        row({
          title: 'Old news',
          has_started: true,
          is_live: true,
          vibe_word: 'Hot',
          vibe_score: 7.2,
          vibe_stale: true,
          starts_at: new Date(Date.now() - 3 * HOUR).toISOString(),
        }),
      ],
      error: null,
    });
    await drawMap();
    const tag = screen.getByTestId('map-area-Shaw, DC');
    expect(tag.props.accessibilityLabel).toBe(
      'Old news, house party, area only, Shaw, Hot, 7.2, stale',
    );
    await fireEvent.press(tag);
    expect(String(screen.getByTestId('map-mini-card').props.accessibilityLabel)).toMatch(
      /vibe Hot, 7\.2, stale$/,
    );
  });
});
