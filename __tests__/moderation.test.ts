/**
 * Tests for the moderation rules and words (src/lib/moderation.ts) and the
 * server calls (src/lib/moderation-api.ts), proposals VC-47, VC-58 and
 * VC-65 (report reasons).
 *
 * Supabase is a fake. We check:
 *   - the reason lists follow the written rule (three removal reasons, two
 *     restore reasons, and no "the venue asked");
 *   - the 48-hour waiting words, and "how long ago";
 *   - each call sends the right arguments (a blank note becomes null) and
 *     reads the server's answer; errors become plain sentences;
 *   - malformed rows from the server are skipped, not shown;
 *   - VC-65: the five report reasons and their words, the reason sent with
 *     a report, the queue's reason counts and how they are worded.
 */
import {
  REMOVAL_REASONS,
  REPORT_REASONS,
  RESTORE_REASONS,
  actionLabel,
  agoText,
  reasonCountsText,
  reasonLabel,
  reasonsFor,
  waitingText,
} from '@/lib/moderation';
import {
  getEventModeration,
  getTagReports,
  keepTag,
  parseEventModeration,
  parseTagReports,
  reportHeadsUpTag,
  setHeadsUpsHidden,
  setRatingHidden,
  setTagHidden,
} from '@/lib/moderation-api';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: { rpc: jest.fn() } }));

const rpc = supabase.rpc as unknown as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('moderation rules (src/lib/moderation.ts)', () => {
  it('lists the written removal rule, with no "venue asked" reason', () => {
    expect(REMOVAL_REASONS.map((r) => r.key)).toEqual([
      'not_checked_in',
      'coordinated',
      'broke_tester_rules',
    ]);
    expect(RESTORE_REASONS.map((r) => r.key)).toEqual(['no_rule_broken', 'mistake']);
    expect(reasonsFor(true)).toBe(REMOVAL_REASONS);
    expect(reasonsFor(false)).toBe(RESTORE_REASONS);
    expect(JSON.stringify([...REMOVAL_REASONS, ...RESTORE_REASONS])).not.toMatch(/venue|asked/i);
  });

  it('words the wait against the 48-hour promise', () => {
    expect(waitingText(0)).toBe('Waiting under an hour');
    expect(waitingText(5)).toBe('Waiting 5 h, 43 h left');
    expect(waitingText(47)).toBe('Waiting 47 h, 1 h left');
    expect(waitingText(48)).toBe('Overdue: waiting 48 h');
    expect(waitingText(50)).toBe('Overdue: waiting 50 h');
  });

  it('says how long ago, whatever the time zone', () => {
    const now = new Date('2026-10-27T12:00:00Z');
    expect(agoText('2026-10-27T11:59:30Z', now)).toBe('just now');
    expect(agoText('2026-10-27T11:48:00Z', now)).toBe('12 min ago');
    expect(agoText('2026-10-27T07:00:00Z', now)).toBe('5 h ago');
    expect(agoText('2026-10-24T12:00:00Z', now)).toBe('3 d ago');
    expect(agoText('not a date', now)).toBe('');
  });

  it('labels reasons and actions, falling back to the key', () => {
    expect(reasonLabel('coordinated')).toBe('Coordinated or brigading');
    expect(reasonLabel('something_new')).toBe('something_new');
    expect(actionLabel('hide_rating')).toBe('Hid rating');
    expect(actionLabel('keep_tag')).toBe('Kept tag');
    expect(actionLabel('new_action')).toBe('new_action');
  });
});

describe('moderation calls (src/lib/moderation-api.ts)', () => {
  it('reports a tag and reads the three answers', async () => {
    for (const status of ['reported', 'already', 'too_many']) {
      rpc.mockResolvedValueOnce({ data: { status }, error: null });
      expect(await reportHeadsUpTag('e1', 'dress_code', 'spam')).toEqual({ ok: true, status });
    }
    expect(rpc).toHaveBeenCalledWith('report_heads_up_tag', {
      p_event_id: 'e1',
      p_tag: 'dress_code',
      p_reason: 'spam',
    });
  });

  it("shows the server's sentence for a missing reason (VCRPT, VC-65)", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'VCRPT', message: 'Pick a reason for the report.' },
    });
    expect(await reportHeadsUpTag('e1', 'dress_code', 'other')).toEqual({
      ok: false,
      message: 'Pick a reason for the report.',
    });
  });

  it('turns errors into sentences and never throws', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'x' } });
    expect(await getTagReports()).toEqual({
      ok: false,
      message: 'Only admins can do that. Sign in again if you are one.',
    });
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'VCRSN', message: 'Pick why: no rule broken, or it was a mistake.' },
    });
    expect(
      await keepTag({ eventId: 'e1', hidden: false, reason: 'no_rule_broken' }, 'dress_code'),
    ).toEqual({ ok: false, message: 'Pick why: no rule broken, or it was a mistake.' });
    rpc.mockRejectedValueOnce(new Error('Network request failed'));
    expect(await reportHeadsUpTag('e1', 'dress_code', 'not_true')).toEqual({
      ok: false,
      message: "We couldn't reach the server. Check your connection and try again.",
    });
    rpc.mockResolvedValueOnce({ data: { status: 'weird' }, error: null });
    expect((await reportHeadsUpTag('e1', 'dress_code', 'not_true')).ok).toBe(false);
  });

  it('sends each admin action with its reason; a blank note is sent as null', async () => {
    rpc.mockResolvedValue({ data: { status: 'done' }, error: null });
    expect(
      await setRatingHidden(
        { eventId: 'e1', hidden: true, reason: 'coordinated', note: '  ' },
        'u1',
      ),
    ).toEqual({ ok: true, status: 'done' });
    expect(rpc).toHaveBeenLastCalledWith('admin_set_rating_hidden', {
      p_event_id: 'e1',
      p_user_id: 'u1',
      p_hidden: true,
      p_reason: 'coordinated',
      p_note: null,
    });

    await setHeadsUpsHidden({ eventId: 'e1', hidden: false, reason: 'mistake' }, 'u2');
    expect(rpc).toHaveBeenLastCalledWith('admin_set_heads_ups_hidden', {
      p_event_id: 'e1',
      p_user_id: 'u2',
      p_hidden: false,
      p_reason: 'mistake',
      p_note: null,
    });

    await setTagHidden(
      { eventId: 'e1', hidden: true, reason: 'broke_tester_rules', note: ' Two new accounts ' },
      'overpriced',
    );
    expect(rpc).toHaveBeenLastCalledWith('admin_set_tag_hidden', {
      p_event_id: 'e1',
      p_tag: 'overpriced',
      p_hidden: true,
      p_reason: 'broke_tester_rules',
      p_note: 'Two new accounts',
    });

    rpc.mockResolvedValueOnce({ data: { status: 'unchanged' }, error: null });
    expect(
      await keepTag({ eventId: 'e1', hidden: false, reason: 'no_rule_broken' }, 'dress_code'),
    ).toEqual({ ok: true, status: 'unchanged' });
    expect(rpc).toHaveBeenLastCalledWith('admin_keep_tag', {
      p_event_id: 'e1',
      p_tag: 'dress_code',
      p_reason: 'no_rule_broken',
      p_note: null,
    });
  });

  it('reads the queue, skipping malformed rows', () => {
    expect(
      parseTagReports([
        {
          event_id: 'e1',
          event_title: 'Rooftop',
          event_starts_at: '2026-10-27T02:00:00Z',
          tag: 'overpriced',
          reports: 2,
          // A bad count (0, text) is dropped; the rest are kept.
          reasons: { not_true: 1, spam: 1, offensive: 0, other: 'x' },
          hours_waiting: 50,
          overdue: true,
          votes: 3,
          hidden: false,
        },
        { event_id: 'e2', tag: 'dress_code' },
        null,
      ]),
    ).toEqual([
      {
        eventId: 'e1',
        eventTitle: 'Rooftop',
        eventStartsAt: '2026-10-27T02:00:00Z',
        tag: 'overpriced',
        reports: 2,
        reasons: { not_true: 1, spam: 1 },
        hoursWaiting: 50,
        overdue: true,
        votes: 3,
        hidden: false,
      },
    ]);
    expect(parseTagReports('nope')).toEqual([]);
    // An older server with no "reasons": an empty count, not a dropped row.
    expect(
      parseTagReports([
        { event_id: 'e1', event_title: 'R', tag: 'dress_code', reports: 1, hours_waiting: 0 },
      ])[0].reasons,
    ).toEqual({});
  });

  it('reads the moderation list, including people with no rating', async () => {
    const data = {
      people: [
        {
          user_id: 'u1',
          display_name: 'Ava',
          joined_at: '2026-10-20T00:00:00Z',
          check_in_method: 'gps',
          rating: {
            crowd: 3,
            music: 1,
            energy: 2,
            score: 5,
            reaction: null,
            updated_at: '2026-10-27T01:00:00Z',
            hidden: true,
          },
          heads_ups: [{ tag: 'dress_code', added_at: '2026-10-27T01:00:00Z', removed: false }],
        },
        {
          user_id: 'u2',
          display_name: 'Ben',
          joined_at: '2026-10-27T00:00:00Z',
          check_in_method: null,
          rating: null,
          heads_ups_removed: true,
          heads_ups: [{ tag: 'overpriced', removed: true }],
        },
        { display_name: 'no id' },
      ],
      log: [
        {
          at: '2026-10-27T02:00:00Z',
          action: 'hide_rating',
          reason: 'coordinated',
          note: null,
          tag: null,
          admin_name: 'Yaw',
          target_name: 'Ava',
        },
      ],
    };
    rpc.mockResolvedValueOnce({ data, error: null });
    const outcome = await getEventModeration('e1');
    expect(rpc).toHaveBeenCalledWith('admin_get_event_moderation', { p_event_id: 'e1' });
    expect(outcome).toEqual({ ok: true, moderation: parseEventModeration(data) });
    const moderation = parseEventModeration(data);
    expect(moderation.people).toHaveLength(2);
    expect(moderation.people[0].rating).toMatchObject({ score: 5, hidden: true });
    // A missing flag reads as "not removed".
    expect(moderation.people[0].headsUpsRemoved).toBe(false);
    expect(moderation.people[1]).toMatchObject({
      rating: null,
      checkInMethod: null,
      headsUpsRemoved: true,
      headsUps: [{ tag: 'overpriced', removed: true }],
    });
    expect(moderation.log[0]).toMatchObject({ action: 'hide_rating', adminName: 'Yaw' });
    expect(parseEventModeration(null)).toEqual({ people: [], log: [] });
  });
});

describe('report reasons (VC-65)', () => {
  it('lists the five reasons in order, with their words', () => {
    expect(REPORT_REASONS).toEqual([
      { key: 'not_true', label: 'Not true' },
      { key: 'spam', label: 'Spam or fake' },
      { key: 'targets_person', label: 'Targets a person' },
      { key: 'offensive', label: 'Offensive' },
      { key: 'other', label: 'Other' },
    ]);
  });

  it('words the counts in list order, then "No reason", then unknown keys', () => {
    expect(reasonCountsText({ other: 1, not_true: 2, spam: 1 })).toBe(
      'Not true 2 · Spam or fake 1 · Other 1',
    );
    expect(reasonCountsText({ zzz_new: 1, not_given: 3, offensive: 1 })).toBe(
      'Offensive 1 · No reason 3 · zzz_new 1',
    );
    expect(reasonCountsText({ targets_person: 0 })).toBe('');
    expect(reasonCountsText({})).toBe('');
  });
});
