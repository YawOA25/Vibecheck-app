/**
 * Rules for the admin "New event" and "Edit event" forms (tasks VC-B04 and
 * VC-34), kept apart from the screens so they can be tested on their own.
 *
 * What it does: turns what the admin typed (text in boxes, switches, the GPS
 * pin) into the exact values `create_event` expects (or, when editing, just
 * the changes for `update_event`), or a list of friendly error messages, one
 * per box. It also fills the form from an existing event for editing.
 *
 * Why the phone checks at all when the server checks everything again: so
 * the admin sees "The end must be after the start" under the right box
 * straight away, instead of after a round trip. The server's rules
 * (supabase/migrations/20261026180000_admin_events.sql) are the ones that
 * count; these copy them. If one changes, change both.
 */
import { stateOfListedArea } from '@/data/dmv-areas';
import type { AreaState } from '@/data/dmv-areas';
import { formatDateInput, parseDateInput, todayInZone } from '@/lib/age';
import type { CalendarDate } from '@/lib/age';
import { formatClock, zonedMoment } from '@/lib/tonight';
import type { PublicEvent } from '@/lib/tonight';

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
  /**
   * DC, Maryland or Virginia (VC-37), chosen before the area. null until
   * picked (or guessed from the pin).
   */
  state: AreaState | null;
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
  | 'state'
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
  /** VC-37: 'DC', 'MD' or 'VA'. */
  p_state: AreaState;
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
 * Joins a calendar date and a time of day into one moment, read as New York
 * wall-clock time (America/New_York).
 *
 * @param date - the calendar date, in New York.
 * @param time - the time of day, in New York.
 * @returns a JavaScript Date for that moment.
 * Why New York and not the phone's zone: VibeCheck is a DC-area app and
 * every event day and time is New York time (src/lib/tonight.ts). If the
 * admin's phone is set to another zone (travelling, or set wrongly), typing
 * "10:00 PM" must still mean 10 PM at the party, not 10 PM wherever the
 * phone thinks it is. zonedMoment explains the daylight-saving edge cases.
 */
export function toEventMoment(date: CalendarDate, time: TimeOfDay): Date {
  return zonedMoment(date, time.hour, time.minute);
}

/**
 * Formats a date for the date boxes, so the form can start on today.
 *
 * @param date - any moment, usually now.
 * @returns New York's calendar date at that moment, for example
 *   "10 / 31 / 2026". At 11 PM in New York a phone set to Tokyo already shows
 *   the next day; the form must still start on New York's date.
 */
export function dateInputFor(date: Date): string {
  const today = todayInZone(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return formatDateInput(`${pad(today.month)}${pad(today.day)}${today.year}`);
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

/** What the form is for: making a new event, or editing one (VC-34). */
export type EventFormMode = 'create' | 'edit';

/** The pieces {@link checkEventForm} worked out, used to build the server call. */
interface CheckedForm {
  title: string;
  areaLabel: string;
  startsAt: Date;
  endsAt: Date;
  /** null in edit mode when the radius box was left empty ("keep"). */
  radius: number | null;
  ticketUrl: string;
  summary: string;
}

/**
 * Checks every box on the form. Shared by "New event" and "Edit event" so
 * the two can't drift apart.
 *
 * @param values - what is on the form.
 * @param now - the current moment.
 * @param mode - 'create' or 'edit'. Edit mode differs in three ways, each
 *   matching the server's update_event:
 *     - the pin may stay empty: it means "keep the current location" (the
 *       app can't read the old pin, so it can't show it);
 *     - the radius may be empty for the same reason ("keep");
 *     - an end time in the past is allowed (fixing a typo after the party is
 *       fine; only brand-new events must not be over already).
 * @returns the checked pieces, or one plain-English message per bad box.
 */
function checkEventForm(
  values: EventFormValues,
  now: Date,
  mode: EventFormMode,
): { ok: true; form: CheckedForm } | { ok: false; errors: EventFormErrors } {
  const errors: EventFormErrors = {};

  const title = values.title.trim();
  if (title.length < 1) errors.title = 'Give the event a name.';
  else if (title.length > MAX_TITLE_LENGTH)
    errors.title = `Keep the name to ${MAX_TITLE_LENGTH} characters.`;

  // The state (VC-37) is required for new events. When editing, an older
  // event may have none, and leaving it empty keeps it that way.
  if (mode === 'create' && !values.state) errors.state = 'Pick DC, Maryland or Virginia.';

  const areaLabel = values.areaLabel.trim();
  // The Area box only sets a value once a suggestion or "Use ..." is picked
  // (VC-37), so say how to finish, not just "add it".
  if (areaLabel.length < 1)
    errors.areaLabel = 'Add the area: start typing, then pick a match or "Use ...".';
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
    // Read the typed times as New York time, whatever zone the phone is in.
    startsAt = toEventMoment(startDate, startTime);
    endsAt = toEventMoment(endDate, endTime);
    const hours = (endsAt.getTime() - startsAt.getTime()) / 3_600_000;
    if (hours <= 0) errors.endTime = END_BEFORE_START;
    else if (hours > MAX_EVENT_HOURS)
      errors.endDate = `An event can last ${MAX_EVENT_HOURS} hours at most. Check the end date.`;
    else if (mode === 'create' && endsAt.getTime() <= now.getTime())
      errors.endTime = 'That end time has already passed. Check the date and AM/PM.';
  }

  if (mode === 'create' && !values.pin)
    errors.pin = 'Tap "Use my current location" while you are at the event.';

  // The radius must be a whole number in range ("150", not "150.5" or "abc").
  // In edit mode an empty box means "keep the current radius".
  const radiusText = values.radius.trim();
  let radius: number | null = null;
  if (!(mode === 'edit' && radiusText === '')) {
    radius = /^\d+$/.test(radiusText) ? Number(radiusText) : NaN;
    if (!(radius >= MIN_RADIUS_M && radius <= MAX_RADIUS_M))
      errors.radius = `Enter ${MIN_RADIUS_M} to ${MAX_RADIUS_M} metres.`;
  }

  const ticketUrl = values.ticketUrl.trim();
  if (ticketUrl !== '' && !isAllowedTicketUrl(ticketUrl))
    errors.ticketUrl = 'Use an https:// link on eventbrite.com.';

  const summary = values.summary.trim();
  if (wordCount(summary) > MAX_SUMMARY_WORDS || summary.length > MAX_SUMMARY_LENGTH)
    errors.summary = `Keep it to ${MAX_SUMMARY_WORDS} words or fewer, in our own words.`;

  if (Object.keys(errors).length > 0 || !startsAt || !endsAt) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    form: { title, areaLabel, startsAt, endsAt, radius, ticketUrl, summary },
  };
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
  const checked = checkEventForm(values, now, 'create');
  if (!checked.ok) return checked;
  // In create mode checkEventForm insists on a pin and a radius, so these
  // are always set here; the guard just keeps TypeScript sure of it.
  const { form } = checked;
  const radius = form.radius;
  if (!values.pin || radius === null || !values.state) return { ok: false, errors: {} };
  return {
    ok: true,
    input: {
      p_title: form.title,
      p_area_label: form.areaLabel,
      p_starts_at: form.startsAt.toISOString(),
      p_ends_at: form.endsAt.toISOString(),
      p_lat: values.pin.lat,
      p_lng: values.pin.lng,
      p_radius_m: radius,
      p_code_check_in_enabled: values.codeEnabled,
      p_is_test: values.isTest,
      p_ticket_url: form.ticketUrl === '' ? null : form.ticketUrl,
      p_source: values.isStaffPick ? 'staff_pick' : 'host',
      p_summary: form.summary === '' ? null : form.summary,
      p_is_21_plus: values.is21Plus,
      p_state: values.state,
    },
  };
}

// ---- Editing an event (VC-34) ----------------------------------------------

/**
 * What the Edit event form starts from: the event's public facts plus the
 * party-code switch. Read with getEventForEdit (src/lib/events-api.ts).
 * The pin, radius and party code are NOT included: they live in
 * event_private, which no app user can read (VC-20).
 */
export interface EditableEvent extends PublicEvent {
  code_check_in_enabled: boolean;
  /** VC-37: 'DC', 'MD' or 'VA', or null for events made before it. */
  state: AreaState | null;
}

/**
 * The values sent to `update_event` (names match the SQL). Only the event id
 * is always there. Every other field is sent only when the admin changed
 * it; a missing field means "keep what's there" (the server reads a missing
 * value as null = keep). For the ticket link and summary, an empty string
 * means "remove it".
 */
export interface UpdateEventInput {
  p_event_id: string;
  p_title?: string;
  p_area_label?: string;
  p_starts_at?: string;
  p_ends_at?: string;
  p_lat?: number;
  p_lng?: number;
  p_radius_m?: number;
  p_code_check_in_enabled?: boolean;
  p_is_test?: boolean;
  p_ticket_url?: string;
  p_source?: 'host' | 'staff_pick';
  p_summary?: string;
  p_is_21_plus?: boolean;
  /** VC-37: 'DC', 'MD' or 'VA'. */
  p_state?: AreaState;
}

/** What {@link validateEventEdit} returns: the changes to send, or the errors. */
export type EventEditResult =
  { ok: true; input: UpdateEventInput; changed: boolean } | { ok: false; errors: EventFormErrors };

/**
 * Formats a moment for the time boxes, in New York time.
 *
 * @param date - the moment.
 * @returns for example "10 PM" or "9:30 PM", which parseTimeInput reads
 *   back to the same time. New York, never the phone's zone (B04/B05 rule).
 */
export function timeInputFor(date: Date): string {
  return formatClock(date);
}

/**
 * Fills the form from an existing event, for the Edit event screen.
 *
 * @param event - the event as read by getEventForEdit.
 * @returns form values: name, area, New York dates and times, switches,
 *   ticket link and summary as stored. The pin starts empty and the radius
 *   box starts empty: both mean "keep the current one" (the app can't read
 *   them), and the admin can set new ones.
 */
export function valuesFromEvent(event: EditableEvent): EventFormValues {
  const startsAt = new Date(event.starts_at);
  const endsAt = new Date(event.ends_at);
  return {
    title: event.title,
    // An older event with no saved state gets one from its area when the
    // area is on the list ("Shaw, DC" -> DC); saving then fills it in.
    state: event.state ?? stateOfListedArea(event.area_label),
    areaLabel: event.area_label,
    startDate: dateInputFor(startsAt),
    startTime: timeInputFor(startsAt),
    endDate: dateInputFor(endsAt),
    endTime: timeInputFor(endsAt),
    radius: '',
    codeEnabled: event.code_check_in_enabled,
    isTest: event.is_test,
    isStaffPick: event.source === 'staff_pick',
    is21Plus: event.is_21_plus,
    ticketUrl: event.ticket_url ?? '',
    summary: event.summary ?? '',
    pin: null,
  };
}

/**
 * Checks the Edit event form and works out what changed.
 *
 * @param values - what is on the form now.
 * @param original - the event as it was loaded.
 * @param now - the current moment.
 * @returns `{ ok: true, input, changed }`: the update_event values holding
 *   only the changed fields (changed = false when nothing did), or the
 *   errors per box.
 * Why only changed fields: update_event keeps anything not sent. Sending
 * only changes means (1) the test flag is only sent when the admin flips it,
 * so the "people have checked in" lock (VCTST) only speaks up when it
 * matters, and (2) two admins editing different fields don't undo each
 * other's work.
 * Times: a time is sent only when its boxes were edited AND the moment
 * really moved, so re-typing "10 PM" as "10:00 PM" is no change, and an
 * event stored with seconds (made by SQL) isn't rounded to the minute.
 */
export function validateEventEdit(
  values: EventFormValues,
  original: EditableEvent,
  now: Date,
): EventEditResult {
  const checked = checkEventForm(values, now, 'edit');
  if (!checked.ok) return checked;
  const { form } = checked;
  const before = valuesFromEvent(original);
  const input: UpdateEventInput = { p_event_id: original.id };

  if (form.title !== original.title) input.p_title = form.title;
  if (form.areaLabel !== original.area_label) input.p_area_label = form.areaLabel;
  const startEdited =
    values.startDate !== before.startDate || values.startTime !== before.startTime;
  if (startEdited && form.startsAt.getTime() !== new Date(original.starts_at).getTime())
    input.p_starts_at = form.startsAt.toISOString();
  const endEdited = values.endDate !== before.endDate || values.endTime !== before.endTime;
  if (endEdited && form.endsAt.getTime() !== new Date(original.ends_at).getTime())
    input.p_ends_at = form.endsAt.toISOString();
  // A new pin replaces the old one; no pin keeps it.
  if (values.pin) {
    input.p_lat = values.pin.lat;
    input.p_lng = values.pin.lng;
  }
  if (form.radius !== null) input.p_radius_m = form.radius;
  if (values.codeEnabled !== original.code_check_in_enabled)
    input.p_code_check_in_enabled = values.codeEnabled;
  if (values.isTest !== original.is_test) input.p_is_test = values.isTest;
  if (values.is21Plus !== original.is_21_plus) input.p_is_21_plus = values.is21Plus;
  if (values.state && values.state !== original.state) input.p_state = values.state;
  const source = values.isStaffPick ? 'staff_pick' : 'host';
  if (source !== original.source) input.p_source = source;
  // '' is sent on purpose when a link or summary was removed: the server
  // reads an empty string as "remove it".
  if (form.ticketUrl !== (original.ticket_url ?? '')) input.p_ticket_url = form.ticketUrl;
  if (form.summary !== (original.summary ?? '')) input.p_summary = form.summary;

  return { ok: true, input, changed: Object.keys(input).length > 1 };
}
