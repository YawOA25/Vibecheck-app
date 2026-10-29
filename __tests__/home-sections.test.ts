/**
 * Tests for the VC-84 home section rules (src/lib/home-sections.ts): the
 * special-night list, which tonight events go in the Live now and Later
 * tonight bands (and where the VC-80 hero sits), the Staff picks band, and
 * the "Coming up" day headings with their counts.
 *
 * The clock is pinned to Saturday 17 Oct 2026, 10 PM New York (EDT), two
 * weeks before Halloween (Saturday 31 Oct) and far from the 1 Nov clock
 * change. Times below are New York times.
 */
import { homeLayout } from '@/lib/home-layout';
import {
  EARLIER_TONIGHT_TITLE,
  LATER_TONIGHT_TITLE,
  LIVE_NOW_TITLE,
  SPECIAL_NIGHTS,
  STAFF_PICKS_MAX,
  comingUpDays,
  eventsText,
  headingSpoken,
  specialNight,
  staffPicks,
  tonightBands,
} from '@/lib/home-sections';
import { groupByDay } from '@/lib/tonight';
import type { PublicEvent } from '@/lib/tonight';
import type { Vibe } from '@/lib/vibe';

/** 10 PM New York on Saturday 17 Oct 2026. */
const NOW = new Date('2026-10-18T02:00:00Z');
const HOUR = 60 * 60 * 1000;

/**
 * Makes an event starting `startsInHours` from NOW.
 *
 * @param id - its id (also its title).
 * @param startsInHours - hours from NOW to the start (negative: started).
 * @param overrides - other fields to change (e.g. source: 'staff_pick').
 * @param lastsHours - how long it lasts (default 4).
 * @returns a PublicEvent.
 */
function ev(
  id: string,
  startsInHours: number,
  overrides: Partial<PublicEvent> = {},
  lastsHours = 4,
): PublicEvent {
  const starts = new Date(NOW.getTime() + startsInHours * HOUR);
  return {
    id,
    title: id,
    area_label: 'Shaw, DC',
    starts_at: starts.toISOString(),
    ends_at: new Date(starts.getTime() + lastsHours * HOUR).toISOString(),
    source: 'host',
    ticket_url: null,
    summary: null,
    is_21_plus: false,
    is_test: false,
    ...overrides,
  };
}

/**
 * Makes an event at a fixed moment (for the Halloween dates).
 *
 * @param id - its id.
 * @param startsAt - the start, as an ISO time.
 * @returns a 3-hour PublicEvent.
 */
function at(id: string, startsAt: string): PublicEvent {
  const starts = new Date(startsAt);
  return {
    ...ev(id, 0),
    starts_at: starts.toISOString(),
    ends_at: new Date(starts.getTime() + 3 * HOUR).toISOString(),
  };
}

/**
 * A live published vibe.
 *
 * @param score - the score.
 * @returns a Vibe in the 'live' state.
 */
function live(score: number): Vibe {
  return {
    state: 'live',
    raters: 8,
    here: 10,
    score,
    label: score >= 8.5 ? 'Fire' : 'Hot',
    nightAverage: null,
    minutesSinceLast: 3,
    reactions: [],
    breakdown: null,
    night: null,
  };
}

/**
 * Runs the real VC-80 layout, then the VC-84 band split, as the screen does.
 *
 * @param events - the loaded events.
 * @param vibes - published vibes by id.
 * @returns the bands.
 */
function bandsFor(events: PublicEvent[], vibes: Record<string, Vibe> = {}) {
  return tonightBands(homeLayout(groupByDay(events, NOW), vibes, NOW), NOW);
}

describe('specialNight', () => {
  it('knows Halloween and New Year’s Eve from the in-code list', () => {
    expect(specialNight({ year: 2026, month: 10, day: 31 })).toBe('Halloween');
    expect(specialNight({ year: 2027, month: 10, day: 31 })).toBe('Halloween');
    expect(specialNight({ year: 2026, month: 12, day: 31 })).toBe("New Year's Eve");
    expect(SPECIAL_NIGHTS.map((n) => n.name)).toEqual(['Halloween', "New Year's Eve"]);
  });

  it('is null on ordinary nights, including the days either side', () => {
    expect(specialNight({ year: 2026, month: 10, day: 30 })).toBeNull();
    expect(specialNight({ year: 2026, month: 11, day: 1 })).toBeNull();
    expect(specialNight({ year: 2026, month: 1, day: 1 })).toBeNull();
  });

  it('reads another list when given one (the team can add nights)', () => {
    const list = [{ month: 7, day: 4, name: 'Fourth of July' }];
    expect(specialNight({ year: 2026, month: 7, day: 4 }, list)).toBe('Fourth of July');
    expect(specialNight({ year: 2026, month: 10, day: 31 }, list)).toBeNull();
  });
});

describe('tonightBands', () => {
  it('no tonight events: no bands', () => {
    expect(bandsFor([])).toEqual([]);
    expect(bandsFor([ev('tomorrow', 24)])).toEqual([]);
  });

  it('1 event still to start: one Later tonight band holding the Next up hero', () => {
    const bands = bandsFor([ev('soon', 1)]);
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({ kind: 'later', title: LATER_TONIGHT_TITLE, count: 1 });
    expect(bands[0].hero).toMatchObject({ kind: 'next', event: { id: 'soon' } });
    expect(bands[0].others).toEqual([]);
  });

  it('1 event on now: one Live now band with the hero', () => {
    const bands = bandsFor([ev('on', -1)]);
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({ kind: 'live', title: LIVE_NOW_TITLE, count: 1 });
    expect(bands[0].hero?.event.id).toBe('on');
  });

  it('many: live hero and started events in Live now, the rest in Later tonight', () => {
    const events = [ev('hot', -2), ev('fire', -1), ev('early', -1), ev('late', 2), ev('soon', 1)];
    const bands = bandsFor(events, { hot: live(7.5), fire: live(9.2) });
    expect(bands.map((b) => b.kind)).toEqual(['live', 'later']);
    const [liveBand, laterBand] = bands;
    // The hero rule is VC-80's: the highest live score.
    expect(liveBand.hero).toMatchObject({ kind: 'live', event: { id: 'fire' } });
    // Carousel order kept: live with a score, then on now without one.
    expect(liveBand.others.map((e) => e.id)).toEqual(['hot', 'early']);
    expect(liveBand.count).toBe(3);
    // Not started: soonest first, and no hero here.
    expect(laterBand.hero).toBeNull();
    expect(laterBand.others.map((e) => e.id)).toEqual(['soon', 'late']);
    expect(laterBand.count).toBe(2);
  });

  it('no live score yet: the Next up hero opens Later tonight, on-now events stay in Live now', () => {
    const bands = bandsFor([ev('early', -1), ev('soon', 1), ev('late', 3)]);
    expect(bands[0]).toMatchObject({ kind: 'live', title: LIVE_NOW_TITLE, hero: null, count: 1 });
    expect(bands[0].others.map((e) => e.id)).toEqual(['early']);
    expect(bands[1].hero).toMatchObject({ kind: 'next', event: { id: 'soon' } });
    expect(bands[1].others.map((e) => e.id)).toEqual(['late']);
    expect(bands[1].count).toBe(2);
  });

  it('only ended events left tonight: the first band says "Earlier tonight"', () => {
    // Started 3 h ago, lasted 1 h: over, but still in tonight's list.
    const bands = bandsFor([ev('done', -3, {}, 1)]);
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({ kind: 'live', title: EARLIER_TONIGHT_TITLE, count: 1 });
  });
});

describe('staffPicks', () => {
  it('keeps staff picks still to come or on now, soonest first, and never ended ones', () => {
    const pick = { source: 'staff_pick' as const };
    const events = [
      ev('host', 1),
      ev('friday', 70, pick),
      ev('tonight', 1, pick),
      ev('on', -1, pick),
      ev('ended', -3, pick, 1),
    ];
    expect(staffPicks(events, NOW).map((e) => e.id)).toEqual(['on', 'tonight', 'friday']);
  });

  it('shows at most 5, and none when there are no picks', () => {
    const many = Array.from({ length: 8 }, (_, i) => ev(`p${i}`, 24 + i, { source: 'staff_pick' }));
    expect(staffPicks(many, NOW)).toHaveLength(STAFF_PICKS_MAX);
    expect(staffPicks(many, NOW)[0].id).toBe('p0');
    expect(staffPicks([ev('a', 1)], NOW)).toEqual([]);
  });

  it('does not change the list it is given', () => {
    const events = [ev('b', 30, { source: 'staff_pick' }), ev('a', 26, { source: 'staff_pick' })];
    staffPicks(events, NOW);
    expect(events.map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('comingUpDays', () => {
  it('adds the date and count to each night heading', () => {
    // Sunday (tomorrow) x2, Tuesday x1.
    const later = groupByDay([ev('s1', 22), ev('s2', 23), ev('t1', 70)], NOW).filter(
      (s) => s.title !== 'Tonight',
    );
    const days = comingUpDays(later);
    expect(days.map((d) => [d.heading, d.countText, d.spoken])).toEqual([
      ['TOMORROW, OCT 18', '2 EVENTS', 'Tomorrow, Oct 18, 2 events'],
      ['TUESDAY, OCT 20', '1 EVENT', 'Tuesday, Oct 20, 1 event'],
    ]);
    // The list sections themselves are unchanged.
    expect(days[0].title).toBe('Tomorrow');
    expect(days[0].data.map((e) => e.id)).toEqual(['s1', 's2']);
    expect(days.every((d) => d.special === null)).toBe(true);
  });

  it('keeps a short-date title as it is (it already has its date)', () => {
    const days = comingUpDays([{ title: 'Sat, Oct 31', data: [at('x', '2026-11-01T02:00:00Z')] }]);
    expect(days[0].heading).toBe('SAT, OCT 31');
  });

  it('marks Halloween night, counting a 12:30 AM start as Halloween too', () => {
    const sections = [
      { title: 'Friday', data: [at('fri', '2026-10-31T01:00:00Z')] },
      {
        title: 'Saturday',
        // 10 PM Oct 31, then 12:30 AM Nov 1 (still Halloween night).
        data: [at('mask', '2026-11-01T02:00:00Z'), at('late', '2026-11-01T04:30:00Z')],
      },
    ];
    const days = comingUpDays(sections);
    expect(days[0].special).toBeNull();
    expect(days[1]).toMatchObject({
      heading: 'SATURDAY, OCT 31',
      countText: '2 EVENTS',
      special: 'Halloween',
      spoken: 'Saturday, Oct 31, Halloween, 2 events',
    });
  });

  it('empty input or an empty section gives no headings', () => {
    expect(comingUpDays([])).toEqual([]);
    expect(comingUpDays([{ title: 'Friday', data: [] }])).toEqual([]);
  });
});

describe('heading words', () => {
  it('says the count with the right word, and the special night when there is one', () => {
    expect(eventsText(1)).toBe('1 event');
    expect(eventsText(3)).toBe('3 events');
    expect(headingSpoken('Live now', 3, null)).toBe('Live now, 3 events');
    expect(headingSpoken('Live now', 1, 'Halloween')).toBe('Live now, Halloween, 1 event');
    expect(headingSpoken('Coming up', null, null)).toBe('Coming up');
  });
});
