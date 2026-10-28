/**
 * Tests for the vibe words and the answer checker (src/lib/vibe.ts), task
 * VC-B09 and the VC-42 headcount.
 *
 * Plain functions, no screens. We check:
 *   - parseVibe reads each state, prefers the server's word, falls back to
 *     the app's own rule, never lets a number through before 5 ratings, and
 *     refuses broken answers (unknown state, "live" without a score);
 *   - the wording: "Early reading: 3 people so far", "1 person", "updated 4
 *     min ago", "Quiet for 2 hrs" (the night average moved to the All night
 *     view, VC-54), "74 here" / "74 were here", the reaction line and what
 *     screen readers hear;
 *   - VC-53/54: the tile words and the All night view are read only next to
 *     a score, unknown words drop the whole row, and their wording.
 */
import {
  NIGHT_WITHHELD_BODY,
  agoText,
  breakdownSpoken,
  breakdownTiles,
  cardVibeSpoken,
  formatScore,
  hereText,
  meterSpoken,
  nightAsVibe,
  nightDetail,
  parseVibe,
  quietForText,
  reactionLine,
  vibeDetail,
} from '@/lib/vibe';
import type { Vibe } from '@/lib/vibe';

/** A full "live" answer as the server sends it. */
const LIVE_JSON = {
  state: 'live',
  raters: 5,
  here: 74,
  score: 8,
  label: 'Hot',
  // Not sent while live by the server any more (privacy); if it ever is,
  // the app must ignore it.
  night_average: 7.4,
  minutes_since_last: 4,
  reactions: [
    { reaction: 'fire', count: 3 },
    { reaction: 'dancing', count: 1 },
  ],
};

/**
 * Makes a vibe for the wording tests.
 *
 * @param overrides - fields to change from a live 8.0 Hot vibe.
 * @returns a Vibe.
 */
function vibe(overrides: Partial<Vibe> = {}): Vibe {
  return {
    state: 'live',
    raters: 5,
    here: 74,
    score: 8,
    label: 'Hot',
    nightAverage: null,
    minutesSinceLast: 4,
    reactions: [],
    breakdown: null,
    night: null,
    ...overrides,
  };
}

describe('parseVibe', () => {
  it('reads a live answer', () => {
    expect(parseVibe(LIVE_JSON)).toEqual({
      state: 'live',
      raters: 5,
      here: 74,
      score: 8,
      label: 'Hot',
      // Ignored while live: the night average is for the quiet state only.
      nightAverage: null,
      minutesSinceLast: 4,
      reactions: [
        { reaction: 'fire', count: 3 },
        { reaction: 'dancing', count: 1 },
      ],
      // Not sent in this answer: no tiles, no night view.
      breakdown: null,
      night: null,
    });
  });

  it('never reads a night average, even if one is sent (no night number, cto)', () => {
    expect(
      parseVibe({ ...LIVE_JSON, state: 'stale', minutes_since_last: 95 })?.nightAverage,
    ).toBeNull();
  });

  it('reads none and early answers without a number', () => {
    expect(
      parseVibe({ state: 'none', raters: 0, here: 0, score: null, reactions: [] }),
    ).toMatchObject({ state: 'none', raters: 0, score: null, label: null });
    expect(parseVibe({ state: 'early', raters: 3, here: 7, minutes_since_last: 1 })).toMatchObject({
      state: 'early',
      raters: 3,
      here: 7,
      score: null,
      label: null,
      nightAverage: null,
    });
  });

  it('never lets a number through before 5 ratings, even if one is sent', () => {
    const parsed = parseVibe({ state: 'early', raters: 2, score: 9.5, label: 'Fire' });
    expect(parsed?.score).toBeNull();
    expect(parsed?.label).toBeNull();
  });

  it("falls back to the app's own word when the server's is missing or unknown", () => {
    expect(parseVibe({ ...LIVE_JSON, score: 8.5, label: undefined })?.label).toBe('Fire');
    expect(parseVibe({ ...LIVE_JSON, score: 3.9, label: 'Lit' })?.label).toBe('Quiet');
  });

  it('refuses broken answers', () => {
    expect(parseVibe(null)).toBeNull();
    expect(parseVibe('live')).toBeNull();
    expect(parseVibe({ ...LIVE_JSON, state: 'buzzing' })).toBeNull();
    expect(parseVibe({ ...LIVE_JSON, score: null })).toBeNull();
    expect(parseVibe({ ...LIVE_JSON, score: 11 })).toBeNull();
    expect(parseVibe({ ...LIVE_JSON, raters: -1 })).toBeNull();
  });

  it('skips unknown or empty reactions, and treats a missing headcount as 0', () => {
    const parsed = parseVibe({
      ...LIVE_JSON,
      here: undefined,
      reactions: [{ reaction: 'confetti', count: 2 }, { reaction: 'chill', count: 0 }, null],
    });
    expect(parsed?.reactions).toEqual([]);
    expect(parsed?.here).toBe(0);
  });
});

describe('vibe words', () => {
  it('writes scores with 1 decimal', () => {
    expect(formatScore(8)).toBe('8.0');
    expect(formatScore(9.1)).toBe('9.1');
  });

  it('says how long ago, and how long it has been quiet', () => {
    expect(agoText(0)).toBe('just now');
    expect(agoText(1)).toBe('1 min ago');
    expect(agoText(59)).toBe('59 min ago');
    expect(agoText(61)).toBe('1 hr ago');
    expect(quietForText(90)).toBe('90 min');
    expect(quietForText(119)).toBe('119 min');
    expect(quietForText(120)).toBe('2 hrs');
    expect(quietForText(200)).toBe('3 hrs');
  });

  it('writes the headcount (VC-42), and nothing when nobody is here', () => {
    expect(hereText(74, false)).toBe('74 here');
    expect(hereText(74, true)).toBe('74 were here');
    expect(hereText(0, false)).toBeNull();
  });

  it('writes the line under the meter for each state', () => {
    expect(vibeDetail(vibe({ state: 'none', raters: 0, score: null, label: null }))).toBe(
      'No vibe yet. Be the first.',
    );
    expect(vibeDetail(vibe({ state: 'early', raters: 3, score: null, label: null }))).toBe(
      'Early reading: 3 people so far',
    );
    expect(vibeDetail(vibe({ state: 'early', raters: 1, score: null, label: null }))).toBe(
      'Early reading: 1 person so far',
    );
    expect(vibeDetail(vibe())).toBe('5 people · updated 4 min ago');
    // The night average isn't on this line any more (it's the All night view).
    expect(vibeDetail(vibe({ state: 'stale', minutesSinceLast: 130, nightAverage: 7.4 }))).toBe(
      'Quiet for 2 hrs',
    );
  });

  it('writes the reaction line with words for screen readers', () => {
    expect(
      reactionLine([
        { reaction: 'fire', count: 3 },
        { reaction: 'too_loud', count: 1 },
      ]),
    ).toEqual({ text: '🔥 3 · 🔊 1', spoken: 'Reactions: Fire 3, Too loud 1' });
    expect(reactionLine([])).toBeNull();
  });

  it('says the meter aloud for each state', () => {
    expect(meterSpoken(vibe())).toBe('Vibe 8.0 out of 10, Hot');
    expect(meterSpoken(vibe({ state: 'stale' }))).toBe('Last vibe 8.0 out of 10, Hot');
    expect(meterSpoken(vibe({ state: 'early', score: null, label: null }))).toBe(
      'Early reading, no score yet',
    );
    expect(meterSpoken(vibe({ state: 'none', score: null, label: null }))).toBe('No vibe yet');
  });

  it('says a card vibe aloud for each state', () => {
    expect(cardVibeSpoken(vibe())).toBe('vibe 8.0 out of 10, Hot');
    expect(cardVibeSpoken(vibe({ state: 'stale', minutesSinceLast: 95 }))).toBe(
      'vibe quiet for 95 min, last 8.0, Hot',
    );
    expect(cardVibeSpoken(vibe({ state: 'early', raters: 3, score: null, label: null }))).toBe(
      'Early reading, 3 so far',
    );
    expect(cardVibeSpoken(vibe({ state: 'none', raters: 0, score: null, label: null }))).toBe(
      'no vibe yet',
    );
  });
});

describe('published snapshots (VC-51) and the 3-hour headcount (VC-55)', () => {
  // Before the first snapshot an event says "none" even if one person has
  // rated (the server waits for a second rater), but the headcount is live.
  it('a "none" answer still carries the live headcount', () => {
    const vibe = parseVibe({
      state: 'none',
      raters: 0,
      here: 12,
      score: null,
      label: null,
      night_average: null,
      minutes_since_last: null,
      reactions: [],
    });
    expect(vibe).not.toBeNull();
    expect(vibe!.score).toBeNull();
    expect(hereText(vibe!.here, false)).toBe('12 here');
    expect(vibeDetail(vibe!)).toBe('No vibe yet. Be the first.');
  });

  // The first snapshot comes with 2 raters: early, no number, and the
  // minutes count from the newest rating in it.
  it('the first published snapshot (2 raters) is an early reading without a number', () => {
    const vibe = parseVibe({
      state: 'early',
      raters: 2,
      here: 12,
      score: 9.5,
      label: 'Fire',
      night_average: 9.5,
      minutes_since_last: 3,
      reactions: [{ reaction: 'fire', count: 2 }],
    });
    expect(vibe).toMatchObject({ state: 'early', raters: 2, score: null, label: null });
    expect(vibe!.nightAverage).toBeNull();
    expect(vibeDetail(vibe!)).toBe('Early reading: 2 people so far');
  });

  it('after the end the same count reads "were here"', () => {
    expect(hereText(40, true)).toBe('40 were here');
  });
});

describe('tiles (VC-53) and the All night view (VC-54)', () => {
  const NIGHT_JSON = {
    label: 'Hot',
    raters: 112,
    breakdown: { crowd: 'good', music: 'fire', energy: 'good' },
    over: false,
  };

  it('reads the tile words and the night view next to a score', () => {
    const parsed = parseVibe({
      ...LIVE_JSON,
      breakdown: { crowd: 'packed', music: 'meh', energy: 'low' },
      night: NIGHT_JSON,
    });
    expect(parsed?.breakdown).toEqual({ crowd: 'packed', music: 'meh', energy: 'low' });
    expect(parsed?.night).toEqual(NIGHT_JSON);
  });

  it('ignores tiles and the night view in early and none (no score, no tiles)', () => {
    const parsed = parseVibe({
      state: 'early',
      raters: 4,
      breakdown: { crowd: 'packed', music: 'fire', energy: 'fire' },
      night: NIGHT_JSON,
    });
    expect(parsed?.breakdown).toBeNull();
    expect(parsed?.night).toBeNull();
  });

  it('drops the whole tile row if any word is unknown or a number', () => {
    expect(
      parseVibe({ ...LIVE_JSON, breakdown: { crowd: 'packed', music: 'loud', energy: 'low' } })
        ?.breakdown,
    ).toBeNull();
    expect(
      parseVibe({ ...LIVE_JSON, breakdown: { crowd: 2.6, music: 'fire', energy: 'low' } })
        ?.breakdown,
    ).toBeNull();
  });

  it('never reads a night number, even if a server sent one', () => {
    const parsed = parseVibe({ ...LIVE_JSON, night: { ...NIGHT_JSON, score: 7.4 } });
    expect(parsed?.night).toEqual(NIGHT_JSON);
    expect(parsed?.night).not.toHaveProperty('score');
  });

  it('a withheld night word comes with no night tiles', () => {
    const parsed = parseVibe({
      ...LIVE_JSON,
      night: { ...NIGHT_JSON, label: null },
    });
    expect(parsed?.night).toEqual({
      label: null,
      raters: 112,
      breakdown: null,
      over: false,
    });
  });

  it('words the tiles, the night line and the night meter', () => {
    const tiles = { crowd: 'packed', music: 'fire', energy: 'good' } as const;
    expect(breakdownTiles(tiles)).toEqual([
      { label: 'CROWD', word: 'Packed' },
      { label: 'MUSIC', word: 'Fire' },
      { label: 'ENERGY', word: 'Good' },
    ]);
    expect(breakdownSpoken(tiles, false)).toBe('Crowd Packed, Music Fire, Energy Good');
    expect(breakdownSpoken(tiles, true)).toBe(
      'Last reading: Crowd Packed, Music Fire, Energy Good',
    );

    const night = {
      ...NIGHT_JSON,
      label: 'Hot' as const,
      breakdown: { crowd: 'good', music: 'fire', energy: 'good' } as const,
    };
    expect(nightDetail(night)).toBe('112 ratings tonight');
    expect(nightDetail({ ...night, raters: 1 })).toBe('1 rating tonight');
    expect(nightDetail({ ...night, label: null })).toBe(NIGHT_WITHHELD_BODY);
    expect(NIGHT_WITHHELD_BODY).toBe('The night vibe will show a little later.');

    // The night as the gauge draws it: the word, and never a number.
    const shown = nightAsVibe(vibe({ state: 'stale' }), night);
    expect(shown).toMatchObject({ state: 'live', score: null, label: 'Hot', raters: 112 });
    expect(meterSpoken(shown, 'night')).toBe('All night vibe: Hot');
    const hidden = nightAsVibe(vibe(), { ...night, label: null });
    expect(hidden.state).toBe('none');
    expect(meterSpoken(hidden, 'night')).toBe('No vibe yet');
  });
});
