/**
 * A time limit for server calls the guest has to wait on (task Q8b).
 *
 * Why it exists: while a check-in or a rating is being sent, the screen
 * blocks Back and Close (leaving mid-send would hide the answer). Venue
 * Wi-Fi at parties is often bad, and a request can hang with no answer for
 * minutes. Without a limit, the guest would be stuck on the sheet. With
 * one, after {@link NETWORK_TIMEOUT_MS} we give up, free the screen, and
 * show {@link TIMEOUT_MESSAGE} with a way to try again.
 *
 * Giving up does NOT mean the server didn't do the work: the request may
 * still land a moment later. That is safe because the server functions are
 * repeat-proof ("idempotent"): checking in twice keeps one check-in and
 * answers "already checked in" the second time (pgTAP 009 section 9 and
 * 010 section 5), and a rating saved twice within the hour answers
 * "too soon" instead of counting twice. So the server's answer on the next
 * try is always the truth.
 *
 * How: each call gets an AbortController. supabase-js requests accept its
 * `signal` (`.abortSignal(signal)`), so when time runs out we cancel the
 * request on the phone as well as stop waiting for it.
 */

/** How long to wait for an answer before giving up, in milliseconds. */
export const NETWORK_TIMEOUT_MS = 15_000;

/** The friendly sentence shown when a call ran out of time. */
export const TIMEOUT_MESSAGE = "Signal's weak, try again.";

/** What {@link withTimeout} returns: the call's answer, or "ran out of time". */
export type TimedResult<T> = { timedOut: false; value: T } | { timedOut: true };

/**
 * Runs one server call with a time limit.
 *
 * @param start - starts the call. It receives an AbortSignal to hand to
 *   the request (supabase-js: `.abortSignal(signal)`), so the request is
 *   cancelled when time runs out.
 * @param ms - the limit in milliseconds (default {@link NETWORK_TIMEOUT_MS}).
 * @returns `{ timedOut: false, value }` if the call answered in time, or
 *   `{ timedOut: true }` if it didn't. If the call itself fails (rejects)
 *   in time, that failure is passed on unchanged, so the caller's own
 *   try/catch handles it as before.
 */
export async function withTimeout<T>(
  start: (signal: AbortSignal) => PromiseLike<T>,
  ms: number = NETWORK_TIMEOUT_MS,
): Promise<TimedResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Wrap in a real Promise: supabase-js hands back a "thenable" builder.
  const call = Promise.resolve(start(controller.signal));
  // After we give up, the cancelled request may still reject (an abort
  // error). Nobody is listening by then, so swallow it here to avoid an
  // "unhandled promise rejection" warning. The race below still sees it.
  call.catch(() => {});

  const deadline = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });

  try {
    const outcome = await Promise.race([
      call.then((value) => ({ timedOut: false as const, value })),
      deadline,
    ]);
    // Out of time: cancel the request so it stops using the connection.
    if (outcome.timedOut) controller.abort();
    return outcome;
  } finally {
    // Answered (or failed) in time: the deadline timer is no longer needed.
    clearTimeout(timer);
  }
}
