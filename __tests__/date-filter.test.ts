/**
 * Tests for the home list's date filter rules (src/lib/date-filter.ts), VC-63.
 *
 * For each filter we check which nights it covers and the exact time range
 * asked of the server, including the edges that are easy to get wrong:
 *   - "This weekend" on a weekday (the coming one), on Friday, at 2 AM on a
 *     Sunday and at 2 AM on a Monday (still the current weekend, because a
 *     night runs until 5 AM), and from 5 AM Monday (the next one);
 *   - daylight saving: in 2026 the clocks go back on Sunday 1 November and
 *     forward on Sunday 8 March, so 5 AM is 09:00 UTC on one side and
 *     10:00 UTC on the other;
 *   - "Tonight": just tonight, until 5 AM New York (also at 2 AM);
 *   - "Custom": one date (tonight, later, past), crossing a month, picked
 *     backwards, starting in the past, and cut to 60 nights;
 *   - the Custom flow (start date, optional end date) and the note shown
 *     after an admin creates an event the filter hides (VC-63b);
 *   - the words shown: titles, the small line above, the empty states.
 *
 * Moments are written in UTC with Date.UTC (months count from 0, so 10 is
 * November), with the New York time in a comment. Jest runs in Tokyo
 * (jest.global-setup.js), proving nothing uses the phone's own zone.
 */
import {
  FILTER_LABELS,
  FILTER_ORDER,
  MAX_RANGE_NIGHTS,
  THIS_WEEK,
  createdNotice,
  customFromDraft,
  draftFor,
  filterCoversNight,
  filterEmptyText,
  filterKicker,
  filterNights,
  filterTitle,
  filterWindow,
  latestEnd,
  pickEnd,
  pickStart,
} from '@/lib/date-filter';
import type { DateFilter } from '@/lib/date-filter';

/** Shorthand for a UTC moment: utc(2026, 10, 1, 0) is 1 Nov 2026 00:00 UTC. */
const utc = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(Date.UTC(y, m, d, h, min));

/** Shorthand for a calendar date (month 1-12, as people write it). */
const day = (year: number, month: number, d: number) => ({ year, month, day: d });

// Saturday 31 October 2026, 8 PM New York (EDT) = 1 Nov 00:00 UTC.
const SAT_8PM = utc(2026, 10, 1, 0);
// Tuesday 3 November 2026, 8 PM New York (EST) = 4 Nov 01:00 UTC.
const TUE_8PM = utc(2026, 10, 4, 1);

const WEEKEND: DateFilter = { kind: 'weekend' };
const TONIGHT: DateFilter = { kind: 'tonight' };

describe('the chips', () => {
  it('are Tonight, This weekend, This week, Custom, in that order', () => {
    expect(FILTER_ORDER.map((kind) => FILTER_LABELS[kind])).toEqual([
      'Tonight',
      'This weekend',
      'This week',
      'Custom',
    ]);
    expect(THIS_WEEK).toEqual({ kind: 'week' });
  });
});

describe('Tonight', () => {
  it('covers tonight only, up to 5 AM New York, keeping parties already going', () => {
    expect(filterNights(TONIGHT, SAT_8PM)).toEqual({
      first: day(2026, 10, 31),
      last: day(2026, 10, 31),
    });
    expect(filterWindow(TONIGHT, SAT_8PM)).toEqual({
      endsAfter: SAT_8PM,
      startsFrom: null,
      // Sunday 1 Nov, 5 AM EST (after the clocks went back) = 10:00 UTC.
      startsBefore: utc(2026, 10, 1, 10),
    });
    expect(filterTitle(TONIGHT, SAT_8PM)).toBe('Tonight');
    expect(filterKicker(TONIGHT, SAT_8PM)).toBe('SAT, OCT 31');
  });

  it('at 2 AM is still the night before (until 5 AM)', () => {
    // Wednesday 4 Nov, 2 AM EST = 07:00 UTC: still Tuesday night.
    const late = utc(2026, 10, 4, 7);
    expect(filterNights(TONIGHT, late).first).toEqual(day(2026, 11, 3));
    expect(filterWindow(TONIGHT, late).startsBefore).toEqual(utc(2026, 10, 4, 10));
  });

  it("from 5 AM is the new day's night", () => {
    // Wednesday 4 Nov, 5 AM EST = 10:00 UTC.
    expect(filterNights(TONIGHT, utc(2026, 10, 4, 10)).first).toEqual(day(2026, 11, 4));
  });
});

describe('This week', () => {
  it('covers tonight and the next 6 nights, with no start limit', () => {
    expect(filterNights(THIS_WEEK, SAT_8PM)).toEqual({
      first: day(2026, 10, 31),
      last: day(2026, 11, 6),
    });
    expect(filterWindow(THIS_WEEK, SAT_8PM)).toEqual({
      endsAfter: SAT_8PM,
      // Null: a party still going from earlier stays on the list.
      startsFrom: null,
      // Saturday 7 Nov, 5 AM EST = 10:00 UTC.
      startsBefore: utc(2026, 10, 7, 10),
    });
    expect(filterTitle(THIS_WEEK, SAT_8PM)).toBe('This week');
    expect(filterKicker(THIS_WEEK, SAT_8PM)).toBe('SATURDAY TO FRIDAY');
  });
});

describe('This weekend', () => {
  it('on a weekday, is the coming Friday to Sunday', () => {
    expect(filterNights(WEEKEND, TUE_8PM)).toEqual({
      first: day(2026, 11, 6),
      last: day(2026, 11, 8),
    });
    expect(filterWindow(WEEKEND, TUE_8PM)).toEqual({
      endsAfter: TUE_8PM,
      // Friday 6 Nov, 5 AM EST = 10:00 UTC.
      startsFrom: utc(2026, 10, 6, 10),
      // Monday 9 Nov, 5 AM EST.
      startsBefore: utc(2026, 10, 9, 10),
    });
    expect(filterTitle(WEEKEND, TUE_8PM)).toBe('This weekend');
    expect(filterKicker(WEEKEND, TUE_8PM)).toBe('FRI, NOV 6 – SUN, NOV 8');
  });

  it('late on Thursday (11 PM), is still the coming weekend', () => {
    // Thursday 5 Nov, 11 PM EST = 6 Nov 04:00 UTC.
    expect(filterNights(WEEKEND, utc(2026, 10, 6, 4)).first).toEqual(day(2026, 11, 6));
    expect(filterWindow(WEEKEND, utc(2026, 10, 6, 4)).startsFrom).toEqual(utc(2026, 10, 6, 10));
  });

  it('on Friday night, is this weekend, with no start limit', () => {
    // Friday 6 Nov, 9 PM EST = 7 Nov 02:00 UTC.
    const friday = utc(2026, 10, 7, 2);
    expect(filterNights(WEEKEND, friday)).toEqual({
      first: day(2026, 11, 6),
      last: day(2026, 11, 8),
    });
    expect(filterWindow(WEEKEND, friday).startsFrom).toBeNull();
  });

  it('at 2 AM on a Sunday (still Saturday night), is the current weekend', () => {
    // Sunday 8 Nov, 2 AM EST = 07:00 UTC.
    const sunday2am = utc(2026, 10, 8, 7);
    expect(filterNights(WEEKEND, sunday2am)).toEqual({
      first: day(2026, 11, 6),
      last: day(2026, 11, 8),
    });
    expect(filterWindow(WEEKEND, sunday2am)).toEqual({
      endsAfter: sunday2am,
      startsFrom: null,
      startsBefore: utc(2026, 10, 9, 10),
    });
  });

  it('at 2 AM on a Monday (still Sunday night), is still the current weekend', () => {
    // Monday 9 Nov, 2 AM EST = 07:00 UTC.
    expect(filterNights(WEEKEND, utc(2026, 10, 9, 7)).first).toEqual(day(2026, 11, 6));
  });

  it('from 5 AM Monday, is the next weekend', () => {
    // Monday 9 Nov, 5 AM EST = 10:00 UTC.
    expect(filterNights(WEEKEND, utc(2026, 10, 9, 10))).toEqual({
      first: day(2026, 11, 13),
      last: day(2026, 11, 15),
    });
  });

  it('follows the November clock change (Friday in EDT, Monday in EST)', () => {
    // Thursday 29 Oct, 8 PM EDT = 30 Oct 00:00 UTC.
    expect(filterWindow(WEEKEND, utc(2026, 9, 30, 0))).toEqual({
      endsAfter: utc(2026, 9, 30, 0),
      // Friday 30 Oct, 5 AM EDT = 09:00 UTC ...
      startsFrom: utc(2026, 9, 30, 9),
      // ... to Monday 2 Nov, 5 AM EST = 10:00 UTC.
      startsBefore: utc(2026, 10, 2, 10),
    });
  });
});

describe('Custom, one date', () => {
  it('covers one later night, from its 5 AM to the next 5 AM', () => {
    const sunday: DateFilter = { kind: 'custom', from: day(2026, 11, 8), to: day(2026, 11, 8) };
    expect(filterWindow(sunday, SAT_8PM)).toEqual({
      endsAfter: SAT_8PM,
      startsFrom: utc(2026, 10, 8, 10),
      startsBefore: utc(2026, 10, 9, 10),
    });
    expect(filterTitle(sunday, SAT_8PM)).toBe('Sun, Nov 8');
    expect(filterKicker(sunday, SAT_8PM)).toBe('SUNDAY NIGHT');
  });

  it('for tonight, keeps parties already going (no start limit)', () => {
    const tonight: DateFilter = { kind: 'custom', from: day(2026, 10, 31), to: day(2026, 10, 31) };
    expect(filterWindow(tonight, SAT_8PM)).toEqual({
      endsAfter: SAT_8PM,
      startsFrom: null,
      // Sunday 1 Nov, 5 AM EST (after the clocks went back) = 10:00 UTC.
      startsBefore: utc(2026, 10, 1, 10),
    });
  });

  it('never covers a night already past: it becomes tonight', () => {
    const past: DateFilter = { kind: 'custom', from: day(2026, 10, 20), to: day(2026, 10, 20) };
    expect(filterNights(past, SAT_8PM)).toEqual({
      first: day(2026, 10, 31),
      last: day(2026, 10, 31),
    });
  });
});

describe('Custom range', () => {
  it('can cross a month and reach past a week', () => {
    const range: DateFilter = { kind: 'custom', from: day(2026, 11, 28), to: day(2026, 12, 3) };
    expect(filterWindow(range, SAT_8PM)).toEqual({
      endsAfter: SAT_8PM,
      // Saturday 28 Nov, 5 AM EST = 10:00 UTC, to Friday 4 Dec, 5 AM EST.
      startsFrom: utc(2026, 10, 28, 10),
      startsBefore: utc(2026, 11, 4, 10),
    });
    expect(filterTitle(range, SAT_8PM)).toBe('Nov 28 – Dec 3');
    expect(filterKicker(range, SAT_8PM)).toBe('6 NIGHTS');
  });

  it('follows the March clock change', () => {
    // Sunday 1 March 2026, 8 PM EST = 2 Mar 01:00 UTC.
    const now = utc(2026, 2, 2, 1);
    const range: DateFilter = { kind: 'custom', from: day(2026, 3, 7), to: day(2026, 3, 9) };
    expect(filterWindow(range, now)).toEqual({
      endsAfter: now,
      // Saturday 7 March, 5 AM EST = 10:00 UTC ...
      startsFrom: utc(2026, 2, 7, 10),
      // ... to Tuesday 10 March, 5 AM EDT = 09:00 UTC.
      startsBefore: utc(2026, 2, 10, 9),
    });
  });

  it('puts a backwards range in order', () => {
    const backwards: DateFilter = { kind: 'custom', from: day(2026, 11, 10), to: day(2026, 11, 3) };
    expect(filterNights(backwards, SAT_8PM)).toEqual({
      first: day(2026, 11, 3),
      last: day(2026, 11, 10),
    });
  });

  it('starts no earlier than tonight', () => {
    const range: DateFilter = { kind: 'custom', from: day(2026, 10, 25), to: day(2026, 11, 2) };
    expect(filterNights(range, SAT_8PM)).toEqual({
      first: day(2026, 10, 31),
      last: day(2026, 11, 2),
    });
    expect(filterWindow(range, SAT_8PM).startsFrom).toBeNull();
  });

  it(`is cut to ${MAX_RANGE_NIGHTS} nights`, () => {
    expect(MAX_RANGE_NIGHTS).toBe(60);
    const huge: DateFilter = { kind: 'custom', from: day(2026, 11, 1), to: day(2027, 3, 1) };
    // 1 Nov + 59 days = 30 Dec: 60 nights counting both ends.
    expect(filterNights(huge, SAT_8PM)).toEqual({
      first: day(2026, 11, 1),
      last: day(2026, 12, 30),
    });
    expect(filterKicker(huge, SAT_8PM)).toBe('60 NIGHTS');
  });

  it('a one-night range reads like a single date', () => {
    const one: DateFilter = { kind: 'custom', from: day(2026, 11, 8), to: day(2026, 11, 8) };
    expect(filterTitle(one, SAT_8PM)).toBe('Sun, Nov 8');
    expect(filterKicker(one, SAT_8PM)).toBe('SUNDAY NIGHT');
  });
});

describe('empty states', () => {
  it('has its own words for each filter', () => {
    expect(filterEmptyText(THIS_WEEK, SAT_8PM).title).toBe('Nothing on this week yet');
    expect(filterEmptyText(WEEKEND, SAT_8PM).title).toBe('Nothing on this weekend yet');
    expect(filterEmptyText(TONIGHT, SAT_8PM).title).toBe('Nothing on tonight yet');
    const one = filterEmptyText(
      { kind: 'custom', from: day(2026, 11, 8), to: day(2026, 11, 8) },
      SAT_8PM,
    );
    expect(one.title).toBe('Nothing on Sun, Nov 8 yet');
    expect(one.body).toMatch(/^No events that night yet\./);
    expect(
      filterEmptyText({ kind: 'custom', from: day(2026, 11, 6), to: day(2026, 11, 15) }, SAT_8PM)
        .title,
    ).toBe('Nothing on Nov 6 – Nov 15 yet');
  });
});

describe('the Custom flow (start date, optional end date)', () => {
  const picked = { start: day(2026, 11, 6), end: day(2026, 11, 9) };

  it('starts from tonight with no end, or from the current Custom dates', () => {
    expect(draftFor(THIS_WEEK, SAT_8PM)).toEqual({ start: day(2026, 10, 31), end: null });
    expect(
      draftFor({ kind: 'custom', from: day(2026, 11, 6), to: day(2026, 11, 9) }, SAT_8PM),
    ).toEqual(picked);
    // One night: no end.
    expect(
      draftFor({ kind: 'custom', from: day(2026, 11, 6), to: day(2026, 11, 6) }, SAT_8PM),
    ).toEqual({ start: day(2026, 11, 6), end: null });
  });

  it('keeps the end when a new start still fits before it', () => {
    expect(pickStart(picked, day(2026, 11, 7))).toEqual({
      start: day(2026, 11, 7),
      end: day(2026, 11, 9),
    });
  });

  it('clears the end when the new start is on or after it, or too far before it', () => {
    expect(pickStart(picked, day(2026, 11, 9)).end).toBeNull();
    expect(pickStart(picked, day(2026, 11, 12)).end).toBeNull();
    const far = { start: day(2026, 11, 6), end: day(2027, 1, 3) };
    // 5 Nov to 3 Jan is 60 nights counting both ends: kept.
    expect(pickStart(far, day(2026, 11, 5)).end).toEqual(day(2027, 1, 3));
    // 4 Nov to 3 Jan would be 61: cleared.
    expect(pickStart(far, day(2026, 11, 4)).end).toBeNull();
  });

  it('an end on the start night (or before it) means one night', () => {
    expect(pickEnd(picked, day(2026, 11, 6)).end).toBeNull();
    expect(pickEnd(picked, day(2026, 11, 2)).end).toBeNull();
    expect(pickEnd(picked, day(2026, 11, 20)).end).toEqual(day(2026, 11, 20));
  });

  it('the latest end is 60 nights counting both ends', () => {
    expect(latestEnd(day(2026, 11, 1))).toEqual(day(2026, 12, 30));
  });

  it('turns the draft into a tidy Custom filter', () => {
    expect(customFromDraft(picked, SAT_8PM)).toEqual({
      kind: 'custom',
      from: day(2026, 11, 6),
      to: day(2026, 11, 9),
    });
    expect(customFromDraft({ start: day(2026, 11, 6), end: null }, SAT_8PM)).toEqual({
      kind: 'custom',
      from: day(2026, 11, 6),
      to: day(2026, 11, 6),
    });
    // A start already in the past becomes tonight.
    expect(customFromDraft({ start: day(2026, 10, 1), end: null }, SAT_8PM)).toEqual({
      kind: 'custom',
      from: day(2026, 10, 31),
      to: day(2026, 10, 31),
    });
  });
});

describe('after creating an event (VC-63b)', () => {
  // Friday 13 Nov 2026, 10 PM EST = 14 Nov 03:00 UTC (two weeks out).
  const fri13 = utc(2026, 10, 14, 3).toISOString();
  // Sunday 1 Nov 2026, 10 PM EST = 2 Nov 03:00 UTC (tomorrow night).
  const sun1 = utc(2026, 10, 2, 3).toISOString();

  it('knows which nights a filter covers', () => {
    expect(filterCoversNight(THIS_WEEK, day(2026, 11, 6), SAT_8PM)).toBe(true);
    expect(filterCoversNight(THIS_WEEK, day(2026, 11, 7), SAT_8PM)).toBe(false);
    expect(filterCoversNight(TONIGHT, day(2026, 10, 31), SAT_8PM)).toBe(true);
  });

  it('says nothing when the list already shows the event', () => {
    expect(createdNotice(sun1, THIS_WEEK, SAT_8PM)).toBeNull();
  });

  it('points to This week when that would show it', () => {
    expect(createdNotice(sun1, TONIGHT, SAT_8PM)).toBe(
      'Saved for Sun, Nov 1. Switch to This week to see it.',
    );
  });

  it('points to Custom for a night beyond this week', () => {
    expect(createdNotice(fri13, THIS_WEEK, SAT_8PM)).toBe(
      'Saved for Fri, Nov 13. Switch to Custom to see it.',
    );
  });

  it("uses the party's night: a 1 AM start belongs to the evening before", () => {
    // Saturday 14 Nov, 1 AM EST = 06:00 UTC: Friday 13's night.
    expect(createdNotice(utc(2026, 10, 14, 6), THIS_WEEK, SAT_8PM)).toBe(
      'Saved for Fri, Nov 13. Switch to Custom to see it.',
    );
  });
});
