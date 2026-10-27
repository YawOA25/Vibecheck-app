/**
 * Crash reports with Sentry (task VC-26).
 *
 * What it does: when the app hits an error it didn't expect (a crash, or a
 * bug that throws), Sentry sends a short report to the Sentry dashboard so we
 * find out about it without waiting for someone to complain. This file turns
 * Sentry on, decides what may be sent, and gives developers a "send a test
 * error" button.
 *
 * Privacy rules (legal VC-30 condition 5: the birthdate must never reach
 * error tracking or analytics):
 *   - Off unless EXPO_PUBLIC_SENTRY_DSN is set in .env. No DSN, no reports,
 *     and the app works exactly the same.
 *   - `sendDefaultPii: false`: Sentry does not attach the person's IP
 *     address, cookies or request bodies.
 *   - No name or email is ever attached; we don't call Sentry.setUser at all.
 *     If anything still sets a user, the scrubber keeps only its anonymous id.
 *   - Every report and every breadcrumb (the trail of recent events Sentry
 *     keeps, such as taps, network calls and console lines) goes through
 *     {@link scrubEvent} first. It deletes any field whose name looks like a
 *     birthdate, email, password, code, token or location (lat/lng), and
 *     blanks out emails, dates, long numbers and coordinates found inside text.
 *
 * In Expo Go only JavaScript errors are reported (Sentry's own code says
 * native crash capture needs a real build). That's enough for now; our own
 * builds (VC-B10) will add native crashes. Source maps (which turn the
 * minified code lines in a report back into our real file names) are not
 * uploaded yet: that needs a Sentry auth token and the Expo plugin, a later step.
 */
import * as Sentry from '@sentry/react-native';

/**
 * Field names we never send, compared word by word after splitting the name
 * (so "p_birthdate", "dateOfBirth", "check_in_code" and "p_lat" all match).
 *
 * Why each one:
 *   - birth/birthdate/birthday/dob: legal VC-30, the birthdate never leaves the age gate.
 *   - email: identifies the person.
 *   - password/passwd/code/otp/pin: sign-in codes and event check-in codes are secrets.
 *   - token/authorization/apikey: login tokens would let someone act as the user.
 *   - lat/lng/lon/latitude/longitude: where someone is (check-in GPS, VC-B06).
 */
const SENSITIVE_WORDS = new Set([
  'birth',
  'birthdate',
  'birthday',
  'dob',
  'email',
  'password',
  'passwd',
  'code',
  'otp',
  'pin',
  'token',
  'authorization',
  'apikey',
  'lat',
  'lng',
  'lon',
  'latitude',
  'longitude',
]);

/**
 * Names that contain a sensitive word but are safe and useful, so they are
 * kept (written with separators removed, as keyWords makes them):
 *   - statuscode: the HTTP status of a network call (200, 404, 500).
 *   - codefile/codeid: Sentry's own record of which app file a report came
 *     from; without them, source maps can't turn report lines back into our
 *     file names later.
 *   - versioncode: the Android app build number.
 */
const SAFE_KEYS = new Set(['statuscode', 'codefile', 'codeid', 'versioncode']);

/** Deepest we look inside nested objects; anything deeper is dropped. */
const MAX_DEPTH = 12;

/**
 * Splits a field name into lowercase words.
 *
 * @param key - a field name, for example "dateOfBirth", "p_birthdate" or "check-in-code".
 * @returns its words, for example ["date", "of", "birth"]. Glued words are also
 *   checked whole after removing separators, so "birthdate" stays "birthdate".
 */
function keyWords(key: string): string[] {
  const words = key
    // "dateOfBirth" -> "date Of Birth": a space before each capital after a lowercase letter.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  // Also the whole name with separators removed ("date_of_birth" -> "dateofbirth").
  return [...words, words.join('')];
}

/**
 * Says whether a field must never be sent.
 *
 * @param key - the field name.
 * @returns true when any word in the name is on the sensitive list, or the
 *   name contains "birth", "email" or "password" anywhere ("dateofbirth").
 *   Names on SAFE_KEYS (like status_code) are always allowed.
 */
export function isSensitiveKey(key: string): boolean {
  const words = keyWords(key);
  if (SAFE_KEYS.has(words[words.length - 1] ?? '')) return false;
  if (words.some((word) => SENSITIVE_WORDS.has(word))) return true;
  const joined = words[words.length - 1] ?? '';
  return /birth|email|password/.test(joined);
}

/**
 * Blanks out sensitive things that appear inside a piece of text, such as an
 * error message or a web address.
 *
 * @param text - any text.
 * @returns the text with:
 *   - web-address settings for sensitive names (?email=..., &code=...) emptied;
 *   - email addresses replaced by "[email]";
 *   - plain dates (2001-05-03, 05/03/2001, 05 / 03 / 2001 as typed in the
 *     age gate, 5/3/01, May 3, 2001) replaced by "[date]". Full timestamps like "2026-11-01T02:00:00Z" are
 *     kept because they are event times, which help debugging and are public;
 *   - 6 to 8 digit numbers (sign-in and check-in codes) replaced by "[number]";
 *   - decimal coordinates like 38.91234 replaced by "[coord]".
 */
export function scrubText(text: string): string {
  return (
    text
      // ?email=a@b.com or &p_birthdate=... in a web address: keep the name, drop the value.
      .replace(/([?&#])([^=&#\s]+)=([^&#\s]*)/g, (whole, sep: string, name: string) =>
        isSensitiveKey(name) ? `${sep}${name}=[Filtered]` : whole,
      )
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
      // Year first (2001-05-03, 2001/5/3, 2001.05.03). A date followed by "T"
      // is a full timestamp and is kept: "\b" can't sit between a digit and "T".
      .replace(/\b\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}\b(?!T)/g, '[date]')
      // Month or day first with a 4-digit year (05/03/2001, 05 / 03 / 2001, 5-3-2001).
      .replace(/\b\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{4}\b/g, '[date]')
      // Short year with slashes (5/3/01). Slashes only, so version numbers
      // like 0.79.12 are left alone.
      .replace(/\b\d{1,2}\/\d{1,2}\/\d{2}\b/g, '[date]')
      // Written-out dates (May 3, 2001; Thu May 03 2001; 3 May 2001).
      .replace(
        /\b(?:\d{1,2}\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?\d{4}\b/gi,
        '[date]',
      )
      .replace(/\b\d{6,8}\b/g, '[number]')
      // At least 4 decimal places: GPS precision. Short decimals (1.5 s) are kept.
      .replace(/-?\b\d{1,3}\.\d{4,}\b/g, '[coord]')
  );
}

/**
 * Makes a cleaned copy of any value: drops sensitive fields and scrubs text.
 *
 * @param value - any value from a Sentry report (objects, lists, text, numbers).
 * @param depth - how deep we are (stops runaway nesting).
 * @param seen - objects already visited, so a loop (a.b = a) can't hang the app.
 * @returns the cleaned copy. The original is left unchanged.
 */
function scrubValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > MAX_DEPTH || seen.has(value)) return '[Filtered]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1, seen));
  const copy: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    // Drop the field entirely (not just its value): the name alone is harmless,
    // but leaving nothing is simplest to check.
    if (isSensitiveKey(key)) continue;
    copy[key] = scrubValue(inner, depth + 1, seen);
  }
  return copy;
}

/**
 * Cleans a Sentry report or breadcrumb before it leaves the phone.
 *
 * @param item - a Sentry event (error report) or breadcrumb.
 * @returns a cleaned copy: sensitive fields removed, text scrubbed, and the
 *   user (if any) cut down to an anonymous id with no IP, email or name.
 */
export function scrubEvent<T extends object>(item: T): T {
  const cleaned = scrubValue(item, 0, new WeakSet()) as T & { user?: Record<string, unknown> };
  if (cleaned.user) {
    // Keep only the id. ip_address, email, username, geo and anything else go.
    const id = cleaned.user.id;
    if (typeof id === 'string' || typeof id === 'number') cleaned.user = { id };
    else delete cleaned.user;
  }
  return cleaned;
}

/** What {@link initSentry} needs; tests pass their own values. */
export interface SentrySetup {
  /** The project's DSN (the address reports are sent to). Missing = Sentry off. */
  dsn?: string;
  /** true in development (Expo Go on the founder's phone), false in store builds. */
  dev: boolean;
  /** The function that starts Sentry; tests pass a fake. */
  init?: (options: Sentry.ReactNativeOptions) => void;
}

/** true once Sentry has been started in this run of the app. */
let started = false;

/**
 * Starts Sentry, if a DSN is set. Call once, when the app starts.
 *
 * @param setup - the DSN, whether this is a development run, and (for tests)
 *   a stand-in for Sentry.init. By default it reads EXPO_PUBLIC_SENTRY_DSN
 *   from .env and React Native's __DEV__ flag.
 * @returns true when Sentry was started, false when it stays off (no DSN).
 */
export function initSentry(
  setup: SentrySetup = {
    // Expo copies EXPO_PUBLIC_ values into the app only when written out in
    // full like this, so don't rewrite it as process.env[name].
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    dev: __DEV__,
  },
): boolean {
  const dsn = setup.dsn?.trim();
  if (!dsn) {
    started = false;
    return false;
  }
  const init = setup.init ?? Sentry.init;
  init({
    dsn,
    // Shown in the dashboard so test errors from Expo Go are easy to tell
    // apart from real users' crashes.
    environment: setup.dev ? 'development' : 'production',
    // No IP address, cookies or request bodies (privacy, VC-30).
    sendDefaultPii: false,
    // No screenshots or screen layouts: they could show a birthdate or email
    // typed on screen. (Both are off by default; written out to be sure.)
    attachScreenshot: false,
    attachViewHierarchy: false,
    // iPhone view names can carry text; leave them out.
    reportAccessibilityIdentifier: false,
    // Crash reports only: no performance tracing, which keeps us on the free plan.
    tracesSampleRate: 0,
    // Every report and breadcrumb is cleaned before sending.
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubEvent(breadcrumb),
  });
  started = true;
  return true;
}

/**
 * Sends a test error to Sentry, so the founder can check reports arrive.
 * Only reachable in development (a long-press on the Tonight title).
 *
 * @returns true if the error was sent, false if Sentry is off (no DSN).
 */
export function sendTestError(): boolean {
  if (!started) return false;
  Sentry.captureException(new Error('VibeCheck test error (sent from the dev-only button)'));
  return true;
}
