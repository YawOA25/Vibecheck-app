/**
 * Tests for the Tonight date and time helpers (src/lib/tonight.ts), VC-B05.
 *
 * Two rules are under test:
 *   1. Days and clock times are New York's, whatever the phone's time zone.
 *      To prove it, Jest runs with the machine's zone set to Tokyo
 *      (jest.global-setup.js), 13-14 hours ahead of New York: if any
 *      helper used the phone's clock, the answers would be wrong.
 *   2. A night runs until 5 AM New York (NIGHT_ENDS_HOUR), so 1 AM Sunday is
 *      still "Saturday night".
 *
 * Every moment is written in UTC with Date.UTC (months count from 0, so 9
 * is October), with the New York time next to it in a comment. New York is
 * UTC-4 in summer time (EDT) and UTC-5 in winter time (EST). In 2026 summer
 * time starts on Sunday 8 March at 2 AM and ends on Sunday 1 November at 2 AM.
 */

import {
  dayLabel,
  formatClock,
  groupByDay,
  isStaffPick,
  NIGHT_ENDS_HOUR,
  nightStart,
  timeRange,
  tonightKicker,
  tonightWindow,
  whenLine,
} from '@/lib/tonight';
import type { PublicEvent } from '@/lib/tonight';

/** Shorthand for a UTC moment: utc(2026, 9, 31, 20) is 31 Oct 2026 20:00 UTC. */
const utc = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(Date.UTC(y, m, d, h, min));

// Saturday 31 October 2026, 8:00 PM New York (EDT) = 1 Nov 00:00 UTC.
const SAT_8PM = utc(2026, 10, 1, 0);
// Sunday 1 November 2026, 1:00 AM New York (still EDT) = 05:00 UTC.
const SUN_1AM = utc(2026, 10, 1, 5);

/**
 * Makes a test event between two moments.
 *
 * @param id - the event's id.
 * @param starts - start moment.
 * @param ends - end moment.
 * @returns a PublicEvent with simple defaults for everything else.
 */
function makeEvent(id: string, starts: Date, ends: Date): PublicEvent {
  return {
    id,
    title: `Event ${id}`,
    area_label: 'Shaw, DC',
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    source: 'host',
    ticket_url: null,
    summary: null,
    is_21_plus: false,
    is_test: false,
  };
}

describe('the test setup', () => {
  it('really runs with the phone in Tokyo (UTC+9)', () => {
    expect(utc(2026, 0, 1, 0).getHours()).toBe(9);
  });

  it('uses a 5 AM night cutoff', () => {
    expect(NIGHT_ENDS_HOUR).toBe(5);
  });
});

describe('formatClock (New York time)', () => {
  it('shows New York time, not the phone (Tokyo) time', () => {
    // 1 Nov 01:00 UTC = Sat 9 PM in New York (10 AM Sunday in Tokyo).
    expect(formatClock(utc(2026, 10, 1, 1))).toBe('9 PM');
    expect(formatClock(utc(2026, 10, 1, 1, 30))).toBe('9:30 PM');
  });

  it('writes midnight as 12 AM and noon as 12 PM', () => {
    expect(formatClock(utc(2026, 10, 1, 4))).toBe('12 AM'); // midnight EDT
    expect(formatClock(utc(2026, 9, 31, 16))).toBe('12 PM'); // noon EDT
  });

  it('follows the November change: 1:30 AM happens twice', () => {
    expect(formatClock(utc(2026, 10, 1, 5, 30))).toBe('1:30 AM'); // first time, EDT
    expect(formatClock(utc(2026, 10, 1, 6, 30))).toBe('1:30 AM'); // second time, EST
    expect(formatClock(utc(2026, 10, 1, 7))).toBe('2 AM'); // EST
  });

  it('follows the March change: 2 AM is skipped', () => {
    expect(formatClock(utc(2026, 2, 8, 6, 59))).toBe('1:59 AM'); // EST
    expect(formatClock(utc(2026, 2, 8, 7))).toBe('3 AM'); // EDT starts
  });
});

describe('tonightKicker', () => {
  it('names tonight by New York weekday', () => {
    // Already Sunday 9 AM in Tokyo, but Saturday evening in New York.
    expect(tonightKicker(SAT_8PM)).toBe('SATURDAY NIGHT');
  });

  it('still says SATURDAY NIGHT at 1 AM on Sunday', () => {
    expect(tonightKicker(SUN_1AM)).toBe('SATURDAY NIGHT');
  });

  it('switches to the new day at 5 AM', () => {
    // Sunday 4:59 AM EST = 09:59 UTC; Sunday 5:00 AM EST = 10:00 UTC.
    expect(tonightKicker(utc(2026, 10, 1, 9, 59))).toBe('SATURDAY NIGHT');
    expect(tonightKicker(utc(2026, 10, 1, 10))).toBe('SUNDAY NIGHT');
  });
});

describe('nightStart and tonightWindow across daylight-saving changes', () => {
  it('November (summer time ends): nights start at 5 AM EST', () => {
    // Tonight (Saturday) began Sat 5 AM EDT = 09:00 UTC.
    expect(nightStart(SAT_8PM, 0)).toEqual(utc(2026, 9, 31, 9));
    // Sunday 5 AM EST = 10:00 UTC (the clocks went back at 2 AM).
    expect(nightStart(SAT_8PM, 1)).toEqual(utc(2026, 10, 1, 10));
    // The list runs until Monday 5 AM EST = Mon 10:00 UTC.
    expect(tonightWindow(SAT_8PM)).toEqual({
      endsAfter: SAT_8PM,
      startsBefore: utc(2026, 10, 2, 10),
    });
  });

  it('November, at 1 AM Sunday: tonight is still Saturday night', () => {
    expect(nightStart(SUN_1AM, 0)).toEqual(utc(2026, 9, 31, 9));
    expect(tonightWindow(SUN_1AM).startsBefore).toEqual(utc(2026, 10, 2, 10));
  });

  it('March (summer time starts): nights start at 5 AM EDT', () => {
    // Saturday 7 March 2026, 8 PM EST = 8 Mar 01:00 UTC.
    const marchSat = utc(2026, 2, 8, 1);
    expect(tonightKicker(marchSat)).toBe('SATURDAY NIGHT');
    // Saturday 5 AM EST = 10:00 UTC; Sunday 5 AM EDT = 09:00 UTC.
    expect(nightStart(marchSat, 0)).toEqual(utc(2026, 2, 7, 10));
    expect(nightStart(marchSat, 1)).toEqual(utc(2026, 2, 8, 9));
    expect(tonightWindow(marchSat).startsBefore).toEqual(utc(2026, 2, 9, 9));
  });

  it('rolls over the end of the year', () => {
    // Thursday 31 Dec 2026, 10 PM EST = 1 Jan 2027 03:00 UTC.
    const newYearsEve = utc(2027, 0, 1, 3);
    expect(tonightKicker(newYearsEve)).toBe('THURSDAY NIGHT');
    expect(nightStart(newYearsEve, 1)).toEqual(utc(2027, 0, 1, 10));
  });
});

describe('dayLabel and whenLine', () => {
  // Sat 11 PM EDT (03:00 UTC) to Sun 3 AM EST (08:00 UTC): runs past midnight.
  const pastMidnight = makeEvent('p', utc(2026, 10, 1, 3), utc(2026, 10, 1, 8));

  it('a party running past midnight is "Today" before it starts...', () => {
    expect(whenLine(pastMidnight, SAT_8PM)).toBe('Today · 11 PM');
    expect(timeRange(pastMidnight, SAT_8PM)).toBe('Today · 11 PM – 3 AM');
  });

  it('...and "On now" at 1 AM, with its New York end time', () => {
    expect(dayLabel(pastMidnight, SUN_1AM)).toBe('On now');
    expect(whenLine(pastMidnight, SUN_1AM)).toBe('On now · until 3 AM');
  });

  it('a 1 AM start belongs to tonight, not tomorrow', () => {
    // Sun 1:30 AM EDT = 05:30 UTC, seen on Saturday at 8 PM.
    const lateStart = makeEvent('l', utc(2026, 10, 1, 5, 30), utc(2026, 10, 1, 9));
    expect(whenLine(lateStart, SAT_8PM)).toBe('Today · 1:30 AM');
  });

  it('says "Tomorrow" for tomorrow night, also when seen at 1 AM', () => {
    // Sun 10 PM EST = Mon 03:00 UTC.
    const sundayNight = makeEvent('s', utc(2026, 10, 2, 3), utc(2026, 10, 2, 7));
    expect(whenLine(sundayNight, SAT_8PM)).toBe('Tomorrow · 10 PM');
    expect(whenLine(sundayNight, SUN_1AM)).toBe('Tomorrow · 10 PM');
  });

  it('uses the weekday for nights further away', () => {
    // Mon 9 PM EST = Tue 02:00 UTC.
    const monday = makeEvent('m', utc(2026, 10, 3, 2), utc(2026, 10, 3, 5));
    expect(dayLabel(monday, SAT_8PM)).toBe('Monday');
  });
});

describe('groupByDay', () => {
  it('splits by night: a 1 AM start is Today, Sunday evening is Tomorrow', () => {
    const tonight = makeEvent('1', utc(2026, 10, 1, 2), utc(2026, 10, 1, 6)); // Sat 10 PM
    const oneAm = makeEvent('2', utc(2026, 10, 1, 5), utc(2026, 10, 1, 9)); // Sun 1 AM EDT
    const sunday = makeEvent('3', utc(2026, 10, 2, 3), utc(2026, 10, 2, 7)); // Sun 10 PM EST
    const sections = groupByDay([tonight, oneAm, sunday], SAT_8PM);
    expect(sections.map((s) => s.title)).toEqual(['Today', 'Tomorrow']);
    expect(sections[0].data.map((e) => e.id)).toEqual(['1', '2']);
    expect(sections[1].data.map((e) => e.id)).toEqual(['3']);
  });

  it('leaves out an empty section, and gives nothing for no events', () => {
    const sunday = makeEvent('3', utc(2026, 10, 2, 3), utc(2026, 10, 2, 7));
    expect(groupByDay([sunday], SAT_8PM).map((s) => s.title)).toEqual(['Tomorrow']);
    expect(groupByDay([], SAT_8PM)).toEqual([]);
  });
});

describe('fallback without time-zone data', () => {
  it("uses the phone's own clock if Intl can't convert time zones", () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new RangeError('no time-zone data');
    });
    try {
      // 1 Nov 01:00 UTC is 10 AM in Tokyo (the phone's zone in this file).
      expect(formatClock(utc(2026, 10, 1, 1))).toBe('10 AM');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('isStaffPick', () => {
  it('is true only for source staff_pick', () => {
    expect(isStaffPick({ source: 'staff_pick' })).toBe(true);
    expect(isStaffPick({ source: 'host' })).toBe(false);
  });
});
