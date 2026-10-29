/**
 * Age maths for the 18+ gate (task VC-B03, proposal VC-10).
 *
 * Why this file exists: the sign-up screen uses it to catch typing mistakes
 * (a future date, a year before 1900) before anything is sent. Since VC-30 it
 * does NOT stop an under-18 date on the age-gate screen: every real date
 * typed there goes to the server, which decides and records refusals (the
 * `complete_profile` function in supabase/migrations/..._age_gate_lock.sql).
 * Since VC-74 the FIRST sign-up screen (app/(auth)/sign-in.tsx) asks for
 * the date before any email and refuses under-18 dates on the phone itself,
 * so no email is ever collected from a minor there. These rules copy
 * the server's rules exactly so the two never disagree:
 *   - "18 or older" means the 18th birthday is today or earlier.
 *   - A 29 February birthday turns 18 on 1 March in a year with no 29 February
 *     (the stricter reading, so nobody gets in a day early).
 *   - "Today" is the calendar date in New York (America/New_York), because the
 *     MVP runs in the DMV. A phone in another time zone still uses New York's
 *     date, just like the server.
 *
 * Dates are handled as plain calendar dates (year, month, day) rather than
 * JavaScript `Date` objects, because a `Date` is a moment in time, and turning
 * it into a calendar day depends on the time zone. Keeping them apart avoids
 * the classic "off by one day" bug.
 */

/** The time zone whose calendar date the 18+ gate uses (same as the server). */
export const GATE_TIME_ZONE = 'America/New_York';

/** The minimum age to use VibeCheck. */
export const MINIMUM_AGE = 18;

/** The earliest birth year accepted. Catches typos such as "0026". Same as the server. */
export const EARLIEST_BIRTH_YEAR = 1900;

/** A calendar date with no time of day. month is 1-12 and day is 1-31. */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/**
 * Says whether a year is a leap year (has a 29 February).
 *
 * @param year - for example 2028.
 * @returns true for leap years. Rule: every 4th year, except century years,
 *   except every 400th year (so 2000 was a leap year and 1900 wasn't).
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Returns how many days a month has.
 *
 * @param year - needed because February has 29 days in leap years.
 * @param month - 1 (January) to 12 (December).
 * @returns 28, 29, 30 or 31.
 */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  // April, June, September and November have 30 days; the rest have 31.
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Turns what the person typed in the Month, Day and Year boxes into a date.
 *
 * @param month - text typed in the Month box, for example "7" or "07".
 * @param day - text typed in the Day box.
 * @param year - text typed in the Year box; must be 4 digits.
 * @returns the date, or null if it isn't a real calendar date (for example
 *   31 April, 29 February 2025, letters, or a 2-digit year).
 */
export function parseDateParts(month: string, day: string, year: string): CalendarDate | null {
  const m = month.trim();
  const d = day.trim();
  const y = year.trim();
  // Only digits allowed: 1-2 for month and day, exactly 4 for the year, so
  // "26" can't be read as the year 26.
  if (!/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d) || !/^\d{4}$/.test(y)) return null;

  const date = { year: Number(y), month: Number(m), day: Number(d) };
  if (date.month < 1 || date.month > 12) return null;
  if (date.day < 1 || date.day > daysInMonth(date.year, date.month)) return null;
  return date;
}

/**
 * Formats a date the way the database expects it: "YYYY-MM-DD".
 *
 * @param date - the calendar date.
 * @returns for example "2008-02-29".
 */
export function toIsoDate(date: CalendarDate): string {
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

/**
 * Works out the calendar date at a given moment in a given time zone.
 *
 * @param now - the moment, usually `new Date()`.
 * @param timeZone - an IANA time zone name; defaults to the gate's (New York).
 * @returns the calendar date there. Example: 2026-10-27 at 02:00 UTC is still
 *   26 October in New York.
 * Why: the phone's own time zone could differ from New York (a visitor, or a
 * phone set to the wrong zone). The server always uses New York, so we do too.
 */
export function todayInZone(now: Date, timeZone: string = GATE_TIME_ZONE): CalendarDate {
  try {
    // Intl.DateTimeFormat converts a moment into a date in any time zone.
    // formatToParts gives the year, month and day as separate pieces.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(now);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const result = { year: get('year'), month: get('month'), day: get('day') };
    if ([result.year, result.month, result.day].every(Number.isFinite)) return result;
  } catch {
    // Some very old phones lack time-zone data. Fall through to the backup below.
  }
  // Backup: the phone's own date. Only the instant answer on the phone could
  // be a day off; the server still decides with New York's date.
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/**
 * Compares two calendar dates.
 *
 * @returns a negative number if a is earlier, 0 if equal, positive if later.
 */
export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/**
 * Works out someone's age in whole years on a given day.
 *
 * @param birth - date of birth.
 * @param today - the day to measure on.
 * @returns the age, for example 17 or 18.
 * How: subtract the years, then take one off if this year's birthday hasn't
 * come yet. Comparing (month, day) pairs makes a 29 February birthday count as
 * "not yet" on 28 February and "passed" on 1 March, which matches the server.
 */
export function ageOn(birth: CalendarDate, today: CalendarDate): number {
  const birthdayNotYet =
    today.month < birth.month || (today.month === birth.month && today.day < birth.day);
  return today.year - birth.year - (birthdayNotYet ? 1 : 0);
}

/**
 * Says whether someone is 18 or older on a given day.
 *
 * @param birth - date of birth.
 * @param today - the day to check.
 * @returns true if 18 or older.
 */
export function isAtLeast18(birth: CalendarDate, today: CalendarDate): boolean {
  return ageOn(birth, today) >= MINIMUM_AGE;
}

/** The possible answers from {@link checkBirthdate}. */
export type BirthdateCheck = 'ok' | 'under18' | 'invalid';

/**
 * The full check run on a date of birth. The age-gate screen only acts on
 * 'invalid' (an 'under18' date is still sent so the server can lock the
 * login, VC-30); the first sign-up screen refuses 'under18' itself, before
 * any email is asked for (VC-74).
 *
 * @param birth - date of birth (already a real calendar date).
 * @param now - the current moment (passed in so tests can pick any moment).
 * @returns 'ok' (18 or older), 'under18', or 'invalid' (in the future, or
 *   before 1900: the same limits as the server).
 */
export function checkBirthdate(birth: CalendarDate, now: Date): BirthdateCheck {
  const today = todayInZone(now);
  if (birth.year < EARLIEST_BIRTH_YEAR || compareDates(birth, today) > 0) return 'invalid';
  return isAtLeast18(birth, today) ? 'ok' : 'under18';
}

/** The longest the date-of-birth box may get: "MM / DD / YYYY" is 14 characters. */
export const DATE_INPUT_MAX_LENGTH = 14;

/**
 * Formats what is typed in the single date-of-birth box (v3 design, spec
 * 2.3): keeps digits only, at most 8, and puts " / " between month, day and
 * year as the person types.
 *
 * A separator is added only once a digit follows it ("04" stays "04"; "041"
 * becomes "04 / 1"). That way pressing delete never gets stuck on a
 * separator that keeps coming back.
 *
 * @param text - what is in the box after a key press or paste.
 * @returns the tidied text, for example "04181998" -> "04 / 18 / 1998".
 */
export function formatDateInput(text: string): string {
  const digits = dateDigits(text);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)];
  return parts.filter((part) => part.length > 0).join(' / ');
}

/**
 * Pulls the digits out of the date-of-birth box.
 *
 * @param text - the box's text, for example "04 / 18 / 1998".
 * @returns up to 8 digits, for example "04181998".
 */
export function dateDigits(text: string): string {
  return text.replace(/\D/g, '').slice(0, 8);
}

/**
 * Turns the date-of-birth box's text into a calendar date.
 *
 * @param text - the box's text, for example "04 / 18 / 1998".
 * @returns the date, or null unless all 8 digits are there and form a real
 *   date (month 01-12, a day that month has).
 */
export function parseDateInput(text: string): CalendarDate | null {
  const digits = dateDigits(text);
  if (digits.length !== 8) return null;
  return parseDateParts(digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8));
}
