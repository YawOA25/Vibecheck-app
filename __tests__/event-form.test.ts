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
  ENTRY_URL_ERROR,
  isAllowedEntryUrl,
  isAllowedTicketUrl,
  looksLikeStreetAddress,
  momentOf,
  parseTimeInput,
  pickedParts,
  pickerStartingPoints,
  readableDateTime,
  STATE_REQUIRED,
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
    state: 'DC',
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
    entryUrl: '',
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
        p_state: 'DC',
        p_entry_url: null,
      },
    });
  });

  it('asks for the state on a new event (VC-37)', () => {
    const result = validateEventForm(form({ state: null }), NOW);
    expect(result).toEqual({ ok: false, errors: { state: STATE_REQUIRED } });
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

// ---- Native date and time pickers ------------------------------------------

describe('picker helpers', () => {
  it('reads a picked moment back as New York date and time text, on a Tokyo machine', () => {
    // 02:00 UTC on 1 Nov is 10 PM on Saturday 31 Oct in New York (EDT), and
    // already 11 AM on 1 Nov in Tokyo, where Jest runs.
    expect(pickedParts(new Date('2026-11-01T02:00:00Z'))).toEqual({
      date: '10 / 31 / 2026',
      time: '10 PM',
    });
  });

  it('round-trips through the form text to the same moment', () => {
    const moment = new Date('2026-11-08T03:30:00Z'); // Sat 7 Nov, 10:30 PM EST
    const { date, time } = pickedParts(moment);
    expect(momentOf(date, time)?.toISOString()).toBe(moment.toISOString());
    expect(momentOf(date, '')).toBeNull();
  });

  it('keeps the daylight-saving rules: 1:30 AM on 8 Mar 2026 is before the jump', () => {
    // New York jumps from 2 AM to 3 AM on 8 March 2026. 1:30 AM is EST (UTC-5).
    expect(momentOf('03 / 08 / 2026', '1:30 AM')?.toISOString()).toBe('2026-03-08T06:30:00.000Z');
    expect(momentOf('03 / 08 / 2026', '3:30 AM')?.toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('writes the chosen values as words', () => {
    expect(readableDateTime('11 / 07 / 2026', '10 PM')).toBe('Sat, Nov 7 · 10:00 PM');
    expect(readableDateTime('11 / 08 / 2026', '12:05 AM')).toBe('Sun, Nov 8 · 12:05 AM');
    expect(readableDateTime('11 / 07 / 2026', '')).toBe('Sat, Nov 7 · Pick a time');
    expect(readableDateTime('', '10 PM')).toBe('');
  });

  it('opens the start picker at 10 PM and the end picker 4 hours later', () => {
    // Saturday 7 November 2026 (standard time, UTC-5; away from the
    // 1 November clock change, where "1 AM" happens twice).
    const points = pickerStartingPoints(
      { startDate: '11 / 07 / 2026', startTime: '', endDate: '11 / 07 / 2026', endTime: '' },
      NOW,
    );
    expect(points.start.toISOString()).toBe('2026-11-08T03:00:00.000Z'); // 10 PM EST
    expect(points.end.toISOString()).toBe('2026-11-08T07:00:00.000Z'); // 2 AM EST
    // Picked values win.
    const picked = pickerStartingPoints(
      {
        startDate: '11 / 07 / 2026',
        startTime: '9 PM',
        endDate: '11 / 08 / 2026',
        endTime: '1 AM',
      },
      NOW,
    );
    expect(picked.start.toISOString()).toBe('2026-11-08T02:00:00.000Z');
    expect(picked.end.toISOString()).toBe('2026-11-08T06:00:00.000Z');
    // No start date at all: 10 PM tonight (NOW is Saturday 31 October, EDT).
    const blank = pickerStartingPoints(
      { startDate: '', startTime: '', endDate: '', endTime: '' },
      NOW,
    );
    expect(blank.start.toISOString()).toBe('2026-11-01T02:00:00.000Z');
  });
});

// ---- VC-40: the "How to get in" link ---------------------------------------

describe('isAllowedEntryUrl', () => {
  it.each([
    'https://partiful.com/e/abc123',
    'https://www.partiful.com/e/abc123',
    'https://posh.vip/e/rooftop',
    'https://lu.ma/abc',
    'https://luma.com/abc',
    'https://www.eventbrite.com/e/1',
    'https://dice.fm/event/xyz',
    'https://www.instagram.com/somehost/',
    'https://Partiful.COM',
    '  https://partiful.com/e/1  ',
  ])('allows %s', (url) => {
    expect(isAllowedEntryUrl(url)).toBe(true);
  });

  it.each([
    ['plain http', 'http://partiful.com/e/1'],
    ['ra.co (legal prep)', 'https://ra.co/events/1'],
    ['a name that only ends in the site', 'https://notpartiful.com/e/1'],
    ['the site as a prefix', 'https://partiful.com.evil.example/e/1'],
    ['the user@ trick', 'https://partiful.com@evil.example/e/1'],
    ['user:password', 'https://user:pw@partiful.com/e/1'],
    ['a port', 'https://partiful.com:8443/e/1'],
    ['a punycode name', 'https://xn--prtiful-cvb.com/e/1'],
    ['a punycode part on an allowed site', 'https://xn--80ak6aa92e.partiful.com/'],
    ['a Cyrillic look-alike letter', 'https://p\u0430rtiful.com/e/1'],
    ['a double dot', 'https://a..partiful.com/e/1'],
    ['a trailing dot', 'https://partiful.com./e/1'],
    ['a part starting with a dash', 'https://-x.partiful.com/'],
    ["Instagram's redirect service", 'https://l.instagram.com/?u=https://evil.example'],
    ['a space in the path', 'https://partiful.com/e/a b'],
    ['a ? right after the name', 'https://partiful.com?x=1'],
    ['javascript:', 'javascript:alert(1)'],
    ['over 500 characters', `https://partiful.com/${'a'.repeat(480)}`],
  ])('refuses %s', (_why, url) => {
    expect(isAllowedEntryUrl(url)).toBe(false);
  });
});

describe('the "How to get in" link on the form', () => {
  it("sends a host event's link, trimmed", () => {
    const result = validateEventForm(form({ entryUrl: ' https://partiful.com/e/1 ' }), NOW);
    expect(result.ok && result.input.p_entry_url).toBe('https://partiful.com/e/1');
  });

  it('shows the error under the box for a site that is not allowed', () => {
    const result = validateEventForm(form({ entryUrl: 'https://ra.co/events/1' }), NOW);
    expect(result).toEqual({ ok: false, errors: { entryUrl: ENTRY_URL_ERROR } });
  });

  it('drops the link for a staff pick (the box is hidden there)', () => {
    const result = validateEventForm(
      form({ isStaffPick: true, entryUrl: 'https://ra.co/not-even-checked' }),
      NOW,
    );
    expect(result.ok && result.input.p_entry_url).toBeNull();
  });
});
