/**
 * The app's calls to the server for moderation (proposals VC-47 and VC-58).
 *
 * What it does:
 *   - {@link reportHeadsUpTag}: the "Report this tag" button (any guest);
 *   - {@link getTagReports}: the admin report queue;
 *   - {@link getEventModeration} and {@link getEventTags}: what the admin
 *     screen lists for one event;
 *   - {@link setRatingHidden}, {@link setHeadsUpsHidden},
 *     {@link setTagHidden} and {@link keepTag}: the admin actions, each with
 *     a reason from the written rule (src/lib/moderation.ts).
 * Each one turns the server's answer into a tidy result, or a short message
 * to show. None of them throws.
 *
 * Why the server decides: who is an admin, the reason rule, the report rate
 * limit and the score republish all live in the database
 * (supabase/migrations/20261027160000_admin_moderation.sql and
 * 20261027160100_tag_reports.sql), so a changed app can't skip them.
 */
import type { ErrorLike } from '@/lib/auth-errors';
import type { ModerationReason } from '@/lib/moderation';
import { supabase } from '@/lib/supabase';

/** A failed call: a short sentence to show. */
export type ModerationFailure = { ok: false; message: string };

/** The answer to "Report this tag". */
export type ReportStatus = 'reported' | 'already' | 'too_many';

/** One row of the admin report queue (one event and tag). */
export interface TagReportGroup {
  eventId: string;
  eventTitle: string;
  eventStartsAt: string;
  /** The tag's key, e.g. 'overpriced'. */
  tag: string;
  /** How many open reports. */
  reports: number;
  /** Whole hours since the oldest open report. */
  hoursWaiting: number;
  /** 48 hours or more. */
  overdue: boolean;
  /** The tag's counted +1s at the event, all night. */
  votes: number;
  /** Already hidden at the event. */
  hidden: boolean;
}

/** One person's rating, as the admin sees it. */
export interface ModeratedRating {
  crowd: number;
  music: number;
  energy: number;
  score: number;
  reaction: string | null;
  updatedAt: string;
  hidden: boolean;
}

/** One person who rated or +1'd at an event. */
export interface ModeratedPerson {
  userId: string;
  displayName: string;
  joinedAt: string;
  checkInMethod: string | null;
  rating: ModeratedRating | null;
  /**
   * true while an admin has removed this person's +1s at the event. It
   * covers the whole event, so +1s they add later are removed too.
   */
  headsUpsRemoved: boolean;
  headsUps: { tag: string; removed: boolean }[];
}

/** One decision in the log. */
export interface ModerationLogEntry {
  at: string;
  action: string;
  reason: string;
  note: string | null;
  tag: string | null;
  adminName: string | null;
  targetName: string | null;
}

/** What the admin screen lists for one event. */
export interface EventModeration {
  people: ModeratedPerson[];
  log: ModerationLogEntry[];
}

/** One tag at an event, as the admin sees it. */
export interface EventTagState {
  tag: string;
  votes: number;
  hidden: boolean;
  openReports: number;
}

/** The answer to an admin action: 'unchanged' means it was already that way. */
export type ActionStatus = 'done' | 'unchanged';

/** The general "something went wrong" sentence. */
const GENERIC_MESSAGE = "That didn't work. Please try again.";

/**
 * Turns an error from the moderation functions into a sentence.
 *
 * @param error - the error from supabase-js (or one that was thrown).
 * @returns a short message to show.
 */
export function describeModerationError(error: ErrorLike): string {
  if (/network request failed|failed to fetch/i.test(error.message ?? '')) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  switch (error.code) {
    case '42501':
      return 'Only admins can do that. Sign in again if you are one.';
    case 'VCNFD':
      return "That isn't there any more. Pull down to refresh.";
    case 'VCTAG':
    case 'VCRSN':
      // The server's own sentence is written for people, so show it as it is.
      return error.message || GENERIC_MESSAGE;
    default:
      return GENERIC_MESSAGE;
  }
}

/**
 * Calls one server function and catches every kind of failure.
 *
 * @param name - the SQL function's name.
 * @param args - its arguments, named as in SQL.
 * @returns the raw data, or a failure with a sentence.
 */
async function call(
  name: string,
  args?: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | ModerationFailure> {
  try {
    const { data, error } = await supabase.rpc(name, args);
    if (error) return { ok: false, message: describeModerationError(error) };
    return { ok: true, data };
  } catch (thrown) {
    // supabase-js normally returns errors, but a dropped connection can throw.
    return { ok: false, message: describeModerationError(thrown as ErrorLike) };
  }
}

/**
 * Reads an object's "status" when it is one of the allowed words.
 *
 * @param data - the server's answer.
 * @param allowed - the statuses this call can return.
 * @returns the status, or null for anything else.
 */
function statusOf<T extends string>(data: unknown, allowed: readonly T[]): T | null {
  if (!data || typeof data !== 'object') return null;
  const status = (data as Record<string, unknown>).status;
  return allowed.includes(status as T) ? (status as T) : null;
}

/** A plain object or nothing. */
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Reads admin_get_tag_reports' list, skipping anything malformed.
 *
 * @param data - whatever the server returned.
 * @returns the queue rows in the server's order (oldest first).
 */
export function parseTagReports(data: unknown): TagReportGroup[] {
  if (!Array.isArray(data)) return [];
  const rows: TagReportGroup[] = [];
  for (const item of data) {
    const v = record(item);
    if (
      !v ||
      typeof v.event_id !== 'string' ||
      typeof v.event_title !== 'string' ||
      typeof v.tag !== 'string' ||
      typeof v.reports !== 'number' ||
      typeof v.hours_waiting !== 'number'
    ) {
      continue;
    }
    rows.push({
      eventId: v.event_id,
      eventTitle: v.event_title,
      eventStartsAt: typeof v.event_starts_at === 'string' ? v.event_starts_at : '',
      tag: v.tag,
      reports: v.reports,
      hoursWaiting: v.hours_waiting,
      overdue: v.overdue === true,
      votes: typeof v.votes === 'number' ? v.votes : 0,
      hidden: v.hidden === true,
    });
  }
  return rows;
}

/**
 * Reads one person's rating, if any.
 *
 * @param value - the "rating" part of the server's answer.
 * @returns the rating, or null when there is none (or it is malformed).
 */
function parseRating(value: unknown): ModeratedRating | null {
  const v = record(value);
  if (!v || typeof v.score !== 'number' || typeof v.updated_at !== 'string') return null;
  return {
    crowd: Number(v.crowd),
    music: Number(v.music),
    energy: Number(v.energy),
    score: v.score,
    reaction: typeof v.reaction === 'string' ? v.reaction : null,
    updatedAt: v.updated_at,
    hidden: v.hidden === true,
  };
}

/**
 * Reads admin_get_event_moderation's answer.
 *
 * @param data - whatever the server returned.
 * @returns the people and the log (each empty when missing or malformed).
 */
export function parseEventModeration(data: unknown): EventModeration {
  const v = record(data);
  const people: ModeratedPerson[] = [];
  const log: ModerationLogEntry[] = [];
  for (const item of Array.isArray(v?.people) ? v.people : []) {
    const p = record(item);
    if (!p || typeof p.user_id !== 'string' || typeof p.display_name !== 'string') continue;
    people.push({
      userId: p.user_id,
      displayName: p.display_name,
      joinedAt: typeof p.joined_at === 'string' ? p.joined_at : '',
      checkInMethod: typeof p.check_in_method === 'string' ? p.check_in_method : null,
      rating: parseRating(p.rating),
      headsUpsRemoved: p.heads_ups_removed === true,
      headsUps: (Array.isArray(p.heads_ups) ? p.heads_ups : [])
        .map(record)
        .filter((h): h is Record<string, unknown> => !!h && typeof h.tag === 'string')
        .map((h) => ({ tag: h.tag as string, removed: h.removed === true })),
    });
  }
  for (const item of Array.isArray(v?.log) ? v.log : []) {
    const l = record(item);
    if (!l || typeof l.at !== 'string' || typeof l.action !== 'string') continue;
    log.push({
      at: l.at,
      action: l.action,
      reason: typeof l.reason === 'string' ? l.reason : '',
      note: typeof l.note === 'string' ? l.note : null,
      tag: typeof l.tag === 'string' ? l.tag : null,
      adminName: typeof l.admin_name === 'string' ? l.admin_name : null,
      targetName: typeof l.target_name === 'string' ? l.target_name : null,
    });
  }
  return { people, log };
}

/**
 * Reads admin_get_event_tags' list.
 *
 * @param data - whatever the server returned.
 * @returns the tags in the server's order (most votes first).
 */
export function parseEventTags(data: unknown): EventTagState[] {
  if (!Array.isArray(data)) return [];
  return data
    .map(record)
    .filter((t): t is Record<string, unknown> => !!t && typeof t.tag === 'string')
    .map((t) => ({
      tag: t.tag as string,
      votes: typeof t.votes === 'number' ? t.votes : 0,
      hidden: t.hidden === true,
      openReports: typeof t.open_reports === 'number' ? t.open_reports : 0,
    }));
}

/**
 * Files the caller's report about one tag at one event.
 *
 * @param eventId - the event's id.
 * @param tag - the tag's key.
 * @returns the status, or a failure with a sentence. Never throws.
 */
export async function reportHeadsUpTag(
  eventId: string,
  tag: string,
): Promise<{ ok: true; status: ReportStatus } | ModerationFailure> {
  const outcome = await call('report_heads_up_tag', { p_event_id: eventId, p_tag: tag });
  if (!outcome.ok) return outcome;
  const status = statusOf(outcome.data, ['reported', 'already', 'too_many'] as const);
  return status ? { ok: true, status } : { ok: false, message: GENERIC_MESSAGE };
}

/**
 * Reads the admin report queue.
 *
 * @returns the open reports grouped per event and tag, or a failure.
 */
export async function getTagReports(): Promise<
  { ok: true; groups: TagReportGroup[] } | ModerationFailure
> {
  const outcome = await call('admin_get_tag_reports');
  return outcome.ok ? { ok: true, groups: parseTagReports(outcome.data) } : outcome;
}

/**
 * Reads everyone who rated or +1'd at an event, plus the decision log.
 *
 * @param eventId - the event's id.
 * @returns the lists, or a failure.
 */
export async function getEventModeration(
  eventId: string,
): Promise<{ ok: true; moderation: EventModeration } | ModerationFailure> {
  const outcome = await call('admin_get_event_moderation', { p_event_id: eventId });
  return outcome.ok ? { ok: true, moderation: parseEventModeration(outcome.data) } : outcome;
}

/**
 * Reads every tag with a +1, a report or a hide at an event.
 *
 * @param eventId - the event's id.
 * @returns the tags, or a failure.
 */
export async function getEventTags(
  eventId: string,
): Promise<{ ok: true; tags: EventTagState[] } | ModerationFailure> {
  const outcome = await call('admin_get_event_tags', { p_event_id: eventId });
  return outcome.ok ? { ok: true, tags: parseEventTags(outcome.data) } : outcome;
}

/** The arguments every admin action shares. */
export interface ActionInput {
  eventId: string;
  /** true to hide or remove, false to restore. */
  hidden: boolean;
  reason: ModerationReason;
  /** Optional admin-only note (empty means none). */
  note?: string;
}

/**
 * Sends one admin action and reads its status.
 *
 * @param name - the SQL function's name.
 * @param args - its arguments.
 * @returns 'done' or 'unchanged', or a failure.
 */
async function action(
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; status: ActionStatus } | ModerationFailure> {
  const outcome = await call(name, args);
  if (!outcome.ok) return outcome;
  const status = statusOf(outcome.data, ['done', 'unchanged'] as const);
  return status ? { ok: true, status } : { ok: false, message: GENERIC_MESSAGE };
}

/**
 * Turns an empty or blank note into "no note".
 *
 * @param note - what the admin typed.
 * @returns the trimmed note, or null.
 */
function noteOrNull(note: string | undefined): string | null {
  const trimmed = (note ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Hides or unhides one guest's rating (the server republishes the score).
 *
 * @param input - the event, hide or not, reason and note.
 * @param userId - the guest.
 * @returns 'done' or 'unchanged', or a failure. Never throws.
 */
export function setRatingHidden(input: ActionInput, userId: string) {
  return action('admin_set_rating_hidden', {
    p_event_id: input.eventId,
    p_user_id: userId,
    p_hidden: input.hidden,
    p_reason: input.reason,
    p_note: noteOrNull(input.note),
  });
}

/**
 * Removes or restores all of one guest's +1s at an event.
 *
 * @param input - the event, remove or not, reason and note.
 * @param userId - the guest.
 * @returns 'done' or 'unchanged', or a failure. Never throws.
 */
export function setHeadsUpsHidden(input: ActionInput, userId: string) {
  return action('admin_set_heads_ups_hidden', {
    p_event_id: input.eventId,
    p_user_id: userId,
    p_hidden: input.hidden,
    p_reason: input.reason,
    p_note: noteOrNull(input.note),
  });
}

/**
 * Hides or unhides one tag at one event.
 *
 * @param input - the event, hide or not, reason and note.
 * @param tag - the tag's key.
 * @returns 'done' or 'unchanged', or a failure. Never throws.
 */
export function setTagHidden(input: ActionInput, tag: string) {
  return action('admin_set_tag_hidden', {
    p_event_id: input.eventId,
    p_tag: tag,
    p_hidden: input.hidden,
    p_reason: input.reason,
    p_note: noteOrNull(input.note),
  });
}

/**
 * Closes a tag's open reports as "kept" (the tag stays visible).
 *
 * @param input - the event, reason and note (hidden is ignored).
 * @param tag - the tag's key.
 * @returns 'done' or 'unchanged', or a failure. Never throws.
 */
export function keepTag(input: ActionInput, tag: string) {
  return action('admin_keep_tag', {
    p_event_id: input.eventId,
    p_tag: tag,
    p_reason: input.reason,
    p_note: noteOrNull(input.note),
  });
}
