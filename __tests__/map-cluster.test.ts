/**
 * Tests for the map's zoom planner (VC-83 map v2 Batch 2,
 * src/lib/map-cluster.ts). Plain functions, no screen.
 *
 * We check:
 *   - zoom levels: close under 6 km, far over 25 km or with 13+ spots on
 *     screen, middle otherwise;
 *   - grouping: spots within 56 px on screen merge, the hottest anchors;
 *   - a bubble sits at the plain average of its events' points, counts
 *     EVENTS, and is tinted by the hottest PUBLISHED band (Too early and
 *     not-started events never count). It carries no score, no average and
 *     no rater count, even when the rows hold them;
 *   - middle zoom: at most 8 tags, hottest first, a colliding lower tag
 *     becomes a dot (never moved), the picked spot always keeps its tag;
 *   - pulse: only live Hot/Fire with a fresh score, at most 5, highest first;
 *   - tapping a bubble zooms in to fit it (close zoom for one shared point);
 *   - each event's pulse delay is fixed and within one pulse.
 */
import type { Region } from 'react-native-maps';

import {
  CLOSE_DELTA,
  CLUSTER_PX,
  MAX_PULSES,
  MIDDLE_TAGS,
  PULSE_MS,
  canPulse,
  chooseTags,
  clusterOf,
  estimateTagWidth,
  groupNearby,
  planMap,
  pulseDelay,
  pulsingKeys,
  regionToFit,
  spanKm,
  toScreen,
  zoomLevel,
} from '@/lib/map-cluster';
import type { MapSpot } from '@/lib/map-cluster';
import { parseMapPoint } from '@/lib/map-read';
import type { MapPoint } from '@/lib/map-read';

// map-read imports the server client, which needs phone storage; these
// tests never call the server.
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

/** The test map: 400 x 400 px. */
const SIZE = { width: 400, height: 400 };

/**
 * A view of the map centred on (0, 0), so maths in tests stays simple.
 *
 * @param delta - degrees across (both ways).
 * @returns the region.
 */
function view(delta: number): Region {
  return { latitude: 0, longitude: 0, latitudeDelta: delta, longitudeDelta: delta };
}

/**
 * One map row.
 *
 * @param overrides - fields to change from a started, live Hot 7.4 party.
 * @returns a parsed MapPoint.
 */
function event(overrides: Record<string, unknown> = {}): MapPoint {
  return parseMapPoint({
    event_id: 'e1',
    title: 'Party',
    area_label: 'Shaw, DC',
    starts_at: '2026-11-07T03:00:00+00:00',
    ends_at: '2026-11-07T07:00:00+00:00',
    source: 'host',
    is_test: false,
    kind: 'area',
    lat: 0,
    lng: 0,
    radius_m: 600,
    has_started: true,
    is_live: true,
    vibe_word: 'Hot',
    vibe_score: 7.4,
    vibe_stale: false,
    ...overrides,
  }) as MapPoint;
}

/**
 * One spot.
 *
 * @param key - its key.
 * @param latitude - where (degrees).
 * @param longitude - where (degrees).
 * @param events - what is there (default: one Hot 7.4 party).
 * @returns the spot, with a 100 px wide tag.
 */
function spot(key: string, latitude: number, longitude: number, events?: MapPoint[]): MapSpot {
  return {
    key,
    latitude,
    longitude,
    events: events ?? [event({ event_id: `${key}-1` })],
    tagWidth: 100,
  };
}

describe('zoom level', () => {
  it('measures the wider side in km', () => {
    expect(spanKm(view(1))).toBeCloseTo(111.32, 1);
  });

  it('is close under 6 km, far over 25 km, middle between', () => {
    expect(zoomLevel([], view(0.05))).toBe('close'); // about 5.6 km
    expect(zoomLevel([], view(0.1))).toBe('middle'); // about 11 km
    expect(zoomLevel([], view(0.3))).toBe('far'); // about 33 km
  });

  it('is far at middle span when more than 12 spots are on screen', () => {
    const many = Array.from({ length: 13 }, (_, i) => spot(`s${i}`, 0, i * 0.001));
    expect(zoomLevel(many, view(0.1))).toBe('far');
    expect(zoomLevel(many.slice(0, 12), view(0.1))).toBe('middle');
    // Spots off screen don't count.
    const offScreen = many.map((s) => ({ ...s, latitude: 5 }));
    expect(zoomLevel(offScreen, view(0.1))).toBe('middle');
  });
});

describe('toScreen', () => {
  it('puts the centre in the middle and north at the top', () => {
    expect(toScreen({ latitude: 0, longitude: 0 }, view(1), SIZE)).toEqual({ x: 200, y: 200 });
    expect(toScreen({ latitude: 0.5, longitude: -0.5 }, view(1), SIZE)).toEqual({ x: 0, y: 0 });
  });
});

describe('grouping at far zoom', () => {
  // At view(1) on 400 px, 0.1 degree is 40 px.
  it('merges spots within 56 px and leaves the rest apart', () => {
    const groups = groupNearby(
      [spot('a', 0, 0), spot('b', 0, 0.1), spot('c', 0, 0.5)],
      view(1),
      SIZE,
    );
    expect(groups.map((g) => g.map((s) => s.key))).toEqual([['a', 'b'], ['c']]);
    expect(CLUSTER_PX).toBe(56);
  });

  it('anchors each group on its hottest spot', () => {
    const cool = spot('cool', 0, 0, [event({ event_id: 'c', vibe_word: 'Good', vibe_score: 5 })]);
    const hot = spot('hot', 0, 0.12, [event({ event_id: 'h', vibe_word: 'Fire', vibe_score: 9 })]);
    // "hot" is 48 px from "cool", "far" 48 px beyond "hot" (96 px from "cool").
    const far = spot('far', 0, 0.24, [event({ event_id: 'f', vibe_word: 'Good', vibe_score: 5 })]);
    const groups = groupNearby([cool, far, hot], view(1), SIZE);
    // Starting from the hottest, both neighbours are within 56 px of it.
    expect(groups.map((g) => g.map((s) => s.key))).toEqual([['hot', 'cool', 'far']]);
  });
});

describe('a count bubble', () => {
  it('is a plain dot for a single event', () => {
    const s = spot('a', 0, 0);
    expect(clusterOf([s])).toEqual({ kind: 'dot', spot: s });
  });

  it('sits at the average of its events, counts events, and takes the hottest published band', () => {
    const shaw = spot('Shaw, DC', 0, 0, [
      event({ event_id: 's1', vibe_word: 'Good', vibe_score: 5.5 }),
      // Not started: its (impossible) Fire never counts.
      event({ event_id: 's2', has_started: false, vibe_word: 'Fire', vibe_score: 9.9 }),
    ]);
    const uSt = spot('U Street, DC', 0.03, 0, [
      event({ event_id: 'u1', vibe_word: 'Hot', vibe_score: 7.7 }),
    ]);
    const bubble = clusterOf([shaw, uSt]);
    expect(bubble).toEqual(
      expect.objectContaining({ kind: 'cluster', count: 3, band: 'Hot', longitude: 0 }),
    );
    // Two events at 0 and one at 0.03: the average is 0.01.
    expect(bubble.kind === 'cluster' && bubble.latitude).toBeCloseTo(0.01, 10);
  });

  it('has no band when nothing inside shows a published score', () => {
    const bubble = clusterOf([
      spot('a', 0, 0, [
        event({ event_id: 'x', vibe_word: 'Early', vibe_score: null }),
        event({ event_id: 'y', has_started: false }),
      ]),
    ]);
    expect(bubble).toEqual(expect.objectContaining({ kind: 'cluster', count: 2, band: null }));
  });

  it('never carries a score, an average or a rater count', () => {
    // Unusual numbers so a leak is easy to spot; raters/here are fields the
    // server never sends to the map, added here to prove they'd go nowhere.
    const leaky = (id: string, score: number) =>
      ({
        ...event({ event_id: id, vibe_word: 'Fire', vibe_score: score }),
        raters: 4321,
        here: 8765,
      }) as MapPoint;
    const bubble = clusterOf([spot('a', 0, 0, [leaky('p', 9.3), leaky('q', 8.7)])]);
    if (bubble.kind !== 'cluster') throw new Error('expected a bubble');
    // Exactly these fields: a count of events and a band word, nothing else.
    expect(Object.keys(bubble).sort()).toEqual(
      ['band', 'count', 'key', 'kind', 'latitude', 'longitude', 'spots'].sort(),
    );
    const { spots, ...shown } = bubble;
    expect(spots).toHaveLength(1);
    expect(JSON.stringify(shown)).not.toMatch(/9\.3|8\.7|9\.0|4321|8765|hot/i);
    expect(shown.band).toBe('Fire');
  });
});

describe('tags at middle zoom', () => {
  it('shows at most 8 tags, hottest first', () => {
    // Ten spots spread out so none collide; scores 1.0 to 10.0.
    const spots = Array.from({ length: 10 }, (_, i) =>
      spot(`s${i}`, ((i % 5) - 2) * 0.015, (Math.floor(i / 5) - 0.5) * 0.04, [
        event({ event_id: `e${i}`, vibe_word: 'Good', vibe_score: i + 1 }),
      ]),
    );
    const keys = chooseTags(spots, view(0.1), SIZE, null);
    expect(keys.size).toBe(MIDDLE_TAGS);
    // The two coolest are the ones left as dots.
    expect(keys.has('s0')).toBe(false);
    expect(keys.has('s1')).toBe(false);
  });

  it('turns the cooler of two overlapping tags into a dot, without moving it', () => {
    const cool = spot('cool', 0, 0, [event({ event_id: 'c', vibe_word: 'Good', vibe_score: 5 })]);
    const hot = spot('hot', 0, 0.001, [event({ event_id: 'h', vibe_word: 'Fire', vibe_score: 9 })]);
    const plan = planMap([cool, hot], view(0.1), SIZE, null);
    expect(plan.level).toBe('middle');
    expect(plan.markers.map((m) => [m.kind, m.kind !== 'cluster' && m.spot.key])).toEqual([
      ['dot', 'cool'],
      ['tag', 'hot'],
    ]);
    // Same point as the server sent: nothing is nudged.
    const dot = plan.markers[0];
    expect(dot.kind === 'dot' && dot.spot.latitude).toBe(0);
  });

  it('always keeps the picked spot a tag', () => {
    const cool = spot('cool', 0, 0, [event({ event_id: 'c', vibe_word: 'Good', vibe_score: 5 })]);
    const hot = spot('hot', 0, 0.001, [event({ event_id: 'h', vibe_word: 'Fire', vibe_score: 9 })]);
    const keys = chooseTags([cool, hot], view(0.1), SIZE, 'cool');
    expect([...keys]).toEqual(['cool']);
  });

  it('keeps off-screen spots as tags without using up the 8', () => {
    const away = spot('away', 3, 3);
    const keys = chooseTags([away, spot('here', 0, 0)], view(0.1), SIZE, null);
    expect(keys).toEqual(new Set(['away', 'here']));
  });

  it('estimates wider tags for longer names', () => {
    expect(estimateTagWidth('Rooftop Sundown', '9.1')).toBeGreaterThan(
      estimateTagWidth('Shaw', '9.1'),
    );
  });
});

describe('plan', () => {
  it('draws bubbles and dots far out, and every tag close in', () => {
    const spots = [
      spot('a', 0, 0, [event({ event_id: 'a1' }), event({ event_id: 'a2' })]),
      spot('b', 0, 0.001),
      spot('c', 0.2, 0.2),
    ];
    const far = planMap(spots, view(1), SIZE, null);
    expect(far.level).toBe('far');
    expect(far.markers.map((m) => m.kind)).toEqual(['cluster', 'dot']);
    expect(far.markers[0].kind === 'cluster' && far.markers[0].count).toBe(3);
    const close = planMap(spots, view(0.02), SIZE, null);
    expect(close.level).toBe('close');
    expect(close.markers.every((m) => m.kind === 'tag')).toBe(true);
  });
});

describe('pulse', () => {
  it('needs a live Hot or Fire event with a fresh score', () => {
    expect(canPulse(event())).toBe(true);
    expect(canPulse(event({ vibe_word: 'Fire', vibe_score: 9.4 }))).toBe(true);
    expect(canPulse(event({ vibe_word: 'Good', vibe_score: 6 }))).toBe(false);
    expect(canPulse(event({ vibe_stale: true }))).toBe(false);
    expect(canPulse(event({ is_live: false }))).toBe(false);
    expect(canPulse(event({ vibe_word: 'Early', vibe_score: null }))).toBe(false);
  });

  it('picks at most 5, highest scores first', () => {
    const spots = Array.from({ length: 7 }, (_, i) =>
      spot(`s${i}`, 0, i, [
        event({ event_id: `e${i}`, vibe_word: 'Fire', vibe_score: 9 + i / 10 }),
      ]),
    );
    const keys = pulsingKeys(spots);
    expect(keys.size).toBe(MAX_PULSES);
    expect(keys).toEqual(new Set(['s6', 's5', 's4', 's3', 's2']));
  });

  it('caps the plan at 5 pulsing tags on screen', () => {
    const spots = Array.from({ length: 7 }, (_, i) =>
      spot(`s${i}`, 0, i * 0.002, [event({ event_id: `e${i}`, vibe_word: 'Fire', vibe_score: 9 })]),
    );
    const plan = planMap(spots, view(0.04), SIZE, null);
    expect(plan.markers.filter((m) => m.kind === 'tag' && m.pulse)).toHaveLength(MAX_PULSES);
  });

  it('gives each event a fixed delay within one pulse', () => {
    expect(pulseDelay('abc')).toBe(pulseDelay('abc'));
    for (const id of ['a', 'Shaw, DC', 'venue:123', '']) {
      expect(pulseDelay(id)).toBeGreaterThanOrEqual(0);
      expect(pulseDelay(id)).toBeLessThan(PULSE_MS);
    }
  });
});

describe('zooming in on a bubble', () => {
  it('zooms close around one shared point', () => {
    expect(regionToFit([{ latitude: 1, longitude: 2 }], view(1))).toEqual({
      latitude: 1,
      longitude: 2,
      latitudeDelta: CLOSE_DELTA,
      longitudeDelta: CLOSE_DELTA,
    });
  });

  it('fits several points, never wider than half the view', () => {
    const r = regionToFit(
      [
        { latitude: 0, longitude: 0 },
        { latitude: 0.1, longitude: 0.1 },
      ],
      view(1),
    );
    expect(r.latitude).toBeCloseTo(0.05);
    expect(r.longitude).toBeCloseTo(0.05);
    expect(r.latitudeDelta).toBeCloseTo(0.16);
    expect(r.latitudeDelta).toBeLessThanOrEqual(0.5);
  });
});
