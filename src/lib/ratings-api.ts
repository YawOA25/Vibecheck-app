/**
 * The app's calls to the server for rating (task VC-B08) and heads-up tags
 * (proposal VC-43).
 *
 * What it does:
 *   - {@link submitRating} sends the 3 taps (plus an optional reaction and
 *     tags) to `submit_rating`;
 *   - {@link addHeadsUp} sends one "+1" to `add_heads_up`;
 *   - {@link getEventHeadsUps} reads the tag counts for the event page;
 *   - {@link getMyRatingStatus} reads the guest's OWN check-in and rating
 *     for an event (the database only ever returns their own rows), so the
 *     screens know whether to offer "Rate the night" or "update in N min".
 * Each one turns the server's answer into a tidy result, or a short
 * message to show. None of them throws.
 *
 * Why the server decides: who may rate, "here now", the window and the
 * 60-minute rule all live in the database
 * (supabase/migrations/20261027120000_ratings_and_heads_ups.sql), so a
 * changed app can't skip them.
 */
import type { ErrorLike } from '@/lib/auth-errors';
import { isHeadsUpTag } from '@/lib/rating';
import type { CompleteDraft, HeadsUpTag } from '@/lib/rating';
import { TIMEOUT_MESSAGE, withTimeout } from '@/lib/network-timeout';
import { supabase } from '@/lib/supabase';

/** "Not now" answers shared by rating and +1 (the server's rating_gate). */
export type GateRefusal =
  /** Too early or too late, with when it opens and closes. */
  | {
      status: 'outside_window';
      reason: 'too_early' | 'too_late';
      opensAt: string;
      closesAt: string;
    }
  /** No check-in at this event. */
  | { status: 'not_checked_in' }
  /** Checked in, but not confirmed in the last 45 minutes. */
  | { status: 'check_in_stale' };

/** The server's answer to a rating, tidied up. */
export type RatingResult =
  | {
      status: 'saved';
      /** true when it replaced an older rating of theirs. */
      updated: boolean;
      /** When it may be updated again (60 minutes after this save). */
      nextUpdateAt: string;
      /** This rating's own score, 0 to 10. */
      score: number;
      /** How many people's ratings count at this event now (incl. this one). */
      raters: number;
    }
  /** Saved less than 60 minutes ago. */
  | { status: 'too_soon'; minutesLeft: number; nextUpdateAt: string }
  | GateRefusal;

/** The server's answer to a +1, tidied up. */
export type HeadsUpResult = { status: 'added' } | { status: 'already' } | GateRefusal;

/** One tag's count on the event page. */
export interface HeadsUpCount {
  tag: HeadsUpTag;
  count: number;
  /** true when the guest has +1'd it themselves. */
  mine: boolean;
}

/**
 * Kinds of failure the screens treat differently. 'timeout' (Q8b): the
 * rating got no answer within 15 seconds, so we stopped waiting (if it was
 * saved anyway, the next try answers "too soon", never a second rating).
 */
export type RatingErrorKind =
  'notFound' | 'notAllowed' | 'staff' | 'badInput' | 'network' | 'timeout' | 'unknown';

/** A failed call: what kind, and a sentence to show. */
export type RatingFailure = { ok: false; kind: RatingErrorKind; message: string };

/** What {@link submitRating} returns. */
export type RatingOutcome = { ok: true; result: RatingResult } | RatingFailure;

/** What {@link addHeadsUp} returns. */
export type HeadsUpOutcome = { ok: true; result: HeadsUpResult } | RatingFailure;

/** What {@link getEventHeadsUps} returns. */
export type HeadsUpListOutcome = { ok: true; tags: HeadsUpCount[] } | RatingFailure;

/** The guest's own check-in and rating at one event. */
export interface MyRatingStatus {
  /** Their check-in, or null if they haven't checked in here. */
  checkIn: { method: 'gps' | 'code' | 'tester'; lastVerifiedAt: string } | null;
  /** When they last saved a rating here, or null if they haven't rated. */
  ratedAt: string | null;
}

/** What {@link getMyRatingStatus} returns. */
export type MyRatingStatusOutcome = { ok: true; status: MyRatingStatus } | RatingFailure;

/** Error codes the rating functions raise (see the migration). Keep in sync. */
export const RatingErrorCode = {
  notAllowed: '42501',
  notFound: 'VCNFD',
  staff: 'VCSTF',
  badRating: 'VCRAT',
  badTag: 'VCTAG',
} as const;

/** The general "something went wrong" sentence. */
const GENERIC_MESSAGE = "We couldn't save that. Please try again.";

/**
 * Reads the shared "not now" answers.
 *
 * @param value - the server's JSON answer.
 * @returns the refusal, or null if it isn't one of them.
 */
function parseGateRefusal(value: Record<string, unknown>): GateRefusal | null {
  switch (value.status) {
    case 'not_checked_in':
    case 'check_in_stale':
      return { status: value.status };
    case 'outside_window':
      return (value.reason === 'too_early' || value.reason === 'too_late') &&
        typeof value.opens_at === 'string' &&
        typeof value.closes_at === 'string'
        ? {
            status: 'outside_window',
            reason: value.reason,
            opensAt: value.opens_at,
            closesAt: value.closes_at,
          }
        : null;
    default:
      return null;
  }
}

/**
 * Reads submit_rating's JSON answer into a {@link RatingResult}.
 *
 * @param data - whatever the server returned.
 * @returns the tidy result, or null if the answer isn't one we know.
 */
export function parseRatingResult(data: unknown): RatingResult | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  switch (value.status) {
    case 'saved':
      return typeof value.next_update_at === 'string' &&
        typeof value.score === 'number' &&
        typeof value.raters === 'number'
        ? {
            status: 'saved',
            updated: value.updated === true,
            nextUpdateAt: value.next_update_at,
            score: value.score,
            raters: value.raters,
          }
        : null;
    case 'too_soon':
      return typeof value.next_update_at === 'string'
        ? {
            status: 'too_soon',
            // At least 1 minute, even if the number is missing or odd.
            minutesLeft:
              typeof value.minutes_left === 'number' && value.minutes_left >= 1
                ? Math.ceil(value.minutes_left)
                : 1,
            nextUpdateAt: value.next_update_at,
          }
        : null;
    default:
      return parseGateRefusal(value);
  }
}

/**
 * Reads add_heads_up's JSON answer into a {@link HeadsUpResult}.
 *
 * @param data - whatever the server returned.
 * @returns the tidy result, or null if the answer isn't one we know.
 */
export function parseHeadsUpResult(data: unknown): HeadsUpResult | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  if (value.status === 'added' || value.status === 'already') return { status: value.status };
  return parseGateRefusal(value);
}

/**
 * Reads get_event_heads_ups' JSON list.
 *
 * @param data - whatever the server returned.
 * @returns the counts, keeping the server's order (most +1s first) and
 *   skipping anything malformed or any tag this app doesn't know.
 */
export function parseHeadsUpList(data: unknown): HeadsUpCount[] {
  if (!Array.isArray(data)) return [];
  const counts: HeadsUpCount[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    // Only the nine current tags (VC-45): a retired or newer key is skipped,
    // even if a server ever sent one.
    if (typeof value.tag !== 'string' || !isHeadsUpTag(value.tag)) continue;
    if (typeof value.count !== 'number' || value.count < 1) continue;
    counts.push({ tag: value.tag, count: value.count, mine: value.mine === true });
  }
  return counts;
}

/**
 * Turns an error from the rating functions into a kind plus a sentence.
 *
 * @param error - the error from supabase-js (or one that was thrown).
 * @returns the kind of failure and a short message.
 */
export function describeRatingError(error: ErrorLike): { kind: RatingErrorKind; message: string } {
  if (/network request failed|failed to fetch/i.test(error.message ?? '')) {
    return {
      kind: 'network',
      message: "We couldn't reach the server. Check your connection and try again.",
    };
  }
  switch (error.code) {
    case RatingErrorCode.notFound:
      return { kind: 'notFound', message: "That event doesn't exist." };
    case RatingErrorCode.notAllowed:
      return { kind: 'notAllowed', message: 'Please sign in again, then try once more.' };
    case RatingErrorCode.staff:
      // The staff rule (VC-05): admins rate with a separate guest account.
      return { kind: 'staff', message: "Admins can't rate events. Use a guest account to rate." };
    case RatingErrorCode.badRating:
    case RatingErrorCode.badTag:
      // The server's own sentence is written for people ("Pick one option
      // in each row."), so show it as it is.
      return { kind: 'badInput', message: error.message || GENERIC_MESSAGE };
    default:
      return { kind: 'unknown', message: GENERIC_MESSAGE };
  }
}

/**
 * Sends the guest's rating.
 *
 * @param eventId - the event's id.
 * @param draft - the rating, with all three rows picked.
 * @returns the server's result, or an error kind and message. Never throws.
 */
export async function submitRating(eventId: string, draft: CompleteDraft): Promise<RatingOutcome> {
  try {
    // Parameter names match the SQL function's. Gives up after 15 seconds
    // (Q8b): Close is off while saving, so a hung request must not trap
    // the guest.
    const timed = await withTimeout((signal) =>
      supabase
        .rpc('submit_rating', {
          p_event_id: eventId,
          p_crowd: draft.crowd,
          p_music: draft.music,
          p_energy: draft.energy,
          p_reaction: draft.reaction,
          p_tags: draft.tags,
        })
        .abortSignal(signal),
    );
    if (timed.timedOut) return { ok: false, kind: 'timeout', message: TIMEOUT_MESSAGE };
    const { data, error } = timed.value;
    if (error) return { ok: false, ...describeRatingError(error) };
    const result = parseRatingResult(data);
    return result ? { ok: true, result } : { ok: false, kind: 'unknown', message: GENERIC_MESSAGE };
  } catch (thrown) {
    // supabase-js normally returns errors, but a dropped connection can throw.
    return { ok: false, ...describeRatingError(thrown as ErrorLike) };
  }
}

/**
 * Adds the guest's "+1" to one heads-up tag.
 *
 * @param eventId - the event's id.
 * @param tag - the tag.
 * @returns the server's result, or an error kind and message. Never throws.
 */
export async function addHeadsUp(eventId: string, tag: HeadsUpTag): Promise<HeadsUpOutcome> {
  try {
    const { data, error } = await supabase.rpc('add_heads_up', {
      p_event_id: eventId,
      p_tag: tag,
    });
    if (error) return { ok: false, ...describeRatingError(error) };
    const result = parseHeadsUpResult(data);
    return result ? { ok: true, result } : { ok: false, kind: 'unknown', message: GENERIC_MESSAGE };
  } catch (thrown) {
    return { ok: false, ...describeRatingError(thrown as ErrorLike) };
  }
}

/**
 * Reads the heads-up counts for the event page.
 *
 * @param eventId - the event's id.
 * @returns the counts (most first), or an error kind and message.
 */
export async function getEventHeadsUps(eventId: string): Promise<HeadsUpListOutcome> {
  try {
    const { data, error } = await supabase.rpc('get_event_heads_ups', { p_event_id: eventId });
    if (error) return { ok: false, ...describeRatingError(error) };
    return { ok: true, tags: parseHeadsUpList(data) };
  } catch (thrown) {
    return { ok: false, ...describeRatingError(thrown as ErrorLike) };
  }
}

/**
 * Reads the guest's own check-in and rating at one event.
 *
 * @param eventId - the event's id.
 * @returns both (each null when missing), or an error kind and message.
 * Why no "user id" filter: the tables' security rules (RLS) only ever
 * return the signed-in person's own rows, so filtering by event is enough.
 */
export async function getMyRatingStatus(eventId: string): Promise<MyRatingStatusOutcome> {
  try {
    const [checkIn, rating] = await Promise.all([
      supabase
        .from('check_ins')
        .select('method, last_verified_at')
        .eq('event_id', eventId)
        .maybeSingle(),
      supabase.from('ratings').select('updated_at').eq('event_id', eventId).maybeSingle(),
    ]);
    const error = checkIn.error ?? rating.error;
    if (error) {
      const described = describeRatingError(error);
      // A read failing is never "couldn't save"; say "couldn't load".
      return {
        ok: false,
        kind: described.kind,
        message:
          described.kind === 'network'
            ? described.message
            : "We couldn't load your check-in. Please try again.",
      };
    }
    const row = checkIn.data as { method: string; last_verified_at: string } | null;
    const rated = rating.data as { updated_at: string } | null;
    return {
      ok: true,
      status: {
        checkIn:
          row && (row.method === 'gps' || row.method === 'code' || row.method === 'tester')
            ? { method: row.method, lastVerifiedAt: row.last_verified_at }
            : null,
        ratedAt: rated?.updated_at ?? null,
      },
    };
  } catch (thrown) {
    return { ok: false, ...describeRatingError(thrown as ErrorLike) };
  }
}
