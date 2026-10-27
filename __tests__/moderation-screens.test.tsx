/**
 * Tests for the admin moderation screens (proposals VC-47 and VC-58):
 * the report queue (app/admin/reports.tsx) and one event's Moderate screen
 * (app/admin/moderate/[id].tsx).
 *
 * The server calls and the router are fakes. We check:
 *   - the queue lists each event and tag with counts and the 48-hour marker
 *     ("Overdue" at 48 hours), opens the Moderate screen on tap, and says
 *     when it's empty;
 *   - the Moderate screen lists tags and people (including someone who only
 *     +1'd and never rated), and the right buttons for each;
 *   - every action needs a reason first; the picked reason and note are
 *     sent, then the lists reload; a refusal stays on screen.
 * Admin-only access is tested in route-guards.test.tsx (the addresses) and
 * on the server (pgTAP 019 and 020).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import ModerateEventScreen, { NO_PEOPLE, NO_TAGS } from '../app/admin/moderate/[id]';
import ReportsScreen, { QUEUE_EMPTY } from '../app/admin/reports';
import { CONFIRM_LABEL, NOTE_LABEL, PICK_REASON } from '@/components/ModerationAction';
import {
  getEventModeration,
  getEventTags,
  getTagReports,
  keepTag,
  setHeadsUpsHidden,
  setRatingHidden,
  setTagHidden,
} from '@/lib/moderation-api';

jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: { rpc: jest.fn() } }));
jest.mock('@/lib/moderation-api', () => ({
  getTagReports: jest.fn(),
  getEventModeration: jest.fn(),
  getEventTags: jest.fn(),
  setRatingHidden: jest.fn(),
  setHeadsUpsHidden: jest.fn(),
  setTagHidden: jest.fn(),
  keepTag: jest.fn(),
}));
// The "mock" prefix lets jest.mock (which runs first) use these fakes.
const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({
      push: mockPush,
      back: jest.fn(),
      replace: jest.fn(),
      canGoBack: () => true,
    }),
    useLocalSearchParams: () => ({ id: 'e1', title: 'Rooftop' }),
    // Runs the screen's "on focus" load once, like a screen opening.
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});

const reports = getTagReports as jest.Mock;
const moderation = getEventModeration as jest.Mock;
const tags = getEventTags as jest.Mock;
const hideRating = setRatingHidden as jest.Mock;
const hideHeadsUps = setHeadsUpsHidden as jest.Mock;
const hideTag = setTagHidden as jest.Mock;
const keep = keepTag as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('Reports queue (VC-58)', () => {
  it('lists open reports with counts and the 48-hour marker, and opens one', async () => {
    reports.mockResolvedValue({
      ok: true,
      groups: [
        {
          eventId: 'e2',
          eventTitle: 'Basement',
          eventStartsAt: '',
          tag: 'sound_bad',
          reports: 1,
          hoursWaiting: 50,
          overdue: true,
          votes: 0,
          hidden: false,
        },
        {
          eventId: 'e1',
          eventTitle: 'Rooftop',
          eventStartsAt: '',
          tag: 'overpriced',
          reports: 2,
          hoursWaiting: 3,
          overdue: false,
          votes: 4,
          hidden: true,
        },
      ],
    });
    await render(<ReportsScreen />);
    expect(await screen.findByText('Overdue: waiting 50 h')).toBeOnTheScreen();
    expect(screen.getByText('Waiting 3 h, 45 h left')).toBeOnTheScreen();
    expect(screen.getByText('2 reports · 4 +1s')).toBeOnTheScreen();
    expect(screen.getByText('Hidden')).toBeOnTheScreen();
    // No reporter is ever shown: the row only has counts.
    await fireEvent.press(screen.getByRole('button', { name: /Overpriced at Rooftop/ }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/admin/moderate/[id]',
      params: { id: 'e1', title: 'Rooftop' },
    });
  });

  it('says when the queue is empty, and shows a failure', async () => {
    reports.mockResolvedValueOnce({ ok: true, groups: [] });
    await render(<ReportsScreen />);
    expect(await screen.findByText(QUEUE_EMPTY)).toBeOnTheScreen();
    await screen.unmount();

    reports.mockResolvedValueOnce({ ok: false, message: 'Only admins can do that.' });
    await render(<ReportsScreen />);
    expect(await screen.findByText('Only admins can do that.')).toBeOnTheScreen();
  });
});

/** A rater (Ava, rating visible, one +1) and a +1-only guest (Ben). */
function people() {
  return {
    ok: true,
    moderation: {
      people: [
        {
          userId: 'u1',
          displayName: 'Ava',
          joinedAt: '2026-10-01T00:00:00Z',
          checkInMethod: 'gps',
          rating: {
            crowd: 1,
            music: 1,
            energy: 1,
            score: 0,
            reaction: null,
            updatedAt: '2026-10-27T01:00:00Z',
            hidden: false,
          },
          headsUpsRemoved: false,
          headsUps: [{ tag: 'packed', removed: false }],
        },
        {
          userId: 'u2',
          displayName: 'Ben',
          joinedAt: '2026-10-27T00:00:00Z',
          checkInMethod: 'code',
          rating: null,
          headsUpsRemoved: true,
          headsUps: [{ tag: 'overpriced', removed: true }],
        },
      ],
      log: [
        {
          at: '2026-10-27T01:00:00Z',
          action: 'remove_heads_ups',
          reason: 'coordinated',
          note: 'Same device',
          tag: null,
          adminName: 'Yaw',
          targetName: 'Ben',
        },
      ],
    },
  };
}

describe('Moderate screen (VC-47, VC-58)', () => {
  beforeEach(() => {
    tags.mockResolvedValue({
      ok: true,
      tags: [
        { tag: 'overpriced', votes: 3, hidden: false, openReports: 2 },
        { tag: 'packed', votes: 1, hidden: true, openReports: 0 },
      ],
    });
    moderation.mockResolvedValue(people());
  });

  it('lists tags, people (with a +1-only guest) and decisions, with the right buttons', async () => {
    await render(<ModerateEventScreen />);
    expect(await screen.findByText('Rooftop')).toBeOnTheScreen();
    expect(await screen.findByText('3 +1s tonight · 2 open reports')).toBeOnTheScreen();
    expect(tags).toHaveBeenCalledWith('e1');
    expect(moderation).toHaveBeenCalledWith('e1');
    // Overpriced: visible with reports -> Hide and Keep. Packed: hidden -> Unhide.
    expect(screen.getByRole('button', { name: 'Hide tag, Overpriced' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Keep tag, Overpriced' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Unhide tag, Packed' })).toBeOnTheScreen();
    // Ava rated; Ben only +1'd (and his +1 was removed).
    expect(screen.getByText('Crowd 1 · Music 1 · Energy 1 · score 0.0')).toBeOnTheScreen();
    expect(screen.getByText('No rating (only +1s)')).toBeOnTheScreen();
    expect(screen.getByText('Overpriced (removed)')).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: 'Hide rating, Ava' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Remove +1s, Ava' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Restore +1s, Ben' })).toHaveLength(1);
    expect(
      screen.getByText(/Removed \+1s · Ben · Coordinated or brigading · by Yaw/),
    ).toBeOnTheScreen();
  });

  it('needs a reason, then hides the rating with it and reloads', async () => {
    hideRating.mockResolvedValue({ ok: true, status: 'done' });
    await render(<ModerateEventScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Hide rating, Ava' }));
    // Only the three removal reasons are offered.
    expect(screen.getByRole('radio', { name: "Weren't really there" })).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: 'No rule broken' })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${CONFIRM_LABEL}: `) }));
    // The hint plus the same words as the "you missed this" message.
    expect(screen.getAllByText(PICK_REASON)).toHaveLength(2);
    expect(hideRating).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('radio', { name: 'Broke the tester rules' }));
    await fireEvent.changeText(screen.getByLabelText(NOTE_LABEL), 'Targeted the host');
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${CONFIRM_LABEL}: `) }));
    expect(hideRating).toHaveBeenCalledWith(
      { eventId: 'e1', hidden: true, reason: 'broke_tester_rules', note: 'Targeted the host' },
      'u1',
    );
    // Reloaded after the action (first load + one reload).
    await screen.findByRole('button', { name: 'Hide rating, Ava' });
    expect(moderation).toHaveBeenCalledTimes(2);
  });

  it('removes a +1-only guest’s +1s, and restores with a restore reason', async () => {
    hideHeadsUps.mockResolvedValue({ ok: true, status: 'done' });
    await render(<ModerateEventScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Restore +1s, Ben' }));
    expect(screen.queryByRole('radio', { name: 'Coordinated or brigading' })).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'Undo a mistake' }));
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${CONFIRM_LABEL}: `) }));
    expect(hideHeadsUps).toHaveBeenCalledWith(
      { eventId: 'e1', hidden: false, reason: 'mistake', note: '' },
      'u2',
    );
  });

  it('hides and keeps tags; a refusal stays on screen', async () => {
    hideTag.mockResolvedValue({
      ok: false,
      message: 'Pick why: not really there, coordinated, or broke the tester rules.',
    });
    keep.mockResolvedValue({ ok: true, status: 'done' });
    await render(<ModerateEventScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Hide tag, Overpriced' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Coordinated or brigading' }));
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${CONFIRM_LABEL}: `) }));
    expect(hideTag).toHaveBeenCalledWith(
      { eventId: 'e1', hidden: true, reason: 'coordinated', note: '' },
      'overpriced',
    );
    expect(
      await screen.findByText(
        'Pick why: not really there, coordinated, or broke the tester rules.',
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel: Hide tag, Overpriced' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Keep tag, Overpriced' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'No rule broken' }));
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${CONFIRM_LABEL}: `) }));
    expect(keep).toHaveBeenCalledWith(
      { eventId: 'e1', hidden: false, reason: 'no_rule_broken', note: '' },
      'overpriced',
    );
  });

  it('says when there is nothing to moderate, and shows a load failure', async () => {
    tags.mockResolvedValueOnce({ ok: true, tags: [] });
    moderation.mockResolvedValueOnce({ ok: true, moderation: { people: [], log: [] } });
    await render(<ModerateEventScreen />);
    expect(await screen.findByText(NO_TAGS)).toBeOnTheScreen();
    expect(screen.getByText(NO_PEOPLE)).toBeOnTheScreen();
    await screen.unmount();

    tags.mockResolvedValueOnce({ ok: false, message: 'Only admins can do that.' });
    await render(<ModerateEventScreen />);
    expect(await screen.findByText('Only admins can do that.')).toBeOnTheScreen();
  });
});

describe('Moderate screen accessibility (cto review)', () => {
  it('gives every action a label naming its guest or tag, so screen readers can tell them apart', async () => {
    tags.mockResolvedValue({
      ok: true,
      tags: [
        { tag: 'overpriced', votes: 3, hidden: false, openReports: 1 },
        { tag: 'packed', votes: 2, hidden: false, openReports: 1 },
      ],
    });
    const two = people();
    // Ben rated too, so there are two "Hide rating" and two "Remove +1s".
    two.moderation.people[1] = {
      ...two.moderation.people[1],
      rating: { ...two.moderation.people[0].rating!, hidden: false },
      headsUpsRemoved: false,
      headsUps: [{ tag: 'overpriced', removed: false }],
    };
    moderation.mockResolvedValue(two);
    await render(<ModerateEventScreen />);
    await screen.findByText('Rooftop');

    const labels = screen
      .getAllByRole('button')
      .map((b) => b.props.accessibilityLabel as string)
      .filter((l) => /^(Hide|Keep|Remove|Unhide|Restore)/.test(l));
    expect(labels).toEqual(
      expect.arrayContaining([
        'Hide tag, Overpriced',
        'Keep tag, Overpriced',
        'Hide tag, Packed',
        'Keep tag, Packed',
        'Hide rating, Ava',
        'Hide rating, Ben',
        'Remove +1s, Ava',
        'Remove +1s, Ben',
      ]),
    );
    // No two action buttons sound the same.
    expect(new Set(labels).size).toBe(labels.length);

    // The open form's Confirm names its action too.
    await fireEvent.press(screen.getByRole('button', { name: 'Hide rating, Ben' }));
    expect(screen.getByRole('button', { name: 'Confirm: Hide rating, Ben' })).toBeOnTheScreen();
  });
});
