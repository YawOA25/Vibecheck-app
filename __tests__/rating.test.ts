/**
 * Tests for the rating's building blocks (src/lib/rating.ts), task VC-B08,
 * and its wording (src/lib/rating-screens.ts), including the heads-up tags
 * (VC-43).
 *
 * We check:
 *   - the lists match the server's allowed values exactly (the migration
 *     refuses anything else);
 *   - "Done after 3 taps": only all three rows make a draft complete;
 *   - tags toggle on and off; reactions and tags stay optional;
 *   - the vibe words switch at exactly 4, 7 and 8.5;
 *   - minutes until an update: 59 minutes after a save is 1 minute left,
 *     60 is "now" (the same edge the server uses);
 *   - every result screen's headline, sentence and buttons, and the payoff
 *     ("You and 4 others ...", "You're the first ...").
 */
import {
  EMPTY_DRAFT,
  HEADS_UP_TAGS,
  RATING_ROWS,
  REACTIONS,
  headsUpLabel,
  isComplete,
  minutesUntilUpdate,
  toggleTag,
  vibeLabel,
} from '@/lib/rating';
import {
  DONE_LABEL,
  headsUpRefusalMessage,
  payoffCrowdLine,
  rateResultScreen,
  tooSoonScreen,
} from '@/lib/rating-screens';

describe('the lists', () => {
  it('match the values the server accepts', () => {
    expect(RATING_ROWS.map((row) => row.key)).toEqual(['crowd', 'music', 'energy']);
    expect(RATING_ROWS.map((row) => row.options)).toEqual([
      ['Quiet', 'Good', 'Packed'],
      ['Meh', 'Good', 'Fire'],
      ['Low', 'Good', 'Fire'],
    ]);
    // Same six keys as the ratings table's check rule.
    expect(REACTIONS.map((r) => r.key)).toEqual([
      'fire',
      'dancing',
      'packed',
      'chill',
      'too_loud',
      'dead',
    ]);
    // Same six keys as heads_up_votes' check rule (VC-43).
    expect(HEADS_UP_TAGS.map((t) => t.key)).toEqual([
      'lines_long',
      'music_fire',
      'packed',
      'overpriced',
      'good_crowd',
      'sound_bad',
    ]);
  });

  it("finds a heads-up tag's words, and null for an unknown key", () => {
    expect(headsUpLabel('lines_long')).toBe('Lines are long');
    expect(headsUpLabel('free text')).toBeNull();
  });
});

describe('the draft', () => {
  it('is complete only when all three rows are picked (reaction and tags optional)', () => {
    expect(isComplete(EMPTY_DRAFT)).toBe(false);
    expect(isComplete({ ...EMPTY_DRAFT, crowd: 3, music: 2 })).toBe(false);
    expect(isComplete({ ...EMPTY_DRAFT, crowd: 3, music: 2, energy: 1 })).toBe(true);
  });

  it('toggles a tag on, then off, without changing the old list', () => {
    const before = ['packed'] as const;
    const added = toggleTag([...before], 'lines_long');
    expect(added).toEqual(['packed', 'lines_long']);
    expect(toggleTag(added, 'packed')).toEqual(['lines_long']);
    expect(before).toEqual(['packed']);
  });
});

describe('vibeLabel', () => {
  it('switches at 4, 7 and 8.5', () => {
    expect(vibeLabel(0)).toBe('Quiet');
    expect(vibeLabel(3.9)).toBe('Quiet');
    expect(vibeLabel(4)).toBe('Good');
    expect(vibeLabel(6.9)).toBe('Good');
    expect(vibeLabel(7)).toBe('Hot');
    expect(vibeLabel(8.4)).toBe('Hot');
    expect(vibeLabel(8.5)).toBe('Fire');
    expect(vibeLabel(10)).toBe('Fire');
  });
});

describe('minutesUntilUpdate', () => {
  const saved = '2026-10-31T02:00:00Z';
  const at = (minutes: number) => new Date(Date.parse(saved) + minutes * 60_000);

  it('counts like the server: 59 minutes later is 1 minute left, 60 is now', () => {
    expect(minutesUntilUpdate(saved, at(0))).toBe(60);
    expect(minutesUntilUpdate(saved, at(20))).toBe(40);
    expect(minutesUntilUpdate(saved, at(59))).toBe(1);
    // 59 min 30 s: half a minute left still shows as 1.
    expect(minutesUntilUpdate(saved, at(59.5))).toBe(1);
    expect(minutesUntilUpdate(saved, at(60))).toBe(0);
    expect(minutesUntilUpdate(saved, at(200))).toBe(0);
  });

  it('treats an unreadable time as "now" rather than blocking forever', () => {
    expect(minutesUntilUpdate('not a date', at(0))).toBe(0);
  });
});

describe('rateResultScreen', () => {
  // 03:05 UTC on 31 Oct 2026 is 11:05 PM in New York (EDT).
  const NEXT = '2026-10-31T03:05:00Z';

  it('the payoff: others, own vibe and when to update, with one Done button', () => {
    const screen = rateResultScreen(
      {
        source: 'server',
        result: { status: 'saved', updated: false, nextUpdateAt: NEXT, score: 8.3, raters: 5 },
      },
      'Rooftop',
    );
    expect(screen.success).toBe(true);
    expect(`${screen.lead} ${screen.highlight}`).toBe('Vibe logged.');
    expect(screen.body).toBe(
      'You and 4 others have rated Rooftop. Your vibe: Hot (8.3). You can update it after 11:05 PM.',
    );
    expect(screen.actions).toEqual([{ action: 'done', label: DONE_LABEL }]);
  });

  it('the payoff counts others correctly: first rater, and one other', () => {
    expect(payoffCrowdLine(1, 'Rooftop')).toBe("You're the first to rate Rooftop.");
    expect(payoffCrowdLine(0, 'Rooftop')).toBe("You're the first to rate Rooftop.");
    expect(payoffCrowdLine(2, 'Rooftop')).toBe('You and 1 other have rated Rooftop.');
  });

  it('shows a whole-number score with one decimal', () => {
    const screen = rateResultScreen(
      {
        source: 'server',
        result: { status: 'saved', updated: true, nextUpdateAt: NEXT, score: 5, raters: 1 },
      },
      'Rooftop',
    );
    expect(screen.body).toContain('Your vibe: Good (5.0).');
  });

  it('too soon: minutes left and the time, one way back', () => {
    const screen = rateResultScreen(
      { source: 'server', result: { status: 'too_soon', minutesLeft: 1, nextUpdateAt: NEXT } },
      'Rooftop',
    );
    expect(`${screen.lead} ${screen.highlight}`).toBe('Already rated.');
    expect(screen.body).toBe(
      'You rated Rooftop less than an hour ago. You can update your rating in 1 minute (after 11:05 PM).',
    );
    expect(screen.actions.map((a) => a.action)).toEqual(['done']);
    expect(tooSoonScreen(40, NEXT, 'Rooftop').body).toContain('in 40 minutes');
  });

  it('not checked in and stale check-in both lead to the check-in screen', () => {
    const notIn = rateResultScreen(
      { source: 'server', result: { status: 'not_checked_in' } },
      'Rooftop',
    );
    expect(notIn.actions).toEqual([
      { action: 'checkIn', label: "I'm here" },
      { action: 'done', label: 'Back to the event' },
    ]);
    const stale = rateResultScreen(
      { source: 'server', result: { status: 'check_in_stale' } },
      'Rooftop',
    );
    expect(`${stale.lead} ${stale.highlight}`).toBe('Still here?');
    expect(stale.actions[0]).toEqual({ action: 'checkIn', label: 'Check in again' });
  });

  it('outside the window: too early and too late, with the times', () => {
    const early = rateResultScreen(
      {
        source: 'server',
        result: {
          status: 'outside_window',
          reason: 'too_early',
          opensAt: '2026-10-31T01:30:00Z',
          closesAt: '2026-10-31T07:00:00Z',
        },
      },
      'Rooftop',
    );
    expect(early.body).toBe('Rating for Rooftop opens at 9:30 PM, 30 minutes before it starts.');
    const late = rateResultScreen(
      {
        source: 'server',
        result: {
          status: 'outside_window',
          reason: 'too_late',
          opensAt: '2026-10-31T01:30:00Z',
          closesAt: '2026-10-31T07:00:00Z',
        },
      },
      'Rooftop',
    );
    expect(late.body).toBe('Rating for Rooftop closed at 3 AM, an hour after it ended.');
  });

  it('too far (the quiet re-check) and the staff rule say so plainly', () => {
    const far = rateResultScreen({ source: 'tooFar' }, 'Rooftop');
    expect(`${far.lead} ${far.highlight}`).toBe('You seem far away.');
    expect(far.success).toBe(false);
    const staff = rateResultScreen({ source: 'staff' }, 'Rooftop');
    expect(`${staff.lead} ${staff.highlight}`).toBe("Admins can't rate.");
  });
});

describe('headsUpRefusalMessage', () => {
  it('explains each refused +1', () => {
    expect(headsUpRefusalMessage({ status: 'not_checked_in' })).toBe(
      'Check in first: only guests who are here can +1 a heads-up.',
    );
    expect(headsUpRefusalMessage({ status: 'check_in_stale' })).toContain('Check in again');
    expect(
      headsUpRefusalMessage({
        status: 'outside_window',
        reason: 'too_early',
        opensAt: '2026-10-31T01:30:00Z',
        closesAt: '2026-10-31T07:00:00Z',
      }),
    ).toBe('Heads-ups open at 9:30 PM.');
    expect(
      headsUpRefusalMessage({
        status: 'outside_window',
        reason: 'too_late',
        opensAt: '2026-10-31T01:30:00Z',
        closesAt: '2026-10-31T07:00:00Z',
      }),
    ).toBe('Heads-ups are closed for this event.');
  });
});
