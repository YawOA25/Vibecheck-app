/**
 * Tests for the party-code and tester check-in calls
 * (src/lib/code-check-in-api.ts), task VC-B07.
 *
 * The Supabase client is replaced with a fake. We check:
 *   - typed codes are tidied (capitals, letters and digits only, at most 6);
 *   - the code and the event id go out with the SQL parameter names, and
 *     the tester check-in sends only the event id;
 *   - every server answer is read into the right result (wrong code with
 *     tries left, locked, code off, and the answers shared with GPS), and
 *     GPS-only or unknown answers become a general error;
 *   - server error codes and network trouble become the right kind and a
 *     plain message, which never repeats the code; nothing is logged;
 *   - Q8b: no answer within 15 seconds (fake timers) becomes a 'timeout'
 *     with "Signal's weak, try again", and the request is cancelled; a
 *     late success shows as "already checked in" on the retry.
 */
import {
  cleanPartyCode,
  parseCodeCheckInResult,
  submitCodeCheckIn,
  submitTesterCheckIn,
} from '@/lib/code-check-in-api';
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

let consoleSpies: jest.SpyInstance[];

beforeEach(() => {
  jest.clearAllMocks();
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
    jest.spyOn(console, name).mockImplementation(() => {}),
  );
});

afterEach(() => {
  // Privacy: nothing (so no code) reaches the console.
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

describe('cleanPartyCode', () => {
  it('makes capitals, drops spaces, dashes and symbols, and stops at 6', () => {
    expect(cleanPartyCode('k7m-x2q')).toBe('K7MX2Q');
    expect(cleanPartyCode(' k7 m!x ')).toBe('K7MX');
    expect(cleanPartyCode('K7MX2QZZ')).toBe('K7MX2Q');
  });
});

describe('submitCodeCheckIn', () => {
  it('sends the event id and the cleaned code with the SQL parameter names', async () => {
    rpcAnswer.mockResolvedValue({
      data: { status: 'passed', first_at: '2026-10-31T02:00:00Z', already_checked_in: false },
      error: null,
    });
    const outcome = await submitCodeCheckIn('e1', 'k7mx2q');
    expect(rpc).toHaveBeenCalledWith('check_in_with_code', { p_event_id: 'e1', p_code: 'K7MX2Q' });
    expect(outcome).toEqual({
      ok: true,
      result: { status: 'passed', firstAt: '2026-10-31T02:00:00Z', alreadyCheckedIn: false },
    });
  });

  it('reads a wrong code with tries left', async () => {
    rpcAnswer.mockResolvedValue({ data: { status: 'wrong_code', tries_left: 3 }, error: null });
    expect(await submitCodeCheckIn('e1', 'QQ9QQ9')).toEqual({
      ok: true,
      result: { status: 'wrong_code', triesLeft: 3 },
    });
  });

  it('turns "not a code" into a plain message that doesn\'t repeat the code', async () => {
    rpcAnswer.mockResolvedValue({ data: null, error: { code: 'VCCOD', message: 'x' } });
    const outcome = await submitCodeCheckIn('e1', 'ZZ9');
    expect(outcome).toMatchObject({ ok: false, kind: 'badCode' });
    expect(JSON.stringify(outcome)).not.toMatch(/ZZ9/);
  });

  it('turns network trouble and a throw into a network error', async () => {
    rpcAnswer.mockRejectedValue(new Error('Network request failed'));
    expect(await submitCodeCheckIn('e1', 'K7MX2Q')).toMatchObject({ ok: false, kind: 'network' });
  });

  it('maps not-found and not-allowed', async () => {
    rpcAnswer.mockResolvedValue({ data: null, error: { code: 'VCNFD', message: 'x' } });
    expect(await submitCodeCheckIn('e1', 'K7MX2Q')).toMatchObject({ ok: false, kind: 'notFound' });
    rpcAnswer.mockResolvedValue({ data: null, error: { code: '42501', message: 'x' } });
    expect(await submitCodeCheckIn('e1', 'K7MX2Q')).toMatchObject({
      ok: false,
      kind: 'notAllowed',
    });
  });
});

describe('submitCodeCheckIn with no answer (Q8b timeout)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('gives up after 15 seconds, cancels the request and never repeats the code', async () => {
    rpcAnswer.mockReturnValue(new Promise(() => {}));
    const pending = submitCodeCheckIn('e1', 'K7MX2Q');
    await jest.advanceTimersByTimeAsync(NETWORK_TIMEOUT_MS);
    const outcome = await pending;
    expect(outcome).toEqual({ ok: false, kind: 'timeout', message: TIMEOUT_MESSAGE });
    expect(lastSignal?.aborted).toBe(true);
    expect(JSON.stringify(outcome)).not.toMatch(/K7MX2Q/);
  });

  it('a late success shows as "already checked in" on the retry', async () => {
    // check_in_with_code is repeat-proof too (pgTAP 010 section 5).
    rpcAnswer.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce({
      data: { status: 'passed', first_at: '2026-10-31T02:00:00Z', already_checked_in: true },
      error: null,
    });
    const first = submitCodeCheckIn('e1', 'K7MX2Q');
    await jest.advanceTimersByTimeAsync(NETWORK_TIMEOUT_MS);
    await expect(first).resolves.toMatchObject({ kind: 'timeout' });
    await expect(submitCodeCheckIn('e1', 'K7MX2Q')).resolves.toEqual({
      ok: true,
      result: { status: 'passed', firstAt: '2026-10-31T02:00:00Z', alreadyCheckedIn: true },
    });
  });

  it('the tester check-in gives up the same way', async () => {
    rpcAnswer.mockReturnValue(new Promise(() => {}));
    const pending = submitTesterCheckIn('t1');
    await jest.advanceTimersByTimeAsync(NETWORK_TIMEOUT_MS);
    await expect(pending).resolves.toMatchObject({ ok: false, kind: 'timeout' });
  });
});

describe('submitTesterCheckIn', () => {
  it('sends only the event id to tester_check_in', async () => {
    rpcAnswer.mockResolvedValue({
      data: { status: 'passed', first_at: '2026-10-31T02:00:00Z', already_checked_in: true },
      error: null,
    });
    await submitTesterCheckIn('t1');
    expect(rpc).toHaveBeenCalledWith('tester_check_in', { p_event_id: 't1' });
  });

  it('a real event is refused with its own message', async () => {
    rpcAnswer.mockResolvedValue({ data: null, error: { code: 'VCOVR', message: 'x' } });
    expect(await submitTesterCheckIn('e1')).toEqual({
      ok: false,
      kind: 'realEvent',
      message: 'The tester check-in works only on test events.',
    });
  });
});

describe('parseCodeCheckInResult', () => {
  it('reads locked and code off', () => {
    expect(parseCodeCheckInResult({ status: 'locked', retry_after_minutes: 42 })).toEqual({
      status: 'locked',
      retryAfterMinutes: 42,
    });
    expect(parseCodeCheckInResult({ status: 'locked' })).toEqual({
      status: 'locked',
      retryAfterMinutes: 1,
    });
    expect(parseCodeCheckInResult({ status: 'code_off' })).toEqual({ status: 'code_off' });
  });

  it('keeps tries left between 1 and 4', () => {
    expect(parseCodeCheckInResult({ status: 'wrong_code', tries_left: 9 })).toEqual({
      status: 'wrong_code',
      triesLeft: 4,
    });
    expect(parseCodeCheckInResult({ status: 'wrong_code' })).toEqual({
      status: 'wrong_code',
      triesLeft: 1,
    });
  });

  it('reads the answers shared with GPS', () => {
    expect(
      parseCodeCheckInResult({
        status: 'outside_window',
        reason: 'too_late',
        opens_at: '2026-10-31T00:30:00Z',
        closes_at: '2026-10-31T07:00:00Z',
      }),
    ).toMatchObject({ status: 'outside_window', reason: 'too_late' });
    expect(parseCodeCheckInResult({ status: 'too_many_events' })).toEqual({
      status: 'too_many_events',
    });
  });

  it('treats GPS-only and unknown answers as unknown', () => {
    expect(parseCodeCheckInResult({ status: 'too_far' })).toBeNull();
    expect(parseCodeCheckInResult({ status: 'weak_signal' })).toBeNull();
    expect(parseCodeCheckInResult({ status: 'surprise' })).toBeNull();
    expect(parseCodeCheckInResult(null)).toBeNull();
  });

  it('an unknown answer becomes a general error', async () => {
    rpcAnswer.mockResolvedValue({ data: { status: 'surprise' }, error: null });
    expect(await submitCodeCheckIn('e1', 'K7MX2Q')).toMatchObject({ ok: false, kind: 'unknown' });
  });
});
