/**
 * Screen tests for "Your night" (app/recap.tsx) and the Me screen with Nights
 * out (app/me.tsx), task VC-B12.
 *
 * The server call (src/lib/recap-api.ts) is faked. These tests check that:
 *   - the recap shows your word next to the room's final WORD (never a night
 *     number), the last published score and the top reaction;
 *   - an early snapshot (under 5 raters) shows no number and no word;
 *   - one event from Nights out opens on its own (`?event=`);
 *   - loading, error with "Try again", and empty states work;
 *   - Me shows the "Last night, rated" card and the Nights out list, and
 *     their taps open the right recap;
 *   - VC-81: Me shows "MEMBER SINCE OCT 2026" under the name and the stats
 *     row (NIGHTS OUT, RATINGS, read out as one sentence); if the stats
 *     fail, the row is left out and the rest of Me still works.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import MeScreen from '../app/(tabs)/me';
import RecapScreen from '../app/recap';
import { useAuth } from '@/lib/auth-context';
import { parseRecap } from '@/lib/recap';
import type { RecapItem } from '@/lib/recap';
import { getMyStats } from '@/lib/profile-stats-api';
import { getMyRecap } from '@/lib/recap-api';

jest.mock('@/lib/recap-api', () => ({ getMyRecap: jest.fn() }));
jest.mock('@/lib/profile-stats-api', () => ({ getMyStats: jest.fn() }));
const stats = getMyStats as jest.Mock;
jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));
// The "mock" prefix lets jest.mock (which runs first) use these fakes.
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
/** Re-runs the focus effect: the Me tab losing and regaining focus. */
let mockRefocus: () => void = () => {};
/** VC-76: "See your nights out" closes the recap back to Me. */
const mockDismissTo = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: jest.fn(),
    replace: jest.fn(),
    // VC-76: the recap sheet closes back down to Me.
    dismissTo: mockDismissTo,
    canGoBack: () => true,
  }),
  // Me is a tab (Q4): its list scrolls to the top on a tab tap; a no-op here.
  useScrollToTop: () => undefined,
  // Outside a real navigator the screen comes "into view" once, like a
  // normal useEffect. `mockRefocus` lets a test leave and re-open the tab.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => {
      let cleanup = effect();
      mockRefocus = () => {
        if (typeof cleanup === 'function') cleanup();
        cleanup = effect();
      };
      return () => {
        if (typeof cleanup === 'function') cleanup();
      };
    }, [effect]);
  },
  useLocalSearchParams: () => mockParams,
}));

const recap = getMyRecap as jest.Mock;

/**
 * Builds a recap item the way the server would send it, then parses it.
 *
 * @param id - the event id.
 * @param title - the event name.
 * @param vibe - changes to a live published vibe.
 * @returns the parsed item.
 */
function item(id: string, title: string, vibe: Record<string, unknown> = {}): RecapItem {
  const parsed = parseRecap([
    {
      event_id: id,
      title,
      area_label: 'Navy Yard',
      starts_at: '2026-10-17T22:00:00-04:00',
      rated_at: '2026-10-17T23:30:00-04:00',
      mine: { crowd: 3, music: 3, energy: 3, reaction: 'fire', label: 'Fire' },
      vibe: {
        state: 'stale',
        raters: 12,
        here: 0,
        score: 8.7,
        label: 'Hot',
        minutes_since_last: 600,
        reactions: [{ reaction: 'dancing', count: 5 }],
        breakdown: null,
        night: { label: 'Good', raters: 12, over: true, breakdown: null },
        ...vibe,
      },
    },
  ]);
  if (!parsed?.[0]) throw new Error('test item did not parse');
  return parsed[0];
}

const ROOFTOP = item('e1', 'Rooftop Sundown');
const EARLY = item('e2', 'Basement Disco', {
  state: 'early',
  raters: 3,
  score: null,
  label: null,
  reactions: [],
  night: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'p1', display_name: 'Ava', role: 'user' },
  });
  // VC-81: by default the stats don't load (the row is left out).
  stats.mockResolvedValue({ ok: false });
});

describe('Your night (recap)', () => {
  it("shows your word next to the room's night word, last score and top reaction", async () => {
    recap.mockResolvedValue({ ok: true, items: [ROOFTOP] });
    await render(<RecapScreen />);
    expect(await screen.findByText('Rooftop Sundown')).toBeOnTheScreen();
    expect(recap).toHaveBeenCalledWith('recent');
    expect(screen.getByText('Fire')).toBeOnTheScreen();
    expect(screen.getByText('Packed crowd · Fire music · Fire energy')).toBeOnTheScreen();
    expect(screen.getByText('Good')).toBeOnTheScreen();
    expect(screen.getByText('12 ratings all night')).toBeOnTheScreen();
    expect(screen.getByText('Last score 8.7')).toBeOnTheScreen();
    expect(screen.getByText('Top reaction: 💃 Dancing (5)')).toBeOnTheScreen();
    // Screen readers hear your own reaction too (cto review).
    expect(
      screen.getByLabelText(
        'You called Fire. Packed crowd · Fire music · Fire energy Your reaction: Fire.',
      ),
    ).toBeOnTheScreen();
  });

  it('early snapshot: no number and no word for the room', async () => {
    recap.mockResolvedValue({ ok: true, items: [EARLY] });
    await render(<RecapScreen />);
    expect(await screen.findByText("Only 3 people rated, so there's no score.")).toBeOnTheScreen();
    expect(screen.queryByText(/Last score/)).toBeNull();
    expect(screen.queryByText(/Top reaction/)).toBeNull();
  });

  it('one night from Nights out: loads the full list and shows just that event', async () => {
    mockParams = { event: 'e2' };
    recap.mockResolvedValue({ ok: true, items: [ROOFTOP, EARLY] });
    await render(<RecapScreen />);
    expect(await screen.findByText('Basement Disco')).toBeOnTheScreen();
    expect(recap).toHaveBeenCalledWith('all');
    expect(screen.queryByText('Rooftop Sundown')).toBeNull();
  });

  it('empty: says when the recap comes, and links to Nights out', async () => {
    recap.mockResolvedValue({ ok: true, items: [] });
    await render(<RecapScreen />);
    expect(await screen.findByText('Nothing to recap yet')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'See your nights out' }));
    // VC-76: it closes the recap sheet back to the Me tab, never stacking
    // a second Me inside the sheet.
    expect(mockDismissTo).toHaveBeenCalledWith('/me');
    expect(mockPush).not.toHaveBeenCalledWith('/me');
  });

  it('error: shows the message and "Try again" loads again', async () => {
    recap
      .mockResolvedValueOnce({ ok: false, message: "We couldn't load your nights out." })
      .mockResolvedValueOnce({ ok: true, items: [ROOFTOP] });
    await render(<RecapScreen />);
    expect(await screen.findByText("We couldn't load your nights out.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Rooftop Sundown')).toBeOnTheScreen();
  });
});

describe('Me stats row (VC-81)', () => {
  it('shows the member-since line and the two counts, read out as one sentence', async () => {
    recap.mockResolvedValue({ ok: true, items: [] });
    stats.mockResolvedValue({
      ok: true,
      // 2 AM UTC on 1 Nov is still 31 Oct in New York: the month is October.
      stats: { nightsOut: 4, ratings: 1, memberSince: new Date('2026-11-01T02:00:00Z') },
    });
    await render(<MeScreen />);
    expect(await screen.findByText('MEMBER SINCE OCT 2026')).toBeOnTheScreen();
    const row = screen.getByTestId('me-stats');
    expect(row.props.accessibilityLabel).toBe('4 nights out, 1 rating');
    expect(screen.getByText('NIGHTS OUT')).toBeOnTheScreen();
    expect(screen.getByText('RATINGS')).toBeOnTheScreen();
    expect(screen.getByText('4')).toBeOnTheScreen();
    expect(stats).toHaveBeenCalledTimes(1);
  });

  it('leaves the row out when the stats fail, and the rest of Me still shows', async () => {
    recap.mockResolvedValue({ ok: true, items: [] });
    await render(<MeScreen />);
    expect(await screen.findByText(/No nights yet/)).toBeOnTheScreen();
    expect(screen.queryByTestId('me-stats')).toBeNull();
    expect(screen.queryByText(/MEMBER SINCE/)).toBeNull();
  });
});

describe('Me (Nights out)', () => {
  it('shows the name, the last-night card (words only) and the list', async () => {
    recap.mockImplementation(async (scope: string) =>
      scope === 'recent' ? { ok: true, items: [ROOFTOP] } : { ok: true, items: [ROOFTOP, EARLY] },
    );
    await render(<MeScreen />);
    expect(await screen.findByText('YOUR NIGHTS OUT')).toBeOnTheScreen();
    expect(screen.getByText('Ava')).toBeOnTheScreen();
    expect(screen.getByText('You called Fire. The room said Good.')).toBeOnTheScreen();
    expect(screen.getByText('Basement Disco')).toBeOnTheScreen();
    // No number anywhere on Me: the room is a word (or a dash when withheld).
    expect(screen.queryByText(/8\.7/)).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: /^Last night, rated/ }));
    expect(mockPush).toHaveBeenCalledWith('/recap');
    await fireEvent.press(screen.getByRole('button', { name: /^Basement Disco/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/recap', params: { event: 'e2' } });
  });

  it('nothing rated yet: no card, and an empty note', async () => {
    recap.mockResolvedValue({ ok: true, items: [] });
    await render(<MeScreen />);
    expect(await screen.findByText(/No nights yet/)).toBeOnTheScreen();
    expect(screen.queryByText('LAST NIGHT, RATED')).toBeNull();
  });

  // cto must-fix (Q4): Me is a tab that stays mounted, so it must reload
  // each time it comes back into view, or a night rated meanwhile is missing.
  it('reloads Nights out when the Me tab regains focus', async () => {
    recap.mockResolvedValue({ ok: true, items: [] });
    await render(<MeScreen />);
    expect(await screen.findByText(/No nights yet/)).toBeOnTheScreen();
    expect(recap).toHaveBeenCalledTimes(2); // 'recent' and 'all'

    // The guest rates a night elsewhere, then comes back to the Me tab.
    recap.mockImplementation(async (scope: string) =>
      scope === 'recent' ? { ok: true, items: [ROOFTOP] } : { ok: true, items: [ROOFTOP] },
    );
    await act(() => mockRefocus());
    expect(await screen.findByText('You called Fire. The room said Good.')).toBeOnTheScreen();
    expect(screen.getByText('Rooftop Sundown')).toBeOnTheScreen();
    expect(screen.queryByText(/No nights yet/)).toBeNull();
    expect(recap).toHaveBeenCalledTimes(4);
  });

  it('keeps the list on screen if a refresh on focus fails', async () => {
    recap.mockResolvedValue({ ok: true, items: [ROOFTOP] });
    await render(<MeScreen />);
    expect(await screen.findByText('Rooftop Sundown')).toBeOnTheScreen();
    recap.mockResolvedValue({ ok: false, message: 'Oops.' });
    await act(() => mockRefocus());
    expect(screen.getByText('Rooftop Sundown')).toBeOnTheScreen();
    expect(screen.queryByText('Oops.')).toBeNull();
  });

  it('error: "Try again" loads again', async () => {
    recap.mockResolvedValueOnce({ ok: false, message: 'Oops.' }).mockResolvedValue({
      ok: true,
      items: [],
    });
    await render(<MeScreen />);
    expect(await screen.findByText('Oops.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/No nights yet/)).toBeOnTheScreen();
  });
});
