/**
 * Tests for the VC-81 stats row helpers (src/lib/profile-stats.ts) and the
 * server call (src/lib/profile-stats-api.ts), with supabase faked.
 *
 * We check that:
 *   - a good answer is read into numbers and a date;
 *   - anything odd (missing, negative or fractional counts, not an object)
 *     is refused, so the screen never shows a wrong number;
 *   - a bad join date only drops the "member since" line;
 *   - the month is the New York one ("OCT" for a late 31 Oct sign-up);
 *   - the call asks for get_my_stats with no inputs (the server picks the
 *     caller itself), and any error or throw becomes { ok: false }.
 */
import { memberSinceText, parseStats } from '@/lib/profile-stats';
import { getMyStats } from '@/lib/profile-stats-api';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
const rpc = supabase.rpc as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('parseStats', () => {
  it('reads the counts and the join date', () => {
    expect(
      parseStats({ nights_out: 4, ratings: 7, member_since: '2026-10-02T15:00:00+00:00' }),
    ).toEqual({ nightsOut: 4, ratings: 7, memberSince: new Date('2026-10-02T15:00:00Z') });
  });

  it('refuses answers it does not understand', () => {
    expect(parseStats(null)).toBeNull();
    expect(parseStats('4')).toBeNull();
    expect(parseStats({ ratings: 1 })).toBeNull();
    expect(parseStats({ nights_out: -1, ratings: 1 })).toBeNull();
    expect(parseStats({ nights_out: 1.5, ratings: 1 })).toBeNull();
    expect(parseStats({ nights_out: 1, ratings: '1' })).toBeNull();
  });

  it('drops only the join date when it is missing or unreadable', () => {
    expect(parseStats({ nights_out: 0, ratings: 0 })?.memberSince).toBeNull();
    expect(parseStats({ nights_out: 0, ratings: 0, member_since: 'soon' })?.memberSince).toBeNull();
  });
});

describe('memberSinceText', () => {
  it('uses the New York month and year', () => {
    expect(memberSinceText(new Date('2026-10-15T12:00:00Z'))).toBe('MEMBER SINCE OCT 2026');
    // 11:30 PM on 31 Oct in New York is already November in UTC (and Tokyo).
    expect(memberSinceText(new Date('2026-11-01T03:30:00Z'))).toBe('MEMBER SINCE OCT 2026');
  });
});

describe('getMyStats', () => {
  it('calls get_my_stats with no inputs and returns the stats', async () => {
    rpc.mockResolvedValue({ data: { nights_out: 2, ratings: 3, member_since: null }, error: null });
    await expect(getMyStats()).resolves.toEqual({
      ok: true,
      stats: { nightsOut: 2, ratings: 3, memberSince: null },
    });
    expect(rpc).toHaveBeenCalledWith('get_my_stats', {});
  });

  it('turns an error, an odd answer or a throw into { ok: false }', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom', code: '42501' } });
    await expect(getMyStats()).resolves.toEqual({ ok: false });
    rpc.mockResolvedValueOnce({ data: { nights_out: 'x' }, error: null });
    await expect(getMyStats()).resolves.toEqual({ ok: false });
    rpc.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(getMyStats()).resolves.toEqual({ ok: false });
  });
});
