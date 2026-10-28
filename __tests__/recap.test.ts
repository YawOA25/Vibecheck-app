/**
 * Tests for src/lib/recap.ts, the next-morning recap rules (VC-B12).
 *
 * The most important part is WHEN the 11 AM note fires: always 11:00 New
 * York time the morning after the night, including ratings after midnight,
 * across daylight-saving changes and the new year. The whole Jest run uses
 * the phone zone Asia/Tokyo (jest.global-setup.js), so these tests also prove
 * the phone's own zone doesn't change the answer.
 *
 * It also checks the privacy side of the app: the parser reads the room's
 * vibe only through the event page's own rules, the notification text never
 * holds a score, and the room's night is a word, never a number.
 */
import {
  morningKey,
  parseRecap,
  recapDateLine,
  recapMorning,
  recapNotificationText,
  roomSummary,
  rowWord,
  topReaction,
} from '@/lib/recap';
import { parseVibe } from '@/lib/vibe';
import type { Vibe } from '@/lib/vibe';

/** A published vibe like the server sends, with changes on top. */
function vibeJson(over: Record<string, unknown> = {}) {
  return {
    state: 'stale',
    raters: 12,
    here: 0,
    score: 8.7,
    label: 'Hot',
    night_average: null,
    minutes_since_last: 600,
    reactions: [
      { reaction: 'dancing', count: 5 },
      { reaction: 'fire', count: 2 },
    ],
    breakdown: { crowd: 'packed', music: 'fire', energy: 'good' },
    night: {
      label: 'Hot',
      raters: 12,
      over: true,
      breakdown: { crowd: 'packed', music: 'fire', energy: 'good' },
    },
    ...over,
  };
}

/** One recap item like the server sends, with changes on top. */
function itemJson(over: Record<string, unknown> = {}) {
  return {
    event_id: 'e1',
    title: 'Rooftop Sundown',
    area_label: 'Navy Yard',
    starts_at: '2026-10-17T22:00:00-04:00',
    ends_at: '2026-10-18T03:00:00-04:00',
    rated_at: '2026-10-17T23:30:00-04:00',
    mine: { crowd: 3, music: 3, energy: 3, reaction: 'fire', label: 'Fire' },
    vibe: vibeJson(),
    ...over,
  };
}

/** Parses a vibe for the helpers, failing the test if it doesn't parse. */
function vibe(over: Record<string, unknown> = {}): Vibe {
  const parsed = parseVibe(vibeJson(over));
  if (!parsed) throw new Error('test vibe did not parse');
  return parsed;
}

describe('recapMorning: 11 AM New York, the morning after the night', () => {
  it('11 PM Saturday -> 11 AM Sunday', () => {
    expect(recapMorning(new Date('2026-10-17T23:00:00-04:00')).toISOString()).toBe(
      '2026-10-18T15:00:00.000Z',
    );
  });

  it('across midnight: 1 AM Sunday is still Saturday night -> 11 AM the same Sunday', () => {
    expect(recapMorning(new Date('2026-10-18T01:00:00-04:00')).toISOString()).toBe(
      '2026-10-18T15:00:00.000Z',
    );
  });

  it('4:59 AM still belongs to the night before; 5:00 AM starts a new day', () => {
    expect(recapMorning(new Date('2026-10-18T04:59:00-04:00')).toISOString()).toBe(
      '2026-10-18T15:00:00.000Z',
    );
    expect(recapMorning(new Date('2026-10-18T05:00:00-04:00')).toISOString()).toBe(
      '2026-10-19T15:00:00.000Z',
    );
  });

  it('a daytime rating (6 PM Sunday) -> 11 AM Monday', () => {
    expect(recapMorning(new Date('2026-10-18T18:00:00-04:00')).toISOString()).toBe(
      '2026-10-19T15:00:00.000Z',
    );
  });

  it('clocks go back (Nov 1 2026): 11 PM EDT Saturday -> 11 AM EST Sunday (16:00 UTC)', () => {
    expect(recapMorning(new Date('2026-10-31T23:00:00-04:00')).toISOString()).toBe(
      '2026-11-01T16:00:00.000Z',
    );
  });

  it('clocks go forward (Mar 14 2027): 11 PM EST Saturday -> 11 AM EDT Sunday (15:00 UTC)', () => {
    expect(recapMorning(new Date('2027-03-13T23:00:00-05:00')).toISOString()).toBe(
      '2027-03-14T15:00:00.000Z',
    );
  });

  it("new year: midnight-thirty on Jan 1 belongs to New Year's Eve -> 11 AM Jan 1", () => {
    expect(recapMorning(new Date('2027-01-01T00:30:00-05:00')).toISOString()).toBe(
      '2027-01-01T16:00:00.000Z',
    );
  });

  it("uses New York time, not the phone's zone (the run is in Tokyo, where it is already Sunday noon)", () => {
    // 11 PM Saturday New York is 12:00 Sunday in Tokyo; a phone-zone rule
    // would wrongly pick Monday 11 AM Tokyo.
    expect(recapMorning(new Date('2026-10-18T03:00:00Z')).toISOString()).toBe(
      '2026-10-18T15:00:00.000Z',
    );
  });

  it('is always 6 to 31 hours ahead (31 on the autumn clock change): inside the 36-hour window', () => {
    // Four days that include the 1 Nov 2026 clock change.
    const start = Date.parse('2026-10-30T00:00:00Z');
    for (let m = 0; m < 4 * 24 * 60; m += 7) {
      const at = new Date(start + m * 60_000);
      const ahead = (recapMorning(at).getTime() - at.getTime()) / 3_600_000;
      expect(ahead).toBeGreaterThan(5.99);
      expect(ahead).toBeLessThanOrEqual(31.01);
    }
  });
});

describe('morningKey', () => {
  it('names the New York date of the morning, so one night gives one note', () => {
    const a = recapMorning(new Date('2026-10-17T22:00:00-04:00'));
    const b = recapMorning(new Date('2026-10-18T02:00:00-04:00'));
    expect(morningKey(a)).toBe('2026-10-18');
    expect(morningKey(b)).toBe('2026-10-18');
  });
});

describe('recapNotificationText', () => {
  it('names the event and never a score (it shows on the lock screen)', () => {
    const text = recapNotificationText(['Rooftop Sundown']);
    expect(text.body).toBe('Your night at Rooftop Sundown is ready.');
    expect(`${text.title} ${text.body}`).not.toMatch(/\d|Fire|Hot|Quiet/);
  });

  it('two events the same night: one note naming the first and "+ 1 more"', () => {
    expect(recapNotificationText(['A', 'B']).body).toBe('Your night at A + 1 more is ready.');
  });
});

describe('parseRecap', () => {
  it('reads an item: the event, your own rating and the published vibe', () => {
    const items = parseRecap([itemJson()]);
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({
      eventId: 'e1',
      title: 'Rooftop Sundown',
      areaLabel: 'Navy Yard',
      mine: { crowd: 3, music: 3, energy: 3, reaction: 'fire', label: 'Fire' },
    });
    expect(items?.[0].vibe.night?.label).toBe('Hot');
  });

  it('skips items that look wrong, and refuses a non-list answer', () => {
    const bad = [
      itemJson({ mine: { crowd: 4, music: 3, energy: 3, label: 'Fire' } }),
      itemJson({ vibe: { state: 'live' } }),
      itemJson({ event_id: 7 }),
      null,
    ];
    expect(parseRecap(bad)).toEqual([]);
    expect(parseRecap({ items: [] })).toBeNull();
  });

  it('an unknown reaction counts as none', () => {
    const items = parseRecap([
      itemJson({ mine: { crowd: 1, music: 1, energy: 1, reaction: 'party', label: 'Quiet' } }),
    ]);
    expect(items?.[0].mine.reaction).toBeNull();
  });

  it('privacy: an early snapshot keeps no number even if one were sent', () => {
    const items = parseRecap([
      itemJson({ vibe: vibeJson({ state: 'early', raters: 3, score: 6.1, night: null }) }),
    ]);
    expect(items?.[0].vibe.score).toBeNull();
  });

  it('privacy: a night number is never read, even if one were sent', () => {
    const items = parseRecap([
      itemJson({ vibe: vibeJson({ night: { label: 'Hot', raters: 12, over: true, score: 7.4 } }) }),
    ]);
    expect(JSON.stringify(items?.[0].vibe.night)).not.toContain('7.4');
  });
});

describe('roomSummary and topReaction', () => {
  it('live night: the word, the count, and the last published score', () => {
    expect(roomSummary(vibe())).toEqual({
      word: 'Hot',
      detail: '12 ratings all night',
      lastScore: '8.7',
    });
  });

  it('early: no word and no number', () => {
    expect(
      roomSummary(vibe({ state: 'early', raters: 3, score: null, label: null, night: null })),
    ).toEqual({ word: null, detail: "Only 3 people rated, so there's no score.", lastScore: null });
  });

  it('night word withheld: no word, says so', () => {
    const summary = roomSummary(vibe({ night: { label: null, raters: 6, over: true } }));
    expect(summary.word).toBeNull();
    expect(summary.detail).toBe("The night's word isn't ready for this one.");
  });

  it('nothing published: no word, no number', () => {
    expect(
      roomSummary(vibe({ state: 'none', raters: 0, score: null, label: null, night: null })),
    ).toEqual({ word: null, detail: 'Not enough ratings for a score.', lastScore: null });
  });

  it('top reaction is the first of the published tally; none without a tally', () => {
    expect(topReaction(vibe().reactions)).toEqual({ emoji: '💃', word: 'Dancing', count: 5 });
    expect(topReaction([])).toBeNull();
  });
});

describe('small text helpers', () => {
  it("rowWord uses the rating screen's words", () => {
    expect(rowWord('crowd', 3)).toBe('Packed');
    expect(rowWord('music', 1)).toBe('Meh');
    expect(rowWord('energy', 2)).toBe('Good');
  });

  it('recapDateLine names the night (1 AM Sunday is Saturday) and the area', () => {
    expect(recapDateLine({ startsAt: '2026-10-18T01:00:00-04:00', areaLabel: 'Shaw, DC' })).toBe(
      'Sat, Oct 17 · Shaw, DC',
    );
  });
});
