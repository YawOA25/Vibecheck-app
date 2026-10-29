/**
 * Tests for the server-call time limit (src/lib/network-timeout.ts), Q8b.
 *
 * Fake timers stand in for the clock. We check:
 *   - an answer in time is passed back, and its timer is cleared;
 *   - no answer by the limit gives "timed out" and cancels the request
 *     (its AbortSignal fires); a later answer is ignored;
 *   - a failure in time is passed on unchanged, for the caller's catch;
 *   - the default limit is 15 seconds.
 */
import { NETWORK_TIMEOUT_MS, withTimeout } from '@/lib/network-timeout';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('withTimeout', () => {
  it('waits 15 seconds by default', () => {
    expect(NETWORK_TIMEOUT_MS).toBe(15_000);
  });

  it('passes back an answer that comes in time and clears its timer', async () => {
    let seen: AbortSignal | undefined;
    const outcome = await withTimeout((signal) => {
      seen = signal;
      return Promise.resolve('hello');
    });
    expect(outcome).toEqual({ timedOut: false, value: 'hello' });
    expect(seen?.aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('gives up at the limit, cancels the request, and ignores a late answer', async () => {
    let seen: AbortSignal | undefined;
    let answer!: (value: string) => void;
    const pending = withTimeout((signal) => {
      seen = signal;
      return new Promise<string>((resolve) => (answer = resolve));
    }, 1000);
    await jest.advanceTimersByTimeAsync(999);
    expect(seen?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ timedOut: true });
    expect(seen?.aborted).toBe(true);
    // The late answer has nowhere to go and breaks nothing.
    answer('too late');
    await expect(pending).resolves.toEqual({ timedOut: true });
  });

  it('a cancelled request that rejects after we gave up causes no unhandled rejection', async () => {
    let fail!: (reason: Error) => void;
    const pending = withTimeout(() => new Promise((_resolve, reject) => (fail = reject)), 10);
    await jest.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toEqual({ timedOut: true });
    // Jest would fail this test on an unhandled rejection.
    fail(new Error('AbortError'));
    await Promise.resolve();
  });

  it('passes on a failure that comes in time, and clears its timer', async () => {
    await expect(
      withTimeout(() => Promise.reject(new Error('Network request failed'))),
    ).rejects.toThrow('Network request failed');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('works with a "thenable" (what supabase-js hands back), not only a Promise', async () => {
    // Not a Promise: an object with only a `then` method.
    const thenable: PromiseLike<number> = {
      then: (onDone, onFail) => Promise.resolve(42).then(onDone, onFail),
    };
    await expect(withTimeout(() => thenable)).resolves.toEqual({ timedOut: false, value: 42 });
  });
});
