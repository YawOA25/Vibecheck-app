/**
 * Tests for the check_in call (src/lib/check-in-api.ts), task VC-B06.
 *
 * The Supabase client is replaced with a fake. We check:
 *   - the reading is sent with the SQL function's parameter names;
 *   - every server answer is read into the right result, and an unknown
 *     answer becomes a general error instead of a crash;
 *   - server error codes (not allowed, not found, bad reading) and network
 *     trouble become the right kind and a plain message;
 *   - no message ever repeats the coordinates, and nothing is logged;
 *   - Q8b: a call with no answer gives up after 15 seconds (fake timers),
 *     cancels the request, and says "Signal's weak, try again"; if the
 *     server did check the guest in after all, the retry reads its
 *     "already checked in" answer as a normal pass.
 */
import { parseCheckInResult, submitCheckIn } from '@/lib/check-in-api';
import { NETWORK_TIMEOUT_MS, TIMEOUT_MESSAGE } from '@/lib/network-timeout';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
const rpc = supabase.rpc as jest.Mock;
/**
 * What the fake server answers (Q8b). The API now calls
 * `.abortSignal(signal)` on the request supabase.rpc returns (so it can
 * cancel it after 15 seconds) before waiting for it. So the fake rpc hands
 * back a stand-in request with that method, which answers whatever
 * `rpcAnswer` is set to. `lastSignal` keeps the signal it was given.
 */
const rpcAnswer = jest.fn();
let lastSignal: AbortSignal | undefined;
rpc.mockImplementation(() => {
  const request = {
    abortSignal: (signal: AbortSignal) => {
      lastSignal = signal;
      return request;
    },
    then: (onDone: (value: unknown) => unknown, onFail: (reason: unknown) => unknown) =>
      Promise.resolve(rpcAnswer()).then(onDone, onFail),
  };
  return request;
});

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
    rpcAnswer.mockResolvedValue({
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
    rpcAnswer.mockResolvedValue({ data: null, error: { code, message: 'server words' } });
    const outcome = await submitCheckIn('e1', READING);
    expect(outcome).toMatchObject({ ok: false, kind });
    // The message is ours, never the reading's numbers.
    expect(JSON.stringify(outcome)).not.toMatch(/38\.91|77\.04/);
  });

  it('says to check the connection when the network fails, even if it throws', async () => {
    rpcAnswer.mockRejectedValue(new Error('Network request failed'));
    await expect(submitCheckIn('e1', READING)).resolves.toEqual({
      ok: false,
      kind: 'network',
      message: "We couldn't reach the server. Check your connection and try again.",
    });
  });

  it('treats an answer it does not recognise as a general error', async () => {
    rpcAnswer.mockResolvedValue({ data: { status: 'teleported' }, error: null });
    await expect(submitCheckIn('e1', READING)).resolves.toMatchObject({
      ok: false,
      kind: 'unknown',
    });
  });

  describe('with no answer (Q8b timeout)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('gives up after 15 seconds, cancels the request and says the signal is weak', async () => {
      // A request that never answers, like one stuck on bad venue Wi-Fi.
      rpcAnswer.mockReturnValue(new Promise(() => {}));
      let settled = false;
      const pending = submitCheckIn('e1', READING).finally(() => {
        settled = true;
      });

      // One millisecond short of the limit: still waiting.
      await jest.advanceTimersByTimeAsync(NETWORK_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      expect(lastSignal?.aborted).toBe(false);

      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({
        ok: false,
        kind: 'timeout',
        message: TIMEOUT_MESSAGE,
      });
      // The request itself was cancelled, not just ignored.
      expect(lastSignal?.aborted).toBe(true);
      expect(JSON.stringify(await pending)).not.toMatch(/38\.91|77\.04/);
    });

    it('uses an answer that arrives just inside the limit, and leaves no timer behind', async () => {
      let answer!: (value: unknown) => void;
      rpcAnswer.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      const pending = submitCheckIn('e1', READING);
      await jest.advanceTimersByTimeAsync(NETWORK_TIMEOUT_MS - 1);
      answer({ data: { status: 'too_far' }, error: null });
      await expect(pending).resolves.toEqual({ ok: true, result: { status: 'too_far' } });
      expect(lastSignal?.aborted).toBe(false);
      // The 15-second timer was cleared once the answer came.
      expect(jest.getTimerCount()).toBe(0);
    });

    it('a late success on the server shows as "already checked in" on the retry', async () => {
      // First try: the server checks the guest in, but the answer never
      // reaches the phone. Second try: check_in is repeat-proof, so it
      // answers "passed" with already_checked_in (pgTAP 009 section 9).
      rpcAnswer.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce({
        data: { status: 'passed', first_at: '2026-10-31T02:00:00Z', already_checked_in: true },
        error: null,
      });
      const first = submitCheckIn('e1', READING);
      await jest.advanceTimersByTimeAsync(NETWORK_TIMEOUT_MS);
      await expect(first).resolves.toMatchObject({ ok: false, kind: 'timeout' });

      await expect(submitCheckIn('e1', READING)).resolves.toEqual({
        ok: true,
        result: { status: 'passed', firstAt: '2026-10-31T02:00:00Z', alreadyCheckedIn: true },
      });
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
    // VC-36: 5 "too far" answers for this event, so GPS is off for it.
    expect(parseCheckInResult({ status: 'gps_locked' })).toEqual({ status: 'gps_locked' });
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
