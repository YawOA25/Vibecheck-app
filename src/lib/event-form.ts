/**
 * Rules for the admin "New event" form (task VC-B04), kept apart from the
 * screen so they can be tested on their own.
 *
 * What it does: turns what the admin typed (text in boxes, switches, the GPS
 * pin) into the exact values `create_event` expects, or a list of friendly
 * error messages, one per box.
 *
 * Why the phone checks at all when the server checks everything again: so
 * the admin sees "The end must be after the start" under the right box
 * straight away, instead of after a round trip. The server's rules
 * (supabase/migrations/20261026180000_admin_events.sql) are the ones that
 * count; these copy them. If one changes, change both.
 */
import { formatDateInput, parseDateInput } from '@/lib/age';
import type { CalendarDate } from '@/lib/age';

/** Longest event name (same as the database rule). */
export const MAX_TITLE_LENGTH = 80;
/** Longest area label (same as the database rule). */
export const MAX_AREA_LENGTH = 60;
/** Most words allowed in our own summary (VC-29 legal condition). */
export const MAX_SUMMARY_WORDS = 15;
/** Most characters allowed in the summary (same as the database rule). */
export const MAX_SUMMARY_LENGTH = 120;
/** Check-in radius limits in metres, and the default (same as the database). */
export const MIN_RADIUS_M = 25;
export const MAX_RADIUS_M = 1000;
export const DEFAULT_RADIUS_M = 150;
/** Longest an event may last, in hours (catches a wrong end date). */
export const MAX_EVENT_HOURS = 24;

/**
 * Ticket sites a link may point to (VC-29). The server's list in
 * private.is_allowed_ticket_url is the one that counts.
 */
export const ALLOWED_TICKET_HOSTS = ['eventbrite.com'] as const;

/** A time of day typed by the admin, in 24-hour form. */
export interface TimeOfDay {
  /** 0 to 23. */
  hour: number;
  /** 0 to 59. */
  minute: number;
}

/** Where the admin's phone was when they tapped "Use my current location". */
export interface Pin {
  lat: number;
  lng: number;
  /** How sure the phone was, in metres (smaller is better). null for a typed pin. */
  accuracyM: number | null;
  /**
   * true when the pin was typed or pasted ("Enter location", used for staff
   * picks added from home, VC-29) rather than read from the phone's GPS.
   */
  typed?: boolean;
}

/** Everything on the form, as typed. */
export interface EventFormValues {
  title: string;
  areaLabel: string;
  /** "MM / DD / YYYY" */
  startDate: string;
  /** For example "10:00 PM" or "22:00". */
  startTime: string;
  endDate: string;
  endTime: string;
  /** Typed as text; must be a whole number of metres. */
  radius: string;
  codeEnabled: boolean;
  isTest: boolean;
  isStaffPick: boolean;
  is21Plus: boolean;
  /** Optional. */
  ticketUrl: string;
  /** Optional. */
  summary: string;
  /** null until "Use my current location" works. */
  pin: Pin | null;
}

/** The boxes that can show an error. */
export type EventFormField =
  | 'title'
  | 'areaLabel'
  | 'startDate'
  | 'startTime'
  | 'endDate'
  | 'endTime'
  | 'pin'
  | 'radius'
  | 'ticketUrl'
  | 'summary';

/** One message per box that has a problem. */
export type EventFormErrors = Partial<Record<EventFormField, string>>;

/** The values sent to the server function `create_event` (names match the SQL). */
export interface CreateEventInput {
  p_title: string;
  p_area_label: string;
  /** ISO 8601 moment, for example "2026-10-31T02:00:00.000Z". */
  p_starts_at: string;
  p_ends_at: string;
  p_lat: number;
  p_lng: number;
  p_radius_m: number;
  p_code_check_in_enabled: boolean;
  p_is_test: boolean;
  /** null when no link was given. */
  p_ticket_url: string | null;
  p_source: 'host' | 'staff_pick';
  p_summary: string | null;
  p_is_21_plus: boolean;
}

/** What {@link validateEventForm} returns: the values to send, or the errors. */
export type EventFormResult =
  { ok: true; input: CreateEventInput } | { ok: false; errors: EventFormErrors };

/** Shown under the end boxes when the end isn't after the start. */
export const END_BEFORE_START =
  'The end must be after the start. For a party past midnight, set the end date to the next day.';

/**
 * Reads a time of day the way people type it.
 *
 * @param text - for example "10pm", "10:30 PM", "9:05am" or "22:30".
 * @returns the time in 24-hour form, or null if it isn't a real time.
 * Rules: with AM/PM the hour must be 1-12 (12 AM is midnight, 12 PM is
 * noon); without it, the hour is 0-23 (24-hour clock). Minutes are optional.
 */
export function parseTimeInput(text: string): TimeOfDay | null {
  // Pieces: hour (1-2 digits), optional ":mm" (or "mm" right after), optional am/pm.
  const match = /^(\d{1,2})(?::?(\d{2}))?\s*([ap])\.?\s*(?:m\.?)?$|^(\d{1,2})(?::?(\d{2}))?$/i.exec(
    text.trim(),
  );
  if (!match) return null;
  const withMeridiem = match[1] !== undefined;
  const hourRaw = Number(withMeridiem ? match[1] : match[4]);
  const minute = Number((withMeridiem ? match[2] : match[5]) ?? '0');
  if (minute > 59) return null;
  if (!withMeridiem) {
    return hourRaw <= 23 ? { hour: hourRaw, minute } : null;
  }
  if (hourRaw < 1 || hourRaw > 12) return null;
  const isPm = match[3].toLowerCase() === 'p';
  // 12 AM -> 0 (midnight), 12 PM -> 12 (noon), 1 PM -> 13, and so on.
  const hour = (hourRaw % 12) + (isPm ? 12 : 0);
  return { hour, minute };
}

/**
 * Joins a calendar date and a time of day into one moment, in the phone's
 * own time zone (the admin is at the party, in the same zone as the guests).
 *
 * @param date - the calendar date.
 * @param time - the time of day.
 * @returns a JavaScript Date for that local moment.
 */
export function toLocalMoment(date: CalendarDate, time: TimeOfDay): Date {
  // JavaScript months start at 0 (January = 0), hence the "- 1".
  return new Date(date.year, date.month - 1, date.day, time.hour, time.minute, 0, 0);
}

/**
 * Formats a date for the date boxes, so the form can start on today.
 *
 * @param date - any moment; its local calendar day is used.
 * @returns for example "10 / 31 / 2026".
 */
export function dateInputFor(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return formatDateInput(`${pad(date.getMonth() + 1)}${pad(date.getDate())}${date.getFullYear()}`);
}

/**
 * Checks a ticket link the same way the server does (VC-29).
 *
 * @param url - the link as typed (spaces at the ends are ignored).
 * @returns true when it starts with https://, has a plain web address (no
 *   "@" tricks), is at most 500 characters, and is on an allowed site
 *   (eventbrite.com or one of its subdomains, like www.eventbrite.com).
 */
export function isAllowedTicketUrl(url: string): boolean {
  const value = url.trim();
  if (value.length > 500) return false;
  const match = /^https:\/\/([A-Za-z0-9.-]+)(\/\S*)?$/.exec(value);
  if (!match) return false;
  const host = match[1].toLowerCase();
  return ALLOWED_TICKET_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * Counts words the same way the server does.
 *
 * @param text - any text.
 * @returns the number of pieces separated by spaces; 0 for blank text.
 */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/**
 * The server's guard against typing a house address as the area.
 *
 * @param label - the area label.
 * @returns true when it starts with a number and a space, like "1420 U St".
 */
export function looksLikeStreetAddress(label: string): boolean {
  return /^\s*\d+\s/.test(label);
}

/**
 * Checks the whole form and builds the values for `create_event`.
 *
 * @param values - what is on the form.
 * @param now - the current moment (passed in so tests can choose it).
 * @returns `{ ok: true, input }` ready to send, or `{ ok: false, errors }`
 *   with one plain-English message per box that needs fixing.
 */
export function validateEventForm(values: EventFormValues, now: Date): EventFormResult {
  const errors: EventFormErrors = {};

  const title = values.title.trim();
  if (title.length < 1) errors.title = 'Give the event a name.';
  else if (title.length > MAX_TITLE_LENGTH)
    errors.title = `Keep the name to ${MAX_TITLE_LENGTH} characters.`;

  const areaLabel = values.areaLabel.trim();
  if (areaLabel.length < 1) errors.areaLabel = 'Add the area, like "Shaw, DC".';
  else if (areaLabel.length > MAX_AREA_LENGTH)
    errors.areaLabel = `Keep the area to ${MAX_AREA_LENGTH} characters.`;
  else if (looksLikeStreetAddress(areaLabel))
    errors.areaLabel =
      'Use the neighbourhood, not a street address. A venue name that starts with a number (like 930 Club) goes in the event name.';

  // Dates and times: each box is checked on its own first.
  const startDate = parseDateInput(values.startDate);
  const startTime = parseTimeInput(values.startTime);
  const endDate = parseDateInput(values.endDate);
  const endTime = parseTimeInput(values.endTime);
  if (!startDate) errors.startDate = 'Enter a real date, like 10 / 31 / 2026.';
  if (!startTime) errors.startTime = 'Enter a time, like 10:00 PM.';
  if (!endDate) errors.endDate = 'Enter a real date, like 10 / 31 / 2026.';
  if (!endTime) errors.endTime = 'Enter a time, like 2:00 AM.';

  // Then, if all four are readable, how they fit together.
  let startsAt: Date | null = null;
  let endsAt: Date | null = null;
  if (startDate && startTime && endDate && endTime) {
    startsAt = toLocalMoment(startDate, startTime);
    endsAt = toLocalMoment(endDate, endTime);
    const hours = (endsAt.getTime() - startsAt.getTime()) / 3_600_000;
    if (hours <= 0) errors.endTime = END_BEFORE_START;
    else if (hours > MAX_EVENT_HOURS)
      errors.endDate = `An event can last ${MAX_EVENT_HOURS} hours at most. Check the end date.`;
    else if (endsAt.getTime() <= now.getTime())
      errors.endTime = 'That end time has already passed. Check the date and AM/PM.';
  }

  if (!values.pin) errors.pin = 'Tap "Use my current location" while you are at the event.';

  // The radius must be a whole number in range ("150", not "150.5" or "abc").
  const radius = /^\d+$/.test(values.radius.trim()) ? Number(values.radius.trim()) : NaN;
  if (!(radius >= MIN_RADIUS_M && radius <= MAX_RADIUS_M))
    errors.radius = `Enter ${MIN_RADIUS_M} to ${MAX_RADIUS_M} metres.`;

  const ticketUrl = values.ticketUrl.trim();
  if (ticketUrl !== '' && !isAllowedTicketUrl(ticketUrl))
    errors.ticketUrl = 'Use an https:// link on eventbrite.com.';

  const summary = values.summary.trim();
  if (wordCount(summary) > MAX_SUMMARY_WORDS || summary.length > MAX_SUMMARY_LENGTH)
    errors.summary = `Keep it to ${MAX_SUMMARY_WORDS} words or fewer, in our own words.`;

  if (Object.keys(errors).length > 0 || !startsAt || !endsAt || !values.pin) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    input: {
      p_title: title,
      p_area_label: areaLabel,
      p_starts_at: startsAt.toISOString(),
      p_ends_at: endsAt.toISOString(),
      p_lat: values.pin.lat,
      p_lng: values.pin.lng,
      p_radius_m: radius,
      p_code_check_in_enabled: values.codeEnabled,
      p_is_test: values.isTest,
      p_ticket_url: ticketUrl === '' ? null : ticketUrl,
      p_source: values.isStaffPick ? 'staff_pick' : 'host',
      p_summary: summary === '' ? null : summary,
      p_is_21_plus: values.is21Plus,
    },
  };
}
