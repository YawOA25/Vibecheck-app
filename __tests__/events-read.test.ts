/**
 * Tests for the public event reads (src/lib/events-read.ts), VC-B05, with
 * the week view (VC-61) and the date filter (VC-63).
 *
 * Supabase is replaced with a fake "query builder" that records each step
 * (from, select, gt, gte, lt, order, limit, eq, maybeSingle). We check:
 *   - the list asks only for public columns (no location can be requested);
 *   - the list filters to "not over yet" and "starts before the morning
 *     after the 7th night", soonest first; a filter that starts on a later
 *     night (next weekend) also asks for "starts from that night";
 *   - paging (VC-66): pages of 100 ordered by start time then id; a 101st
 *     row only means "more follow"; a later page asks for events after the
 *     last one shown, with the same date window;
 *   - errors become plain sentences;
 *   - one event by id: found, not found, and a broken id (treated as not found).
 */
import {
  afterCursorFilter,
  getEvent,
  listHomeEvents,
  PAGE_SIZE,
  PUBLIC_EVENT_COLUMNS,
} from '@/lib/events-read';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: { from: jest.fn() } }));

const from = supabase.from as unknown as jest.Mock;

/**
 * Builds a fake query that returns `result` when awaited, and records every
 * step called on it in `calls`.
 *
 * @param result - what the query finally answers ({ data, error }).
 * @returns the fake query and the list of recorded calls.
 */
function fakeQuery(result: { data: unknown; error: unknown }) {
  const calls: [string, unknown[]][] = [];
  const query: Record<string, unknown> = {};
  for (const step of ['select', 'gt', 'gte', 'lt', 'or', 'order', 'limit', 'eq']) {
    query[step] = (...args: unknown[]) => {
      calls.push([step, args]);
      return query;
    };
  }
  query.maybeSingle = () => {
    calls.push(['maybeSingle', []]);
    return Promise.resolve(result);
  };
  // `await query` calls `then`: this makes the fake behave like a promise.
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return { query, calls };
}

beforeEach(() => jest.clearAllMocks());

describe('PUBLIC_EVENT_COLUMNS', () => {
  it('names only public facts, never a location or the party code', () => {
    expect(PUBLIC_EVENT_COLUMNS).not.toMatch(/lat|lng|radius|code|address|\*/);
  });
});

describe('listHomeEvents', () => {
  it('reads public columns for events not yet over, starting within the week', async () => {
    const { query, calls } = fakeQuery({ data: [{ id: 'e1' }], error: null });
    from.mockReturnValue(query);
    // Saturday 31 Oct 2026, 8 PM New York (EDT) = 1 Nov 00:00 UTC.
    const now = new Date('2026-11-01T00:00:00Z');

    const outcome = await listHomeEvents(now);

    expect(outcome).toEqual({ ok: true, events: [{ id: 'e1' }], hasMore: false });
    expect(from).toHaveBeenCalledWith('events');
    expect(calls).toEqual([
      ['select', [PUBLIC_EVENT_COLUMNS]],
      ['gt', ['ends_at', now.toISOString()]],
      // Saturday to Friday night: until Saturday 7 Nov, 5 AM New York (EST,
      // after the clocks go back) = 10:00 UTC. No "starts from": tonight first.
      ['lt', ['starts_at', '2026-11-07T10:00:00.000Z']],
      ['order', ['starts_at', { ascending: true }]],
      ['order', ['id', { ascending: true }]],
      // One more than a page, to tell whether another page follows (VC-66).
      ['limit', [101]],
    ]);
  });

  it('asks for the coming weekend only, from Friday 5 AM to Monday 5 AM (VC-63)', async () => {
    const { query, calls } = fakeQuery({ data: [], error: null });
    from.mockReturnValue(query);
    // Tuesday 3 Nov 2026, 8 PM New York (EST) = 4 Nov 01:00 UTC.
    const now = new Date('2026-11-04T01:00:00Z');

    await listHomeEvents(now, { kind: 'weekend' });

    expect(calls).toEqual([
      ['select', [PUBLIC_EVENT_COLUMNS]],
      ['gt', ['ends_at', now.toISOString()]],
      // Friday 6 Nov, 5 AM EST = 10:00 UTC, up to Monday 9 Nov, 5 AM EST.
      ['gte', ['starts_at', '2026-11-06T10:00:00.000Z']],
      ['lt', ['starts_at', '2026-11-09T10:00:00.000Z']],
      ['order', ['starts_at', { ascending: true }]],
      ['order', ['id', { ascending: true }]],
      // One more than a page, to tell whether another page follows (VC-66).
      ['limit', [101]],
    ]);
  });

  it('shows 100 and says more follow when the 101st row comes back (VC-66)', async () => {
    const rows = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => ({ id: `e${i}` }));
    const { query } = fakeQuery({ data: rows, error: null });
    from.mockReturnValue(query);

    const outcome = await listHomeEvents(new Date('2026-11-01T00:00:00Z'));

    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.events).toHaveLength(100);
    expect(outcome.events[99]).toEqual({ id: 'e99' });
    expect(outcome.hasMore).toBe(true);
  });

  it('asks for the next page after the last event shown, in the same window (VC-66)', async () => {
    const { query, calls } = fakeQuery({ data: [{ id: 'e101' }], error: null });
    from.mockReturnValue(query);
    const now = new Date('2026-11-04T01:00:00Z');
    const last = { id: 'abc-123', starts_at: '2026-11-07T03:00:00+00:00' };

    const outcome = await listHomeEvents(now, { kind: 'weekend' }, last);

    expect(outcome).toEqual({ ok: true, events: [{ id: 'e101' }], hasMore: false });
    expect(calls).toEqual([
      ['select', [PUBLIC_EVENT_COLUMNS]],
      ['gt', ['ends_at', now.toISOString()]],
      ['gte', ['starts_at', '2026-11-06T10:00:00.000Z']],
      // Later than the last one, or the same start time with a larger id.
      [
        'or',
        [
          'starts_at.gt."2026-11-07T03:00:00+00:00",and(starts_at.eq."2026-11-07T03:00:00+00:00",id.gt.abc-123)',
        ],
      ],
      ['lt', ['starts_at', '2026-11-09T10:00:00.000Z']],
      ['order', ['starts_at', { ascending: true }]],
      ['order', ['id', { ascending: true }]],
      ['limit', [101]],
    ]);
  });

  it("keeps the server's exact start time in the cursor (no rounding)", () => {
    expect(afterCursorFilter({ id: 'x', starts_at: '2026-11-07T03:00:00.123456+00:00' })).toBe(
      'starts_at.gt."2026-11-07T03:00:00.123456+00:00",and(starts_at.eq."2026-11-07T03:00:00.123456+00:00",id.gt.x)',
    );
  });

  it('turns a network failure into a plain sentence', async () => {
    const { query } = fakeQuery({ data: null, error: { message: 'Network request failed' } });
    from.mockReturnValue(query);
    expect(await listHomeEvents()).toEqual({
      ok: false,
      message: "We couldn't reach the server. Check your connection and try again.",
    });
  });

  it('copes with a thrown error', async () => {
    from.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(await listHomeEvents()).toEqual({
      ok: false,
      message: "We couldn't load events. Please try again.",
    });
  });
});

describe('getEvent', () => {
  it('reads one event by id', async () => {
    const { query, calls } = fakeQuery({ data: { id: 'e1' }, error: null });
    from.mockReturnValue(query);
    expect(await getEvent('e1')).toEqual({ ok: true, event: { id: 'e1' } });
    expect(calls).toEqual([
      ['select', [PUBLIC_EVENT_COLUMNS]],
      ['eq', ['id', 'e1']],
      ['maybeSingle', []],
    ]);
  });

  it('gives null when there is no such event (or it is hidden)', async () => {
    const { query } = fakeQuery({ data: null, error: null });
    from.mockReturnValue(query);
    expect(await getEvent('e1')).toEqual({ ok: true, event: null });
  });

  it('treats a broken id (not a uuid) as not found', async () => {
    const { query } = fakeQuery({ data: null, error: { code: '22P02', message: 'invalid input' } });
    from.mockReturnValue(query);
    expect(await getEvent('nope')).toEqual({ ok: true, event: null });
  });
});
