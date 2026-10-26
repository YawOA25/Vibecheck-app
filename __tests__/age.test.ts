/**
 * Tests for the 18+ age maths (src/lib/age.ts), task VC-B03.
 *
 * These rules must match the server's (complete_profile in the database),
 * so several cases below are the same ones the pgTAP test
 * supabase/tests/database/006_complete_profile.test.sql checks.
 *
 * Moments in time are written in UTC ("...Z") so the tests give the same
 * answer on any computer, whatever its own time zone.
 */
import {
  ageOn,
  checkBirthdate,
  daysInMonth,
  isAtLeast18,
  isLeapYear,
  parseDateParts,
  toIsoDate,
  todayInZone,
} from '@/lib/age';
import type { CalendarDate } from '@/lib/age';

/** Shorthand: builds a calendar date from "YYYY-MM-DD". */
function d(iso: string): CalendarDate {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

describe('isAtLeast18 (same cases as the server test)', () => {
  // [birthdate, today, expected]
  const cases: [string, string, boolean][] = [
    ['2008-10-26', '2026-10-26', true], // 18th birthday today
    ['2008-10-27', '2026-10-26', false], // 17 years and 364 days
    ['1990-01-01', '2026-10-26', true], // clearly an adult
    ['2008-02-29', '2026-02-28', false], // leap-day baby, non-leap year: not yet on 28 Feb
    ['2008-02-29', '2026-03-01', true], // ...turns 18 on 1 March
    ['2010-02-28', '2028-02-29', true], // born 28 Feb, today is 29 Feb of a leap year
    ['2010-03-01', '2028-02-29', false], // born 1 March, still 17 on 29 Feb
    ['2008-02-29', '2026-02-27', false], // leap-day baby, two days short
  ];

  it.each(cases)('born %s, on %s -> %s', (birth, today, expected) => {
    expect(isAtLeast18(d(birth), d(today))).toBe(expected);
  });
});

describe('ageOn', () => {
  it('counts whole years and waits for the birthday', () => {
    expect(ageOn(d('2000-06-15'), d('2026-06-14'))).toBe(25);
    expect(ageOn(d('2000-06-15'), d('2026-06-15'))).toBe(26);
  });

  it('treats a 29 February birthday as reached on 1 March in non-leap years', () => {
    expect(ageOn(d('2000-02-29'), d('2026-02-28'))).toBe(25);
    expect(ageOn(d('2000-02-29'), d('2026-03-01'))).toBe(26);
    // In a leap year the real birthday exists.
    expect(ageOn(d('2000-02-29'), d('2028-02-29'))).toBe(28);
  });
});

describe('todayInZone (time zones)', () => {
  it('uses New York, not UTC: 02:00 UTC on 27 Oct is still 26 Oct in New York (summer time)', () => {
    expect(todayInZone(new Date('2026-10-27T02:00:00Z'))).toEqual(d('2026-10-26'));
    expect(todayInZone(new Date('2026-10-27T04:00:00Z'))).toEqual(d('2026-10-27'));
  });

  it('follows New York winter time (UTC-5) too', () => {
    expect(todayInZone(new Date('2027-01-15T04:59:00Z'))).toEqual(d('2027-01-14'));
    expect(todayInZone(new Date('2027-01-15T05:00:00Z'))).toEqual(d('2027-01-15'));
  });

  it('can be asked about another zone, which can be a different day', () => {
    // 20:00 UTC is already the next morning in Tokyo (UTC+9).
    const now = new Date('2026-10-26T20:00:00Z');
    expect(todayInZone(now, 'Asia/Tokyo')).toEqual(d('2026-10-27'));
    expect(todayInZone(now)).toEqual(d('2026-10-26'));
  });
});

describe('checkBirthdate (what the sign-up screen uses)', () => {
  it('refuses someone whose 18th birthday is tomorrow in New York, even if it is already tomorrow in UTC', () => {
    // 22:00 on 26 Oct in New York = 02:00 on 27 Oct in UTC.
    const lateEvening = new Date('2026-10-27T02:00:00Z');
    expect(checkBirthdate(d('2008-10-27'), lateEvening)).toBe('under18');
  });

  it('lets them in from midnight New York time on their birthday', () => {
    const midnight = new Date('2026-10-27T04:00:00Z');
    expect(checkBirthdate(d('2008-10-27'), midnight)).toBe('ok');
  });

  it('passes exactly 18 today and fails 17 years 364 days', () => {
    const noon = new Date('2026-10-26T16:00:00Z');
    expect(checkBirthdate(d('2008-10-26'), noon)).toBe('ok');
    expect(checkBirthdate(d('2008-10-27'), noon)).toBe('under18');
  });

  it('calls a future date or a year before 1900 invalid (same limits as the server)', () => {
    const noon = new Date('2026-10-26T16:00:00Z');
    expect(checkBirthdate(d('2026-10-27'), noon)).toBe('invalid');
    expect(checkBirthdate(d('1899-12-31'), noon)).toBe('invalid');
    expect(checkBirthdate(d('1900-01-01'), noon)).toBe('ok');
  });
});

describe('parseDateParts', () => {
  it('reads month, day and year, with or without leading zeros', () => {
    expect(parseDateParts('7', '4', '1999')).toEqual(d('1999-07-04'));
    expect(parseDateParts('07', '04', '1999')).toEqual(d('1999-07-04'));
    expect(parseDateParts(' 12 ', '31', '2000')).toEqual(d('2000-12-31'));
  });

  it('accepts 29 February only in leap years', () => {
    expect(parseDateParts('2', '29', '2008')).toEqual(d('2008-02-29'));
    expect(parseDateParts('2', '29', '2025')).toBeNull();
    expect(parseDateParts('2', '29', '1900')).toBeNull(); // century year, not a leap year
    expect(parseDateParts('2', '29', '2000')).toEqual(d('2000-02-29')); // every 400th is
  });

  it('refuses dates that do not exist or are typed wrong', () => {
    expect(parseDateParts('4', '31', '2000')).toBeNull(); // April has 30 days
    expect(parseDateParts('13', '1', '2000')).toBeNull();
    expect(parseDateParts('0', '1', '2000')).toBeNull();
    expect(parseDateParts('1', '0', '2000')).toBeNull();
    expect(parseDateParts('1', '1', '99')).toBeNull(); // 2-digit year
    expect(parseDateParts('', '1', '2000')).toBeNull();
    expect(parseDateParts('a', '1', '2000')).toBeNull();
  });
});

describe('small helpers', () => {
  it('knows leap years and month lengths', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('formats dates as YYYY-MM-DD for the database', () => {
    expect(toIsoDate(d('2008-02-09'))).toBe('2008-02-09');
    expect(toIsoDate({ year: 1999, month: 7, day: 4 })).toBe('1999-07-04');
  });
});
