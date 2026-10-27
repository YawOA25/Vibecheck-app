/**
 * Tests for the vibe words and the answer checker (src/lib/vibe.ts), task
 * VC-B09 and the VC-42 headcount.
 *
 * Plain functions, no screens. We check:
 *   - parseVibe reads each state, prefers the server's word, falls back to
 *     the app's own rule, never lets a number through before 5 ratings, and
 *     refuses broken answers (unknown state, "live" without a score);
 *   - the wording: "Early reading: 3 people so far", "1 person", "updated 4
 *     min ago", "Quiet for 2 hrs · night average 7.4", "74 here" / "74 were
 *     here", the reaction line and what screen readers hear.
 */
import {
  agoText,
  cardVibeSpoken,
  formatScore,
  hereText,
  meterSpoken,
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
    });
  });

  it('reads the night average only in the stale state', () => {
    expect(parseVibe({ ...LIVE_JSON, state: 'stale', minutes_since_last: 95 })?.nightAverage).toBe(
      7.4,
    );
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
    expect(vibeDetail(vibe({ state: 'stale', minutesSinceLast: 130, nightAverage: 7.4 }))).toBe(
      'Quiet for 2 hrs · night average 7.4',
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
