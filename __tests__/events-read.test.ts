/**
 * Tests for the public event reads (src/lib/events-read.ts), VC-B05.
 *
 * Supabase is replaced with a fake "query builder" that records each step
 * (from, select, gt, lt, order, limit, eq, maybeSingle). We check:
 *   - the list asks only for public columns (no location can be requested);
 *   - the list filters to "not over yet" and "starts before the end of
 *     tomorrow", soonest first;
 *   - errors become plain sentences;
 *   - one event by id: found, not found, and a broken id (treated as not found).
 */
import { getEvent, listTonightEvents, PUBLIC_EVENT_COLUMNS } from '@/lib/events-read';
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
  for (const step of ['select', 'gt', 'lt', 'order', 'limit', 'eq']) {
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

describe('listTonightEvents', () => {
  it('reads public columns for events not yet over, starting before the end of tomorrow', async () => {
    const { query, calls } = fakeQuery({ data: [{ id: 'e1' }], error: null });
    from.mockReturnValue(query);
    // Saturday 31 Oct 2026, 8 PM New York (EDT) = 1 Nov 00:00 UTC.
    const now = new Date('2026-11-01T00:00:00Z');

    const outcome = await listTonightEvents(now);

    expect(outcome).toEqual({ ok: true, events: [{ id: 'e1' }] });
    expect(from).toHaveBeenCalledWith('events');
    expect(calls).toEqual([
      ['select', [PUBLIC_EVENT_COLUMNS]],
      ['gt', ['ends_at', now.toISOString()]],
      // Until Monday 5 AM New York (EST, after the clocks go back) = 10:00 UTC.
      ['lt', ['starts_at', '2026-11-02T10:00:00.000Z']],
      ['order', ['starts_at', { ascending: true }]],
      ['limit', [100]],
    ]);
  });

  it('turns a network failure into a plain sentence', async () => {
    const { query } = fakeQuery({ data: null, error: { message: 'Network request failed' } });
    from.mockReturnValue(query);
    expect(await listTonightEvents()).toEqual({
      ok: false,
      message: "We couldn't reach the server. Check your connection and try again.",
    });
  });

  it('copes with a thrown error', async () => {
    from.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(await listTonightEvents()).toEqual({
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
