/**
 * Tests for the New event form rules (src/lib/event-form.ts), task VC-B04.
 *
 * These check the phone's copy of the server's rules: reading typed times,
 * "the end must be after the start", the 24-hour limit, the ticket-link
 * allowlist (VC-29), the 15-word summary, the street-address guard, and that
 * a good form becomes exactly the values `create_event` expects. The server
 * enforces the same rules again (pgTAP test 008_admin_events).
 */
import {
  END_BEFORE_START,
  isAllowedTicketUrl,
  looksLikeStreetAddress,
  parseTimeInput,
  validateEventForm,
  wordCount,
} from '@/lib/event-form';
import type { EventFormValues } from '@/lib/event-form';

// A fixed "now" (a Saturday afternoon) so the tests never depend on today.
const NOW = new Date(2026, 9, 31, 15, 0); // 31 October 2026, 3:00 PM local time

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
        p_starts_at: new Date(2026, 9, 31, 22, 0).toISOString(),
        p_ends_at: new Date(2026, 10, 1, 2, 0).toISOString(),
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
