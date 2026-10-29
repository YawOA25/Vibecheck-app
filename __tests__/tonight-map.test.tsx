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
 *   - Android: "Map coming soon" with "See the list", and no map at all.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { AccessibilityInfo, Platform } from 'react-native';
import * as Maps from 'react-native-maps';

import { heatLayers } from '@/components/AreaHeat';
import { TAG_REDRAW_MS } from '@/components/MapTag';
import {
  ANDROID_TITLE,
  CAMERA_MS,
  CARD_LIFT,
  DC_REGION,
  LEGEND_TEXT,
  LOCATE_LABEL,
  MAP_LOADING_LABEL,
  MORE_THAN_LIMIT,
  SEE_LIST_LABEL,
  TonightMap,
} from '@/components/TonightMap';
import { useAuth } from '@/lib/auth-context';
import { THIS_WEEK, filterWindow } from '@/lib/date-filter';
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
    // Shaw's hottest published band is Hot: three stacked circles.
    const shaw = circlesAt(38.9123);
    const hot = heatLayers('Hot');
    expect(shaw.map((c) => c.radius)).toEqual([600, 396, 198]);
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

  it('shows the legend', async () => {
    await drawMap();
    expect(screen.getByText(LEGEND_TEXT)).toBeOnTheScreen();
    expect(screen.getByTestId('map-legend').props.accessibilityLabel).toBe(
      `Heat from Quiet, Good, Hot, Fire. ${LEGEND_TEXT}.`,
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
    expect(screen.getByText('1 of 2')).toBeOnTheScreen();
    // The started party shows the gauge; the later one shows nothing about ratings.
    expect(screen.getAllByTestId('map-mini-card-gauge')).toHaveLength(1);
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
    expect(screen.queryByTestId('map-mini-card-gauge')).toBeNull();
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
