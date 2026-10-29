/**
 * Tests for the Tonight map (VC-79): src/components/TonightMap.tsx, the
 * mini card (src/components/MapMiniCard.tsx) and the List / Map switch on
 * the Tonight screen.
 *
 * The map itself is replaced by the fake in __mocks__/react-native-maps.js
 * (plain Views that keep their props), the server by a fake `supabase.rpc`,
 * and location by a fake expo-location. We check:
 *   - the switch: List first, Map shows the map, "See the list" goes back;
 *   - one translucent gold circle per AREA (two Shaw parties share one),
 *     around the centre the server sent, with "Shaw · 2" on its pill;
 *   - the map asks the server with the list's date window, and frames the
 *     circles once (not again on the minute refresh);
 *   - tapping a pill opens the card; its mini cards show the vibe word only
 *     for started events, "1 of 2" for two events, and open the event page;
 *     a tap on empty map closes it;
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

import { MAP_NO_VIBE } from '@/components/MapMiniCard';
import {
  ANDROID_TITLE,
  CIRCLE_FILL,
  CIRCLE_STROKE,
  LOCATE_LABEL,
  MAP_LOADING_LABEL,
  MORE_THAN_LIMIT,
  SEE_LIST_LABEL,
  TonightMap,
} from '@/components/TonightMap';
import { THIS_WEEK, filterWindow } from '@/lib/date-filter';
import { resetReduceMotionForTests } from '@/lib/reduce-motion';
import { supabase } from '@/lib/supabase';
import { LIST_VIBE_REFRESH_MS } from '@/lib/vibe';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
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
    ...overrides,
  };
}

/** Two Shaw parties (one started, "Hot") and one in Clarendon. */
const THREE_ROWS = [
  row({
    event_id: 'e1',
    title: 'Shaw kickback',
    has_started: true,
    is_live: true,
    vibe_word: 'Hot',
    starts_at: new Date(Date.now() - HOUR).toISOString(),
  }),
  // The server never sends a word before the start; even if it did, it's hidden.
  row({ event_id: 'e2', title: 'Shaw later', vibe_word: 'Fire' }),
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

const onSeeList = jest.fn();
const onOpenEvent = jest.fn();

/** Draws the map with the default filter and fake callbacks. */
async function drawMap() {
  await render(<TonightMap filter={THIS_WEEK} onSeeList={onSeeList} onOpenEvent={onOpenEvent} />);
}

const realOS = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  resetReduceMotionForTests();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  getPermission.mockResolvedValue({ granted: false, status: 'denied' });
  rpc.mockResolvedValue({ data: THREE_ROWS, error: null });
});

afterEach(() => {
  Platform.OS = realOS;
  jest.useRealTimers();
});

describe('TonightMap circles', () => {
  it('draws one gold circle per area, around the centre the server sent', async () => {
    await drawMap();
    const circles = screen.getAllByTestId('map-circle');
    // Two areas (the two Shaw parties share one circle).
    expect(circles).toHaveLength(2);
    expect(circles[0].props.center).toEqual({ latitude: 38.9123, longitude: -77.0219 });
    expect(circles[0].props.radius).toBe(600);
    expect(circles[0].props.fillColor).toBe(CIRCLE_FILL);
    expect(circles[0].props.strokeColor).toBe(CIRCLE_STROKE);
    expect(screen.getByText('Shaw · 2')).toBeOnTheScreen();
    expect(screen.getByText('Clarendon · 1')).toBeOnTheScreen();
  });

  it('never draws a circle smaller than 600 m, even if told to', async () => {
    rpc.mockResolvedValue({ data: [row({ radius_m: 50 })], error: null });
    await drawMap();
    expect(screen.getByTestId('map-circle').props.radius).toBe(600);
  });

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

describe('TonightMap tap card', () => {
  it('opens the area card with a mini card per event; word only once started', async () => {
    await drawMap();
    expect(screen.queryByTestId('map-tap-card')).toBeNull();
    await fireEvent.press(screen.getByTestId('map-area-Shaw, DC'));
    const cards = screen.getAllByTestId('map-mini-card');
    expect(cards).toHaveLength(2);
    expect(screen.getByText('1 of 2')).toBeOnTheScreen();
    // The started party shows its word; the later one shows none at all.
    const words = screen.getAllByTestId('map-mini-card-word');
    expect(words).toHaveLength(1);
    expect(words[0]).toHaveTextContent('Hot');
    expect(screen.queryByText('Fire')).toBeNull();
    // Where: the area only, never more.
    expect(screen.getAllByText(/^Somewhere in Shaw, DC · /)).toHaveLength(2);
    expect(cards[0].props.accessibilityLabel).toMatch(
      /^Shaw kickback, Somewhere in Shaw, DC, .*vibe Hot$/,
    );
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

  it('shows "No vibe yet" for a started party nobody rated', async () => {
    rpc.mockResolvedValue({
      data: [row({ has_started: true, is_live: true, vibe_word: null })],
      error: null,
    });
    await drawMap();
    await fireEvent.press(screen.getByTestId('map-area-Shaw, DC'));
    expect(screen.getByTestId('map-mini-card-word')).toHaveTextContent(MAP_NO_VIBE);
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
    expect(screen.getAllByTestId('map-circle')).toHaveLength(2);
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
    // Still only the two real areas get circles.
    expect(screen.getAllByTestId('map-circle')).toHaveLength(2);
  });

  it('says when more than 300 events came back', async () => {
    const many = Array.from({ length: 301 }, (_, i) => row({ event_id: `m${i}` }));
    rpc.mockResolvedValue({ data: many, error: null });
    await drawMap();
    expect(screen.getByText(MORE_THAN_LIMIT)).toBeOnTheScreen();
    expect(screen.getByText('Shaw · 300')).toBeOnTheScreen();
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
