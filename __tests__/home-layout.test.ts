/**
 * Tests for the VC-80 home layout rules (src/lib/home-layout.ts): which
 * tonight event becomes the hero, the order of the others, the tonight
 * shape for 0 / 1 / 2 / 3+ events, the labels, and the countdown words.
 *
 * Every test pins the clock: Saturday 17 Oct 2026, 10 PM New York (EDT),
 * far from any daylight-saving change. Times below are New York times.
 */
import {
  LIVE_NOW_LABEL,
  NEXT_UP_LABEL,
  ON_FIRE_LABEL,
  ON_NOW_LABEL,
  TONIGHT_LABEL,
  hasLiveScore,
  heroLabel,
  homeLayout,
  nothingTonightText,
  orderTonight,
  pickHero,
  startsIn,
  tonightShape,
} from '@/lib/home-layout';
import { groupByDay } from '@/lib/tonight';
import type { PublicEvent } from '@/lib/tonight';
import type { Vibe } from '@/lib/vibe';

/** 10 PM New York on Saturday 17 Oct 2026. */
const NOW = new Date('2026-10-18T02:00:00Z');
const HOUR = 60 * 60 * 1000;

/**
 * Makes an event starting `startsInHours` from NOW, lasting 4 hours.
 *
 * @param id - its id (also used as the title).
 * @param startsInHours - hours from NOW to the start (negative: started).
 * @param lastsHours - how long it lasts (default 4).
 * @returns a PublicEvent.
 */
function ev(id: string, startsInHours: number, lastsHours = 4): PublicEvent {
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
  };
}

/**
 * Makes a published vibe.
 *
 * @param overrides - fields to change from a live 7.0 "Hot" with 10 here.
 * @returns a Vibe.
 */
function vibe(overrides: Partial<Vibe> = {}): Vibe {
  return {
    state: 'live',
    raters: 8,
    here: 10,
    score: 7,
    label: 'Hot',
    nightAverage: null,
    minutesSinceLast: 3,
    reactions: [],
    breakdown: null,
    night: null,
    ...overrides,
  };
}

describe('hasLiveScore', () => {
  it('is true only for an event on now with a live published score', () => {
    expect(hasLiveScore(ev('a', -1), vibe(), NOW)).toBe(true);
    // Stale, early and none never count; neither does no vibe at all.
    expect(hasLiveScore(ev('a', -1), vibe({ state: 'stale' }), NOW)).toBe(false);
    expect(hasLiveScore(ev('a', -1), vibe({ state: 'early', score: null }), NOW)).toBe(false);
    expect(hasLiveScore(ev('a', -1), undefined, NOW)).toBe(false);
  });

  it('never counts an event that has not started or has ended, whatever the vibe says', () => {
    expect(hasLiveScore(ev('a', 1), vibe(), NOW)).toBe(false);
    // Started 5 hours ago, lasted 4: over.
    expect(hasLiveScore(ev('a', -5), vibe(), NOW)).toBe(false);
  });
});

describe('orderTonight', () => {
  it('puts live scores first (highest first), then on now, then upcoming by start', () => {
    const events = [
      ev('up-late', 2),
      ev('on-plain', -1),
      ev('live-7', -2),
      ev('up-soon', 1),
      ev('live-9', -1),
    ];
    const vibes = {
      'live-7': vibe({ score: 7 }),
      'live-9': vibe({ score: 9.1, label: 'Fire' }),
      'on-plain': vibe({ state: 'early', score: null, label: null }),
    };
    expect(orderTonight(events, vibes, NOW).map((e) => e.id)).toEqual([
      'live-9',
      'live-7',
      'on-plain',
      'up-soon',
      'up-late',
    ]);
  });

  it('breaks a score tie by most people here, then by start time and id', () => {
    const events = [ev('b', -1), ev('a', -1), ev('c', -2)];
    const vibes = {
      a: vibe({ score: 8, here: 20 }),
      b: vibe({ score: 8, here: 20 }),
      c: vibe({ score: 8, here: 50 }),
    };
    expect(orderTonight(events, vibes, NOW).map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('puts an event that already ended last, and does not change the input', () => {
    const events = [ev('ended', -5), ev('soon', 1)];
    const copy = [...events];
    expect(orderTonight(events, {}, NOW).map((e) => e.id)).toEqual(['soon', 'ended']);
    expect(events).toEqual(copy);
  });

  it('ignores a vibe sent for an event that has not started', () => {
    const events = [ev('live', -1), ev('later', 1)];
    const vibes = { live: vibe({ score: 5, label: 'Good' }), later: vibe({ score: 9.9 }) };
    expect(orderTonight(events, vibes, NOW).map((e) => e.id)).toEqual(['live', 'later']);
  });
});

describe('pickHero', () => {
  it('picks the live event with the highest live score', () => {
    const events = [ev('a', -1), ev('b', -2), ev('c', 1)];
    const vibes = { a: vibe({ score: 6.5 }), b: vibe({ score: 9.1, label: 'Fire' }) };
    expect(pickHero(events, vibes, NOW)).toEqual({ event: events[1], kind: 'live' });
  });

  it('with no live score: "Next up", the soonest event still to start', () => {
    // b is on now but only Early; c starts sooner than d.
    const events = [ev('b', -1), ev('d', 3), ev('c', 1)];
    const vibes = { b: vibe({ state: 'early', score: null, label: null }) };
    expect(pickHero(events, vibes, NOW)).toEqual({ event: events[2], kind: 'next' });
  });

  it('a stale score is not live: Next up wins', () => {
    const events = [ev('a', -1), ev('b', 2)];
    const vibes = { a: vibe({ state: 'stale', score: 8 }) };
    expect(pickHero(events, vibes, NOW)?.kind).toBe('next');
  });

  it('nothing live and nothing to come: the first event on now', () => {
    const events = [ev('a', -1), ev('b', -2)];
    expect(pickHero(events, {}, NOW)).toEqual({ event: events[1], kind: 'onNow' });
  });

  it('only ended events left: a plain "tonight" pick; and null for no events', () => {
    expect(pickHero([ev('a', -6)], {}, NOW)?.kind).toBe('tonight');
    expect(pickHero([], {}, NOW)).toBeNull();
  });
});

describe('homeLayout and tonightShape', () => {
  it('has the right shape for 0, 1, 2 and 3 or more tonight events', () => {
    expect(tonightShape(0)).toBe('none');
    expect(tonightShape(1)).toBe('hero');
    expect(tonightShape(2)).toBe('pair');
    expect(tonightShape(3)).toBe('carousel');
    expect(tonightShape(12)).toBe('carousel');
  });

  it('splits tonight (hero + ordered others) from the later nights', () => {
    const events = [ev('t1', -1), ev('t2', 1), ev('t3', -2), ev('tomorrow', 24), ev('monday', 48)];
    const vibes = {
      t1: vibe({ score: 9.1, label: 'Fire' }),
      t3: vibe({ score: 4, label: 'Good' }),
    };
    const layout = homeLayout(groupByDay(events, NOW), vibes, NOW);
    expect(layout.hero?.event.id).toBe('t1');
    expect(layout.others.map((e) => e.id)).toEqual(['t3', 't2']);
    expect(layout.shape).toBe('carousel');
    expect(layout.later.map((s) => s.title)).toEqual(['Tomorrow', 'Monday']);
  });

  it('with nothing tonight: no hero, no others, and every night stays in the later list', () => {
    const layout = homeLayout(groupByDay([ev('tomorrow', 24)], NOW), {}, NOW);
    expect(layout).toEqual({
      hero: null,
      others: [],
      later: [{ title: 'Tomorrow', data: [expect.objectContaining({ id: 'tomorrow' })] }],
      shape: 'none',
    });
  });

  it('with no events at all: empty', () => {
    expect(homeLayout([], {}, NOW)).toEqual({ hero: null, others: [], later: [], shape: 'none' });
  });
});

describe('labels', () => {
  const pick = { event: ev('a', -1), kind: 'live' as const };

  it('says "on fire" only for a live Hot or Fire word', () => {
    expect(heroLabel(pick, vibe({ label: 'Fire' }))).toBe(ON_FIRE_LABEL);
    expect(heroLabel(pick, vibe({ label: 'Hot' }))).toBe(ON_FIRE_LABEL);
    expect(heroLabel(pick, vibe({ label: 'Good' }))).toBe(LIVE_NOW_LABEL);
    expect(heroLabel(pick, vibe({ label: 'Quiet' }))).toBe(LIVE_NOW_LABEL);
  });

  it('has a label for Next up, On now and Tonight', () => {
    expect(heroLabel({ ...pick, kind: 'next' }, undefined)).toBe(NEXT_UP_LABEL);
    expect(heroLabel({ ...pick, kind: 'onNow' }, undefined)).toBe(ON_NOW_LABEL);
    expect(heroLabel({ ...pick, kind: 'tonight' }, undefined)).toBe(TONIGHT_LABEL);
  });

  it('words the nothing-tonight note', () => {
    expect(nothingTonightText('week')).toEqual({
      title: 'Nothing on tonight yet',
      body: "Here's what's coming up this week.",
    });
    expect(nothingTonightText('weekend').body).toBe("Here's what's coming up this weekend.");
    expect(nothingTonightText('custom').body).toBe("Here's what's coming up next.");
  });
});

describe('startsIn', () => {
  it('says minutes, hours, or hours and minutes, rounding minutes up', () => {
    expect(startsIn(ev('a', 20 / 60), NOW)).toBe('in 20 min');
    expect(startsIn(ev('a', 2), NOW)).toBe('in 2 h');
    expect(startsIn(ev('a', 1 + 20 / 60), NOW)).toBe('in 1 h 20 min');
    // 30 seconds away still reads "in 1 min", never "in 0 min".
    expect(startsIn(ev('a', 0.5 / 60), NOW)).toBe('in 1 min');
  });

  it('is empty once the event has started', () => {
    expect(startsIn(ev('a', 0), NOW)).toBe('');
    expect(startsIn(ev('a', -1), NOW)).toBe('');
  });
});
