/**
 * Tests for the vibe calls (src/lib/vibe-api.ts), task VC-B09.
 *
 * The Supabase client is replaced with a fake. We check:
 *   - each call uses the SQL function's name and parameter names;
 *   - answers are checked and tidied (the list becomes a lookup by event id,
 *     and broken items are skipped);
 *   - errors and network trouble become a plain message, never a crash;
 *   - an empty list doesn't call the server; more than 100 ids are split
 *     into calls of at most 100 and the answers merged (VC-66), and one
 *     failed call fails the whole answer.
 */
import { supabase } from '@/lib/supabase';
import { getEventVibe, getEventsVibe } from '@/lib/vibe-api';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
const rpc = supabase.rpc as jest.Mock;

const EARLY = { state: 'early', raters: 3, here: 7, score: null, reactions: [] };

beforeEach(() => jest.clearAllMocks());

describe('getEventVibe', () => {
  it('calls get_event_vibe and reads the answer', async () => {
    rpc.mockResolvedValue({ data: EARLY, error: null });
    const outcome = await getEventVibe('e1');
    expect(rpc).toHaveBeenCalledWith('get_event_vibe', { p_event_id: 'e1' });
    expect(outcome).toMatchObject({ ok: true, vibe: { state: 'early', raters: 3, here: 7 } });
  });

  it('turns an unknown answer, an error or a dropped connection into a message', async () => {
    rpc.mockResolvedValueOnce({ data: { state: 'odd' }, error: null });
    await expect(getEventVibe('e1')).resolves.toEqual({
      ok: false,
      message: "We couldn't load the vibe.",
    });
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'VCNFD', message: 'nope' } });
    await expect(getEventVibe('e1')).resolves.toEqual({
      ok: false,
      message: "We couldn't load the vibe.",
    });
    rpc.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(getEventVibe('e1')).resolves.toEqual({
      ok: false,
      message: "We couldn't reach the server. Check your connection and try again.",
    });
  });
});

describe('getEventsVibe', () => {
  it('calls get_events_vibe once and returns a lookup by event id', async () => {
    rpc.mockResolvedValue({
      data: [
        { ...EARLY, event_id: 'e1' },
        { state: 'live', raters: 6, here: 9, score: 7.2, label: 'Hot', event_id: 'e2' },
        { state: 'live', raters: 6, score: null, event_id: 'e3' },
        { ...EARLY },
      ],
      error: null,
    });
    const outcome = await getEventsVibe(['e1', 'e2', 'e3']);
    expect(rpc).toHaveBeenCalledWith('get_events_vibe', { p_event_ids: ['e1', 'e2', 'e3'] });
    if (!outcome.ok) throw new Error('expected ok');
    // e3 (live without a score) and the item without an id are skipped.
    expect(Object.keys(outcome.vibes)).toEqual(['e1', 'e2']);
    expect(outcome.vibes.e2).toMatchObject({ state: 'live', score: 7.2, label: 'Hot', here: 9 });
  });

  it("doesn't call the server for an empty list, and sends at most 100 ids per call", async () => {
    await expect(getEventsVibe([])).resolves.toEqual({ ok: true, vibes: {} });
    expect(rpc).not.toHaveBeenCalled();

    // Each call answers with an "early" vibe for the ids it was given.
    rpc.mockImplementation((_name: string, args: { p_event_ids: string[] }) =>
      Promise.resolve({
        data: args.p_event_ids.map((id) => ({ ...EARLY, event_id: id })),
        error: null,
      }),
    );
    const ids = Array.from({ length: 250 }, (_, i) => `e${i}`);
    const outcome = await getEventsVibe(ids);
    // VC-66: 250 ids go out as 100 + 100 + 50, in order, and come back merged.
    expect(rpc.mock.calls.map((c) => c[1].p_event_ids.length)).toEqual([100, 100, 50]);
    expect(rpc.mock.calls[1][1].p_event_ids[0]).toBe('e100');
    if (!outcome.ok) throw new Error('expected ok');
    expect(Object.keys(outcome.vibes)).toHaveLength(250);
    expect(outcome.vibes.e249).toMatchObject({ state: 'early' });
  });

  it('fails the whole answer when one of the split calls fails (VC-66)', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } });
    const ids = Array.from({ length: 150 }, (_, i) => `e${i}`);
    const outcome = await getEventsVibe(ids);
    expect(outcome.ok).toBe(false);
  });

  it('turns an error into a message', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'no' } });
    await expect(getEventsVibe(['e1'])).resolves.toEqual({
      ok: false,
      message: "We couldn't load the vibe.",
    });
  });
});
