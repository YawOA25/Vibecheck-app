/**
 * Tests for the map's data helpers (VC-79, src/lib/map-read.ts).
 *
 * We check:
 *   - parseMapPoint: bad rows are dropped, a placed row without both
 *     coordinates becomes "not on the map", circles never go under 600 m,
 *     and no vibe word survives before the start;
 *   - groupMapPoints: one circle per area, venue pins apart, and a count of
 *     unplaced events;
 *   - areaAt: a tap inside a circle finds it (the nearest centre when
 *     circles overlap), a tap outside finds nothing;
 *   - listMapPoints: sends the list's date window to get_map_points, caps
 *     at 300 and says when there were more, and turns errors into a message;
 *   - VC-83: the published score is kept only once started and only when
 *     it's a real 0-10 number; tagState / tagTrailing / tagName / tagSpoken
 *     say "8.4", "10 PM" or "Too early" (nobody rated and 1-4 raters read
 *     the same); hottestBand uses only published bands.
 */
import { THIS_WEEK, filterWindow } from '@/lib/date-filter';
import {
  MAP_LIMIT,
  TOO_EARLY,
  areaAt,
  fitCoordinates,
  groupMapPoints,
  hottestBand,
  listMapPoints,
  metresBetween,
  parseMapPoint,
  shortArea,
  tagName,
  tagSpoken,
  tagState,
  tagTrailing,
} from '@/lib/map-read';
import type { MapPoint } from '@/lib/map-read';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
const rpc = supabase.rpc as jest.Mock;

/**
 * Makes one server row.
 *
 * @param overrides - fields to change from a Shaw circle.
 * @returns a raw row as the server would send it.
 */
function raw(overrides: Record<string, unknown> = {}) {
  return {
    event_id: 'e1',
    title: 'Party',
    area_label: 'Shaw, DC',
    starts_at: '2026-11-07T03:00:00+00:00',
    ends_at: '2026-11-07T07:00:00+00:00',
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

/** A parsed row (the test fixtures are always valid). */
function point(overrides: Record<string, unknown> = {}): MapPoint {
  return parseMapPoint(raw(overrides)) as MapPoint;
}

describe('parseMapPoint', () => {
  it('keeps a good row', () => {
    expect(point()).toEqual(expect.objectContaining({ kind: 'area', lat: 38.9123, radius_m: 600 }));
  });

  it('drops rows that make no sense', () => {
    expect(parseMapPoint(null)).toBeNull();
    expect(parseMapPoint(raw({ event_id: 7 }))).toBeNull();
    expect(parseMapPoint(raw({ kind: 'house' }))).toBeNull();
  });

  it('treats a placed row without both coordinates as not on the map', () => {
    expect(point({ lng: null })).toEqual(
      expect.objectContaining({ kind: 'none', lat: null, lng: null, radius_m: null }),
    );
  });

  it('never makes a circle smaller than 600 m', () => {
    expect(point({ radius_m: 100 }).radius_m).toBe(600);
    expect(point({ radius_m: 1500 }).radius_m).toBe(1500);
  });

  it('drops the vibe word before the start (VC-61)', () => {
    expect(point({ vibe_word: 'Fire' }).vibe_word).toBeNull();
    expect(point({ vibe_word: 'Fire', has_started: true }).vibe_word).toBe('Fire');
  });

  it('keeps the published score only once started (VC-83)', () => {
    expect(point({ vibe_word: 'Fire', vibe_score: 9.1 }).vibe_score).toBeNull();
    const started = point({ has_started: true, vibe_word: 'Fire', vibe_score: 9.1 });
    expect(started.vibe_score).toBe(9.1);
    expect(started.vibe_stale).toBe(false);
  });

  it('rounds the score to 1 decimal, accepts "8.4" text, and drops nonsense', () => {
    const at = (vibe_score: unknown) => point({ has_started: true, vibe_score }).vibe_score;
    expect(at(8.46)).toBe(8.5);
    expect(at('8.4')).toBe(8.4);
    expect(at(11)).toBeNull();
    expect(at(-1)).toBeNull();
    expect(at('hot')).toBeNull();
    expect(at(null)).toBeNull();
  });

  it('marks stale only next to a score', () => {
    expect(point({ has_started: true, vibe_score: 6, vibe_stale: true }).vibe_stale).toBe(true);
    expect(point({ has_started: true, vibe_score: null, vibe_stale: true }).vibe_stale).toBe(false);
  });
});

describe('tag helpers (VC-83)', () => {
  it('shows the start time before the start, never a score', () => {
    const p = point({ vibe_word: 'Fire', vibe_score: 9.1 });
    expect(tagState(p)).toEqual({ kind: 'before', time: '10 PM' });
    expect(tagTrailing(tagState(p))).toBe('10 PM');
  });

  it('shows the published score with its band', () => {
    const p = point({ has_started: true, vibe_word: 'Hot', vibe_score: 8, vibe_stale: true });
    expect(tagState(p)).toEqual({ kind: 'score', score: 8, band: 'Hot', stale: true });
    // Always 1 decimal.
    expect(tagTrailing(tagState(p))).toBe('8.0');
  });

  it('reads "Too early" the same for nobody rated and for 1-4 raters', () => {
    const nobody = point({ has_started: true, vibe_word: null });
    const fewRaters = point({ has_started: true, vibe_word: 'Early' });
    expect(tagState(nobody)).toEqual({ kind: 'early' });
    expect(tagState(fewRaters)).toEqual({ kind: 'early' });
    expect(tagTrailing(tagState(nobody))).toBe(TOO_EARLY);
    // A number without a band word (never sent) is not trusted either.
    expect(tagState(point({ has_started: true, vibe_score: 7 }))).toEqual({ kind: 'early' });
  });

  it('shortens long names to 16 characters and an ellipsis', () => {
    expect(tagName('Rooftop Sundown')).toBe('Rooftop Sundown');
    expect(tagName('Basement Sessions Vol 2')).toBe('Basement Session…');
  });

  it('picks the hottest PUBLISHED band, ignoring Too early and not started', () => {
    expect(
      hottestBand([
        point({ has_started: true, vibe_word: 'Good', vibe_score: 5.2 }),
        point({ has_started: true, vibe_word: 'Hot', vibe_score: 7.4 }),
        point({ has_started: true, vibe_word: 'Early' }),
        // Not started: its (impossible) Fire is ignored.
        point({ vibe_word: 'Fire', vibe_score: 9.5 }),
      ]),
    ).toBe('Hot');
    expect(hottestBand([point({ has_started: true, vibe_word: 'Early' })])).toBeNull();
  });

  it('speaks name, kind, area and vibe, and never a count', () => {
    expect(
      tagSpoken(
        point({
          title: 'Rooftop Sundown',
          area_label: 'Navy Yard, DC',
          has_started: true,
          vibe_word: 'Hot',
          vibe_score: 8.4,
        }),
      ),
    ).toBe('Rooftop Sundown, house party, area only, Navy Yard, Hot, 8.4');
    expect(tagSpoken(point({ source: 'staff_pick' }))).toBe(
      'Party, staff pick, area only, Shaw, starts 10 PM',
    );
    expect(tagSpoken(point({ has_started: true }))).toBe(
      'Party, house party, area only, Shaw, Too early',
    );
  });
});

describe('groupMapPoints', () => {
  it('makes one circle per area, venues apart, and counts the rest', () => {
    const layout = groupMapPoints([
      point({ event_id: 'a' }),
      point({ event_id: 'b' }),
      point({ event_id: 'c', area_label: 'Clarendon, VA', lat: 38.8868, lng: -77.0953 }),
      point({ event_id: 'v', kind: 'venue', source: 'staff_pick', lat: 38.877, lng: -77.0041 }),
      point({ event_id: 'n', kind: 'none', lat: null, lng: null }),
    ]);
    expect(layout.areas.map((a) => [a.label, a.events.length])).toEqual([
      ['Shaw, DC', 2],
      ['Clarendon, VA', 1],
    ]);
    expect(layout.venues.map((v) => v.event_id)).toEqual(['v']);
    expect(layout.unplaced).toBe(1);
    // Fitting covers each circle's four edges plus the pin.
    expect(fitCoordinates(layout)).toHaveLength(2 * 4 + 1);
  });
});

describe('areaAt', () => {
  const layout = groupMapPoints([
    point({ event_id: 'shaw' }),
    point({ event_id: 'u', area_label: 'U Street, DC', lat: 38.917, lng: -77.029 }),
  ]);

  it('finds the circle a tap is in, nearest centre first when they overlap', () => {
    expect(areaAt({ latitude: 38.9125, longitude: -77.022 }, layout.areas)?.label).toBe('Shaw, DC');
    expect(areaAt({ latitude: 38.9168, longitude: -77.0288 }, layout.areas)?.label).toBe(
      'U Street, DC',
    );
  });

  it('finds nothing on empty map', () => {
    expect(areaAt({ latitude: 38.95, longitude: -77.1 }, layout.areas)).toBeNull();
  });

  it('measures distance in metres', () => {
    // One thousandth of a degree of latitude is about 111 m.
    const d = metresBetween(
      { latitude: 38.9, longitude: -77 },
      { latitude: 38.901, longitude: -77 },
    );
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });
});

describe('shortArea', () => {
  it('drops the state ending', () => {
    expect(shortArea('Shaw, DC')).toBe('Shaw');
    expect(shortArea('Mount Vernon (Baltimore), MD')).toBe('Mount Vernon (Baltimore)');
  });
});

describe('listMapPoints', () => {
  beforeEach(() => rpc.mockReset());

  it('sends the list window and keeps at most 300 points', async () => {
    const now = new Date('2026-11-06T20:00:00Z');
    rpc.mockResolvedValue({
      data: Array.from({ length: MAP_LIMIT + 1 }, (_, i) => raw({ event_id: `e${i}` })),
      error: null,
    });
    const outcome = await listMapPoints(now, THIS_WEEK);
    const w = filterWindow(THIS_WEEK, now);
    expect(rpc).toHaveBeenCalledWith('get_map_points', {
      p_ends_after: w.endsAfter.toISOString(),
      p_starts_from: null,
      p_starts_before: w.startsBefore.toISOString(),
    });
    expect(outcome).toEqual(expect.objectContaining({ ok: true, more: true }));
    if (outcome.ok) expect(outcome.points).toHaveLength(MAP_LIMIT);
  });

  it('turns an error or a throw into a message', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } });
    expect(await listMapPoints()).toEqual({
      ok: false,
      message: "We couldn't reach the server. Check your connection and try again.",
    });
    rpc.mockRejectedValueOnce(new Error('boom'));
    expect(await listMapPoints()).toEqual({
      ok: false,
      message: "We couldn't load events. Please try again.",
    });
  });
});
