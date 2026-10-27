/**
 * Tests for the check_in call (src/lib/check-in-api.ts), task VC-B06.
 *
 * The Supabase client is replaced with a fake. We check:
 *   - the reading is sent with the SQL function's parameter names;
 *   - every server answer is read into the right result, and an unknown
 *     answer becomes a general error instead of a crash;
 *   - server error codes (not allowed, not found, bad reading) and network
 *     trouble become the right kind and a plain message;
 *   - no message ever repeats the coordinates, and nothing is logged.
 */
import { parseCheckInResult, submitCheckIn } from '@/lib/check-in-api';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
const rpc = supabase.rpc as jest.Mock;

/** A reading with distinctive digits, so we can check they never leak. */
const READING = { lat: 38.91234, lng: -77.04321, accuracyM: 18 };

let consoleSpies: jest.SpyInstance[];

beforeEach(() => {
  jest.clearAllMocks();
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
    jest.spyOn(console, name).mockImplementation(() => {}),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

describe('submitCheckIn', () => {
  it('sends the event id and the reading with the SQL parameter names', async () => {
    rpc.mockResolvedValue({
      data: { status: 'passed', first_at: '2026-10-31T02:00:00Z', already_checked_in: false },
      error: null,
    });
    const outcome = await submitCheckIn('e1', READING);
    expect(rpc).toHaveBeenCalledWith('check_in', {
      p_event_id: 'e1',
      p_lat: 38.91234,
      p_lng: -77.04321,
      p_accuracy_m: 18,
    });
    expect(outcome).toEqual({
      ok: true,
      result: { status: 'passed', firstAt: '2026-10-31T02:00:00Z', alreadyCheckedIn: false },
    });
  });

  it.each([
    ['42501', 'notAllowed'],
    ['VCNFD', 'notFound'],
    ['VCGPS', 'badReading'],
    ['XX000', 'unknown'],
  ])('turns server error %s into the %s kind', async (code, kind) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'server words' } });
    const outcome = await submitCheckIn('e1', READING);
    expect(outcome).toMatchObject({ ok: false, kind });
    // The message is ours, never the reading's numbers.
    expect(JSON.stringify(outcome)).not.toMatch(/38\.91|77\.04/);
  });

  it('says to check the connection when the network fails, even if it throws', async () => {
    rpc.mockRejectedValue(new Error('Network request failed'));
    await expect(submitCheckIn('e1', READING)).resolves.toEqual({
      ok: false,
      kind: 'network',
      message: "We couldn't reach the server. Check your connection and try again.",
    });
  });

  it('treats an answer it does not recognise as a general error', async () => {
    rpc.mockResolvedValue({ data: { status: 'teleported' }, error: null });
    await expect(submitCheckIn('e1', READING)).resolves.toMatchObject({
      ok: false,
      kind: 'unknown',
    });
  });
});

describe('parseCheckInResult', () => {
  it('reads every status the server sends', () => {
    expect(parseCheckInResult({ status: 'too_far' })).toEqual({ status: 'too_far' });
    expect(parseCheckInResult({ status: 'weak_signal' })).toEqual({ status: 'weak_signal' });
    expect(parseCheckInResult({ status: 'too_many_events' })).toEqual({
      status: 'too_many_events',
    });
    expect(
      parseCheckInResult({
        status: 'outside_window',
        reason: 'too_early',
        opens_at: '2026-10-31T01:30:00Z',
        closes_at: '2026-10-31T07:00:00Z',
      }),
    ).toEqual({
      status: 'outside_window',
      reason: 'too_early',
      opensAt: '2026-10-31T01:30:00Z',
      closesAt: '2026-10-31T07:00:00Z',
    });
    expect(parseCheckInResult({ status: 'too_many_attempts', retry_after_minutes: 12 })).toEqual({
      status: 'too_many_attempts',
      retryAfterMinutes: 12,
    });
  });

  it('waits at least 1 minute even if the number is missing', () => {
    expect(parseCheckInResult({ status: 'too_many_attempts' })).toEqual({
      status: 'too_many_attempts',
      retryAfterMinutes: 1,
    });
  });

  it('returns null for broken answers', () => {
    expect(parseCheckInResult(null)).toBeNull();
    expect(parseCheckInResult({ status: 'passed' })).toBeNull();
    expect(parseCheckInResult({ status: 'outside_window', reason: 'whenever' })).toBeNull();
  });
});
