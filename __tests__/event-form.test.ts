/**
 * Tests for the New event form rules (src/lib/event-form.ts), task VC-B04.
 *
 * These check the phone's copy of the server's rules: reading typed times,
 * "the end must be after the start", the 24-hour limit, the ticket-link
 * allowlist (VC-29), the 15-word summary, the street-address guard, and that
 * a good form becomes exactly the values `create_event` expects. The server
 * enforces the same rules again (pgTAP test 008_admin_events).
 *
 * Time zone: Jest runs with the machine set to Tokyo (jest.global-setup.js).
 * Typed times must still be read as New York time (VC-B04b), so every
 * expected moment below is written as an exact UTC instant, never with
 * `new Date(year, month, ...)`, which would use the machine's zone.
 */
import {
  dateInputFor,
  END_BEFORE_START,
  isAllowedTicketUrl,
  looksLikeStreetAddress,
  parseTimeInput,
  toEventMoment,
  validateEventForm,
  wordCount,
} from '@/lib/event-form';
import type { EventFormValues } from '@/lib/event-form';

// A fixed "now" (a Saturday afternoon) so the tests never depend on today.
// 19:00 UTC is 3:00 PM in New York (daylight time, 4 hours behind UTC).
const NOW = new Date('2026-10-31T19:00:00Z'); // Saturday 31 October 2026, 3:00 PM New York

/**
 * A complete, valid form, with any values swapped out.
 *
 * @param overrides - the values to change.
 * @returns form values for one test.
 */
function form(overrides: Partial<EventFormValues> = {}): EventFormValues {
  return {
    title: 'Saturday rooftop',
    areaLabel: 'Shaw, DC',
    startDate: '10 / 31 / 2026',
    startTime: '10:00 PM',
    endDate: '11 / 01 / 2026',
    endTime: '2:00 AM',
    radius: '150',
    codeEnabled: true,
    isTest: false,
    isStaffPick: false,
    is21Plus: false,
    ticketUrl: '',
    summary: '',
    pin: { lat: 38.91, lng: -77.02, accuracyM: 8 },
    ...overrides,
  };
}

describe('parseTimeInput', () => {
  it.each([
    ['10pm', { hour: 22, minute: 0 }],
    ['10:30 PM', { hour: 22, minute: 30 }],
    ['9:05am', { hour: 9, minute: 5 }],
    ['12 AM', { hour: 0, minute: 0 }], // midnight
    ['12pm', { hour: 12, minute: 0 }], // noon
    ['22:30', { hour: 22, minute: 30 }],
    ['0:15', { hour: 0, minute: 15 }],
    ['1030pm', { hour: 22, minute: 30 }],
  ])('reads %s', (text, expected) => {
    expect(parseTimeInput(text)).toEqual(expected);
  });

  it.each(['', '25:00', '13pm', '0am', '10:60', 'ten', '10:3'])('refuses %p', (text) => {
    expect(parseTimeInput(text)).toBeNull();
  });
});

describe('validateEventForm', () => {
  it('turns a good form into the create_event values', () => {
    const result = validateEventForm(
      form({
        title: '  Saturday rooftop ',
        isStaffPick: true,
        ticketUrl: 'https://www.eventbrite.com/e/123',
        summary: 'Afrobeats on the roof.',
      }),
      NOW,
    );
    expect(result).toEqual({
      ok: true,
      input: {
        p_title: 'Saturday rooftop',
        p_area_label: 'Shaw, DC',
        // 10:00 PM New York daylight time (UTC-4) on 31 October.
        p_starts_at: '2026-11-01T02:00:00.000Z',
        // 2:00 AM on 1 November: clocks went back at 2 AM daylight time, so
        // this is 2:00 AM standard time (UTC-5). The party lasts 5 real hours.
        p_ends_at: '2026-11-01T07:00:00.000Z',
        p_lat: 38.91,
        p_lng: -77.02,
        p_radius_m: 150,
        p_code_check_in_enabled: true,
        p_is_test: false,
        p_ticket_url: 'https://www.eventbrite.com/e/123',
        p_source: 'staff_pick',
        p_summary: 'Afrobeats on the roof.',
        p_is_21_plus: false,
      },
    });
  });

  it('sends empty optional fields as null and the source as host', () => {
    const result = validateEventForm(form(), NOW);
    expect(result.ok && result.input.p_ticket_url).toBeNull();
    expect(result.ok && result.input.p_summary).toBeNull();
    expect(result.ok && result.input.p_source).toBe('host');
  });

  it('refuses an end before the start (forgot to move the end date past midnight)', () => {
    const result = validateEventForm(form({ endDate: '10 / 31 / 2026' }), NOW);
    expect(result).toEqual({ ok: false, errors: { endTime: END_BEFORE_START } });
  });

  it('refuses an end equal to the start', () => {
    const result = validateEventForm(form({ endDate: '10 / 31 / 2026', endTime: '10:00 PM' }), NOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.endTime).toBe(END_BEFORE_START);
  });

  it('refuses an event longer than 24 hours', () => {
    const result = validateEventForm(form({ endDate: '11 / 02 / 2026' }), NOW);
    expect(!result.ok && result.errors.endDate).toMatch(/24 hours/);
  });

  it('refuses an event that is already over', () => {
    const result = validateEventForm(
      form({ startDate: '10 / 30 / 2026', endDate: '10 / 30 / 2026', endTime: '11:00 PM' }),
      NOW,
    );
    expect(!result.ok && result.errors.endTime).toMatch(/already passed/);
  });

  it('flags each unreadable or missing box', () => {
    const result = validateEventForm(
      form({
        title: ' ',
        areaLabel: '',
        startDate: '13 / 01 / 2026',
        startTime: 'late',
        pin: null,
        radius: '5000',
      }),
      NOW,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(
      ['areaLabel', 'pin', 'radius', 'startDate', 'startTime', 'title'].sort(),
    );
  });

  it('refuses a street address as the area', () => {
    const result = validateEventForm(form({ areaLabel: '1420 U St NW' }), NOW);
    expect(!result.ok && result.errors.areaLabel).toMatch(/neighbourhood/);
    // It also says where a venue name like "930 Club" belongs.
    expect(!result.ok && result.errors.areaLabel).toMatch(/930 Club\) goes in the event name/);
  });

  it('refuses a bad ticket link and a 16-word summary', () => {
    const result = validateEventForm(
      form({
        ticketUrl: 'http://www.eventbrite.com/e/1',
        summary:
          'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen',
      }),
      NOW,
    );
    expect(!result.ok && result.errors.ticketUrl).toBeDefined();
    expect(!result.ok && result.errors.summary).toBeDefined();
  });
});

describe('New York time, whatever the phone zone (VC-B04b)', () => {
  it('runs these tests with the machine clock in Tokyo', () => {
    // Guard: if globalSetup stopped forcing Tokyo, the tests below would pass
    // on a New York machine without proving anything. Tokyo is UTC+9 all year,
    // so JavaScript reports an offset of -540 minutes.
    expect(new Date('2026-10-31T19:00:00Z').getTimezoneOffset()).toBe(-540);
  });

  it('saves a typed "10:00 PM" as 10 PM in New York', () => {
    const result = validateEventForm(form({ endDate: '10 / 31 / 2026', endTime: '11:30 PM' }), NOW);
    expect(result.ok && result.input.p_starts_at).toBe('2026-11-01T02:00:00.000Z');
    expect(result.ok && result.input.p_ends_at).toBe('2026-11-01T03:30:00.000Z');
  });

  it('reads a party past midnight as the next New York morning', () => {
    // A normal weekend with no clock change: 10 PM Friday to 2 AM Saturday.
    const result = validateEventForm(
      form({ startDate: '11 / 06 / 2026', endDate: '11 / 07 / 2026' }),
      NOW,
    );
    // Standard time (UTC-5): 10 PM is 03:00 UTC, 2 AM is 07:00 UTC.
    expect(result.ok && result.input.p_starts_at).toBe('2026-11-07T03:00:00.000Z');
    expect(result.ok && result.input.p_ends_at).toBe('2026-11-07T07:00:00.000Z');
  });

  it('follows daylight saving: same 10 PM, different UTC hour', () => {
    // Summer (daylight, UTC-4) versus winter (standard, UTC-5).
    expect(toEventMoment({ year: 2026, month: 7, day: 4 }, { hour: 22, minute: 0 })).toEqual(
      new Date('2026-07-05T02:00:00Z'),
    );
    expect(toEventMoment({ year: 2026, month: 12, day: 5 }, { hour: 22, minute: 0 })).toEqual(
      new Date('2026-12-06T03:00:00Z'),
    );
  });

  it('handles the November repeat hour and the March missing hour', () => {
    // 1:30 AM happens twice on 1 November 2026; we take the first (daylight).
    expect(toEventMoment({ year: 2026, month: 11, day: 1 }, { hour: 1, minute: 30 })).toEqual(
      new Date('2026-11-01T05:30:00Z'),
    );
    // 2:30 AM never happens on 8 March 2026; it comes out as 1:30 AM standard.
    expect(toEventMoment({ year: 2026, month: 3, day: 8 }, { hour: 2, minute: 30 })).toEqual(
      new Date('2026-03-08T06:30:00Z'),
    );
    // 3:30 AM that morning is daylight time (UTC-4).
    expect(toEventMoment({ year: 2026, month: 3, day: 8 }, { hour: 3, minute: 30 })).toEqual(
      new Date('2026-03-08T07:30:00Z'),
    );
  });

  it("starts the date boxes on New York's date, not the phone's", () => {
    // 11 PM Saturday in New York is already Sunday afternoon in Tokyo.
    expect(dateInputFor(new Date('2026-11-01T03:00:00Z'))).toBe('10 / 31 / 2026');
    // 1 AM Sunday in New York: New York's date has moved on too.
    expect(dateInputFor(new Date('2026-11-01T05:00:00Z'))).toBe('11 / 01 / 2026');
  });
});

describe('isAllowedTicketUrl (VC-29)', () => {
  it.each([
    'https://www.eventbrite.com/e/123',
    'https://eventbrite.com',
    'https://EVENTBRITE.com/x',
  ])('allows %s', (url) => expect(isAllowedTicketUrl(url)).toBe(true));

  it.each([
    'http://www.eventbrite.com/e/1', // not https
    'https://evil.example/e/1', // not on the list
    'https://eventbrite.com@evil.example/e/1', // the "@" trick
    'https://eventbrite.com.evil.example/e/1', // look-alike
    'https://notevenbrite.com/e/1', // not a subdomain
    'javascript:alert(1)',
  ])('refuses %s', (url) => expect(isAllowedTicketUrl(url)).toBe(false));
});

describe('small helpers', () => {
  it('counts words like the server', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('  two   words ')).toBe(2);
  });

  it('spots a house number at the start of the area', () => {
    expect(looksLikeStreetAddress('1420 U St NW')).toBe(true);
    expect(looksLikeStreetAddress('14th Street corridor')).toBe(false);
    expect(looksLikeStreetAddress('Shaw, DC')).toBe(false);
  });
});
