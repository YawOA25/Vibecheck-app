/**
 * Tests for the rating and heads-up calls (src/lib/ratings-api.ts), task
 * VC-B08 and VC-43.
 *
 * The Supabase client is replaced with a fake. We check:
 *   - each call uses the SQL function's name and parameter names;
 *   - every server answer is read into the right result, and an unknown or
 *     malformed answer becomes a general error instead of a crash;
 *   - error codes (not allowed, not found, staff, bad input) and network
 *     trouble become the right kind and a plain message;
 *   - the heads-up list skips tags this app doesn't know;
 *   - the guest's own check-in and rating are read from their own rows.
 */
import {
  addHeadsUp,
  describeRatingError,
  getEventHeadsUps,
  getMyRatingStatus,
  parseHeadsUpList,
  parseRatingResult,
  submitRating,
} from '@/lib/ratings-api';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
const rpc = supabase.rpc as jest.Mock;
const from = supabase.from as jest.Mock;

const DRAFT = { crowd: 3, music: 2, energy: 1, reaction: 'fire', tags: ['packed'] } as const;

beforeEach(() => jest.clearAllMocks());

describe('submitRating', () => {
  it('sends the taps with the SQL parameter names and reads "saved"', async () => {
    rpc.mockResolvedValue({
      data: {
        status: 'saved',
        updated: false,
        saved_at: '2026-10-31T02:05:00Z',
        next_update_at: '2026-10-31T03:05:00Z',
        score: 8.3,
        raters: 5,
      },
      error: null,
    });
    await expect(submitRating('e1', { ...DRAFT, tags: [...DRAFT.tags] })).resolves.toEqual({
      ok: true,
      result: {
        status: 'saved',
        updated: false,
        nextUpdateAt: '2026-10-31T03:05:00Z',
        score: 8.3,
        raters: 5,
      },
    });
    expect(rpc).toHaveBeenCalledWith('submit_rating', {
      p_event_id: 'e1',
      p_crowd: 3,
      p_music: 2,
      p_energy: 1,
      p_reaction: 'fire',
      p_tags: ['packed'],
    });
  });

  it('turns the staff error into a "staff" kind with a plain message', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'VCSTF', message: 'x' } });
    await expect(submitRating('e1', { ...DRAFT, tags: [] })).resolves.toEqual({
      ok: false,
      kind: 'staff',
      message: "Admins can't rate events. Use a guest account to rate.",
    });
  });

  it('turns an unknown answer, or a thrown network error, into a failure', async () => {
    rpc.mockResolvedValueOnce({ data: { status: 'weird' }, error: null });
    await expect(submitRating('e1', { ...DRAFT, tags: [] })).resolves.toMatchObject({
      ok: false,
      kind: 'unknown',
    });
    rpc.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(submitRating('e1', { ...DRAFT, tags: [] })).resolves.toMatchObject({
      ok: false,
      kind: 'network',
    });
  });
});

describe('parseRatingResult', () => {
  it('reads too_soon (at least 1 minute) and the three refusals', () => {
    expect(
      parseRatingResult({
        status: 'too_soon',
        minutes_left: 12,
        next_update_at: '2026-10-31T03:05:00Z',
      }),
    ).toEqual({ status: 'too_soon', minutesLeft: 12, nextUpdateAt: '2026-10-31T03:05:00Z' });
    expect(
      parseRatingResult({ status: 'too_soon', minutes_left: 0, next_update_at: 'x' }),
    ).toMatchObject({ minutesLeft: 1 });
    expect(parseRatingResult({ status: 'not_checked_in' })).toEqual({ status: 'not_checked_in' });
    expect(parseRatingResult({ status: 'check_in_stale' })).toEqual({ status: 'check_in_stale' });
    expect(
      parseRatingResult({
        status: 'outside_window',
        reason: 'too_late',
        opens_at: 'a',
        closes_at: 'b',
      }),
    ).toEqual({ status: 'outside_window', reason: 'too_late', opensAt: 'a', closesAt: 'b' });
  });

  it('refuses malformed answers', () => {
    expect(parseRatingResult(null)).toBeNull();
    expect(parseRatingResult({ status: 'saved', score: '8' })).toBeNull();
    expect(parseRatingResult({ status: 'outside_window', reason: 'later' })).toBeNull();
  });
});

describe('describeRatingError', () => {
  it('maps each code to a kind', () => {
    expect(describeRatingError({ code: '42501', message: '' }).kind).toBe('notAllowed');
    expect(describeRatingError({ code: 'VCNFD', message: '' }).kind).toBe('notFound');
    // Bad input shows the server's own sentence.
    expect(describeRatingError({ code: 'VCRAT', message: 'Pick one option in each row.' })).toEqual(
      { kind: 'badInput', message: 'Pick one option in each row.' },
    );
    expect(describeRatingError({ code: 'VCTAG', message: '' }).kind).toBe('badInput');
    expect(describeRatingError({ code: 'XX000', message: 'boom' }).kind).toBe('unknown');
  });
});

describe('heads-ups', () => {
  it('addHeadsUp sends one tag and reads added / already / refusals', async () => {
    rpc.mockResolvedValueOnce({ data: { status: 'added' }, error: null });
    await expect(addHeadsUp('e1', 'lines_long')).resolves.toEqual({
      ok: true,
      result: { status: 'added' },
    });
    expect(rpc).toHaveBeenCalledWith('add_heads_up', { p_event_id: 'e1', p_tag: 'lines_long' });

    rpc.mockResolvedValueOnce({ data: { status: 'already' }, error: null });
    await expect(addHeadsUp('e1', 'lines_long')).resolves.toMatchObject({
      result: { status: 'already' },
    });
    rpc.mockResolvedValueOnce({ data: { status: 'check_in_stale' }, error: null });
    await expect(addHeadsUp('e1', 'lines_long')).resolves.toMatchObject({
      result: { status: 'check_in_stale' },
    });
  });

  it("getEventHeadsUps reads the counts in the server's order", async () => {
    rpc.mockResolvedValue({
      data: [
        { tag: 'lines_long', count: 3, mine: true },
        { tag: 'packed', count: 1, mine: false },
      ],
      error: null,
    });
    await expect(getEventHeadsUps('e1')).resolves.toEqual({
      ok: true,
      tags: [
        { tag: 'lines_long', count: 3, mine: true },
        { tag: 'packed', count: 1, mine: false },
      ],
    });
    expect(rpc).toHaveBeenCalledWith('get_event_heads_ups', { p_event_id: 'e1' });
  });

  it('parseHeadsUpList skips unknown tags, zero counts and junk', () => {
    expect(
      parseHeadsUpList([
        { tag: 'from_the_future', count: 2, mine: false },
        { tag: 'packed', count: 0, mine: false },
        null,
        { tag: 'overpriced', count: 2 },
      ]),
    ).toEqual([{ tag: 'overpriced', count: 2, mine: false }]);
    expect(parseHeadsUpList({ not: 'a list' })).toEqual([]);
  });
});

describe('getMyRatingStatus', () => {
  /**
   * Makes a fake `from(table).select(...).eq(...).maybeSingle()` chain.
   *
   * @param answer - what maybeSingle resolves to.
   * @returns the fake query builder.
   */
  /** The fake builder's shape (each step returns the builder itself). */
  interface FakeQuery {
    select: jest.Mock;
    eq: jest.Mock;
    maybeSingle: jest.Mock;
  }
  function query(answer: unknown): FakeQuery {
    const builder: FakeQuery = {
      select: jest.fn(() => builder),
      eq: jest.fn(() => builder),
      maybeSingle: jest.fn(() => Promise.resolve(answer)),
    };
    return builder;
  }

  it("reads the guest's own check-in and rating for the event", async () => {
    const checkIns = query({
      data: { method: 'code', last_verified_at: '2026-10-31T02:00:00Z' },
      error: null,
    });
    const ratings = query({ data: { updated_at: '2026-10-31T02:10:00Z' }, error: null });
    from.mockImplementation((table: string) => (table === 'check_ins' ? checkIns : ratings));

    await expect(getMyRatingStatus('e1')).resolves.toEqual({
      ok: true,
      status: {
        checkIn: { method: 'code', lastVerifiedAt: '2026-10-31T02:00:00Z' },
        ratedAt: '2026-10-31T02:10:00Z',
      },
    });
    expect(checkIns.eq).toHaveBeenCalledWith('event_id', 'e1');
    expect(ratings.eq).toHaveBeenCalledWith('event_id', 'e1');
  });

  it('gives nulls when there is no check-in or rating, and a message on failure', async () => {
    from.mockImplementation(() => query({ data: null, error: null }));
    await expect(getMyRatingStatus('e1')).resolves.toEqual({
      ok: true,
      status: { checkIn: null, ratedAt: null },
    });

    from.mockImplementation(() => query({ data: null, error: { code: 'XX000', message: 'x' } }));
    await expect(getMyRatingStatus('e1')).resolves.toEqual({
      ok: false,
      kind: 'unknown',
      message: "We couldn't load your check-in. Please try again.",
    });
  });
});
