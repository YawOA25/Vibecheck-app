/**
 * The Me screen's stats row (VC-81, founder approved 2026-10-29): your
 * "Nights out" and "Ratings" counts, and the "MEMBER SINCE OCT 2026" line.
 *
 * What it does (nothing here talks to the server; the call is in
 * src/lib/profile-stats-api.ts, so screen tests can fake it):
 *   - {@link parseStats} checks the server's answer and tidies it up;
 *   - {@link memberSinceText} writes the joined-on month the way the v3
 *     profile design shows it.
 *
 * The numbers are your own counts only, worked out by the server from your
 * own check-ins and ratings (migration 20261029120000_my_stats.sql). They
 * hold no event names, no scores and nobody else's data.
 */
import { newYorkDate } from '@/lib/tonight';

/** Short month names, January first (as on the v3 profile: "OCT"). */
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Your stats, tidied up. */
export interface MyStats {
  /** Different event nights you checked in to (two parties in a night count once). */
  nightsOut: number;
  /** Events you rated (a rating an admin hid isn't counted). */
  ratings: number;
  /** When your profile was made, or null if the server didn't say. */
  memberSince: Date | null;
}

/**
 * Reads a whole number that may not be negative.
 *
 * @param value - anything from the JSON.
 * @returns the number, or null if it isn't one.
 */
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Checks the server's stats answer.
 *
 * @param data - whatever get_my_stats returned.
 * @returns the stats, or null if the answer isn't one we understand (then
 *   the screen leaves the stats row out rather than showing wrong numbers).
 *   A missing or unreadable join date just leaves the "member since" line out.
 */
export function parseStats(data: unknown): MyStats | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  const nightsOut = count(value.nights_out);
  const ratings = count(value.ratings);
  if (nightsOut === null || ratings === null) return null;
  const since = typeof value.member_since === 'string' ? new Date(value.member_since) : null;
  return {
    nightsOut,
    ratings,
    memberSince: since && !Number.isNaN(since.getTime()) ? since : null,
  };
}

/**
 * The "member since" line under your name (v3 profile design).
 *
 * @param since - when the profile was made.
 * @returns e.g. "MEMBER SINCE OCT 2026", using the New York calendar (like
 *   every other date in the app), so a late-night sign-up on 31 October
 *   doesn't read as November on a phone set to another zone.
 */
export function memberSinceText(since: Date): string {
  const date = newYorkDate(since);
  return `MEMBER SINCE ${MONTHS[date.month - 1]} ${date.year}`;
}
