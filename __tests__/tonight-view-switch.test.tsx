/**
 * Tests for Tonight's List / Map switch (VC-79, app/(tabs)/index.tsx).
 *
 * The list read, the map read (through a fake supabase), the router and
 * location are fakes. We check:
 *   - the switch is there with "List view" picked first;
 *   - picking "Map view" swaps the list for the map, and the map asks for
 *     the same date filter's window as the list;
 *   - the map's "See the list" switches back to the list;
 *   - a date chip picked on the list also drives the map (one shared filter);
 *   - on Android the Map side is the "Map coming soon" stand-in.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import HomeScreen from '../app/(tabs)/index';
import { ANDROID_TITLE, SEE_LIST_LABEL } from '@/components/TonightMap';
import { useAuth } from '@/lib/auth-context';
import { filterWindow } from '@/lib/date-filter';
import { listHomeEvents } from '@/lib/events-read';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/events-read', () => ({
  listHomeEvents: jest.fn(),
  describeReadError: () => "We couldn't load events. Please try again.",
}));
jest.mock('@/lib/sentry', () => ({ sendTestError: jest.fn(() => true) }));
jest.mock('@/lib/vibe-api', () => ({ getEventsVibe: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false })),
  requestForegroundPermissionsAsync: jest.fn(),
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useScrollToTop: () => undefined,
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(effect, [effect]);
  },
}));

const rpc = supabase.rpc as jest.Mock;
const realOS = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'user-1', display_name: 'Ava', role: 'user', is_tester: false },
    signOut: jest.fn(),
  });
  (listHomeEvents as jest.Mock).mockResolvedValue({ ok: true, events: [], hasMore: false });
  rpc.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  Platform.OS = realOS;
});

describe('Tonight List / Map switch', () => {
  it('starts on the list', async () => {
    await render(<HomeScreen />);
    expect(screen.getByRole('tab', { name: 'List view' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Map view' })).not.toBeSelected();
    expect(screen.getByTestId('tonight-list')).toBeOnTheScreen();
    expect(screen.queryByTestId('tonight-map')).toBeNull();
    // The map isn't loaded until it's asked for.
    expect(rpc).not.toHaveBeenCalled();
  });

  it('shows the map for the same filter, and See the list goes back', async () => {
    await render(<HomeScreen />);
    // Pick "Tonight" on the shared chips first, then switch to the map.
    await fireEvent.press(screen.getByRole('radio', { name: /^Tonight/ }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Map view' }));
    expect(screen.getByTestId('tonight-map')).toBeOnTheScreen();
    expect(screen.queryByTestId('tonight-list')).toBeNull();
    const asked = rpc.mock.calls[0][1];
    const tonight = filterWindow({ kind: 'tonight' }, new Date());
    expect(Date.parse(asked.p_starts_before)).toBe(tonight.startsBefore.getTime());

    await fireEvent.press(screen.getAllByRole('button', { name: SEE_LIST_LABEL })[0]);
    expect(screen.getByTestId('tonight-list')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'List view' })).toBeSelected();
  });

  it('shows Map coming soon on Android', async () => {
    Platform.OS = 'android';
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Map view' }));
    expect(screen.getByText(ANDROID_TITLE)).toBeOnTheScreen();
    expect(screen.queryByTestId('tonight-map')).toBeNull();
  });
});
