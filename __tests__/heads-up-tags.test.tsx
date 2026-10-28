/**
 * Tests for how the Heads-up card shows the final tags
 * (src/components/HeadsUpCard.tsx), proposals VC-45, VC-56 and VC-60.
 *
 * The server calls are fakes. The server decides which tags reach the app
 * (2+ guests, and the stricter "Felt unsafe" bar, tested in pgTAP file
 * 022_final_heads_up_tags.test.sql); here we check what the card does with
 * what it gets:
 *   - chips show emoji then words and the count ("⏳ Long line · 3");
 *   - "Felt unsafe" reads "💬 Felt unsafe · N guests tonight", with a
 *     neutral icon and never the warning sign;
 *   - "What are these?" opens and closes the "guests' impressions, not
 *     checked or endorsed by us" line;
 *   - +1'ing "Felt unsafe" shows the 911 line; +1'ing another tag doesn't;
 *   - a retired tag is never shown, even if a server sent one;
 *   - with no tags, the empty text says tags need 5 raters tonight (VC-67)
 *     and 2 guests per tag (VC-56);
 *   - the share message never carries a heads-up (VC-60: not on shares).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { HeadsUpCard, INFO_CLOSE, INFO_LINK, NO_HEADS_UPS } from '@/components/HeadsUpCard';
import { FELT_UNSAFE_HELP, HEADS_UP_INFO, HEADS_UP_TAGS } from '@/lib/rating';
import { addHeadsUp, getEventHeadsUps, parseHeadsUpList } from '@/lib/ratings-api';
import { buildShareMessage } from '@/lib/share';

jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: { rpc: jest.fn() } }));
// Keep the real list parser (to prove retired tags are dropped), fake the calls.
jest.mock('@/lib/ratings-api', () => ({
  ...jest.requireActual('@/lib/ratings-api'),
  getEventHeadsUps: jest.fn(),
  addHeadsUp: jest.fn(),
}));
jest.mock('@/lib/moderation-api', () => ({ reportHeadsUpTag: jest.fn() }));

const headsUps = getEventHeadsUps as jest.Mock;
const plusOne = addHeadsUp as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  headsUps.mockResolvedValue({
    ok: true,
    tags: [
      { tag: 'lines_long', count: 3, mine: false },
      { tag: 'felt_unsafe', count: 3, mine: false },
    ],
  });
  plusOne.mockResolvedValue({ ok: true, result: { status: 'added' } });
});

/**
 * Renders the card as a checked-in guest and waits for the chips.
 */
async function renderCard() {
  await render(<HeadsUpCard eventId="e1" refreshKey={1} canVote contactEmail="" />);
  await screen.findByText('⏳ Long line · 3');
}

describe('Heads-up chips (VC-45, VC-60)', () => {
  it('shows emoji, words and counts; "Felt unsafe" as guests tonight', async () => {
    await renderCard();
    expect(screen.getByText('💬 Felt unsafe · 3 guests tonight')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Felt unsafe, 3 guests tonight' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Long line, 3 people' })).toBeOnTheScreen();
    expect(screen.queryByText(/⚠/)).toBeNull();
  });

  it('"What are these?" opens and closes the impressions line', async () => {
    await renderCard();
    expect(screen.queryByText(HEADS_UP_INFO)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: INFO_LINK }));
    expect(screen.getByText(HEADS_UP_INFO)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: INFO_CLOSE }));
    expect(screen.queryByText(HEADS_UP_INFO)).toBeNull();
  });

  it('+1 on "Felt unsafe" shows the 911 line', async () => {
    await renderCard();
    await fireEvent.press(screen.getByRole('button', { name: 'Felt unsafe, 3 guests tonight' }));
    expect(plusOne).toHaveBeenCalledWith('e1', 'felt_unsafe');
    expect(await screen.findByText(FELT_UNSAFE_HELP)).toBeOnTheScreen();
    // An alert, so VoiceOver reads it as soon as it appears (cto review).
    expect(screen.getByRole('alert')).toHaveTextContent(FELT_UNSAFE_HELP);
  });

  it('+1 on another tag does not show the 911 line', async () => {
    await renderCard();
    await fireEvent.press(screen.getByRole('button', { name: 'Long line, 3 people' }));
    expect(plusOne).toHaveBeenCalledWith('e1', 'lines_long');
    expect(screen.queryByText(FELT_UNSAFE_HELP)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('never shows a retired tag, even if a server sent one', async () => {
    headsUps.mockResolvedValue({
      ok: true,
      tags: parseHeadsUpList([
        { tag: 'packed', count: 4, mine: false },
        { tag: 'parking_rough', count: 2, mine: false },
      ]),
    });
    await render(<HeadsUpCard eventId="e1" refreshKey={1} canVote contactEmail="" />);
    expect(await screen.findByText('🅿️ Parking is rough · 2')).toBeOnTheScreen();
    expect(screen.queryByText(/Packed/)).toBeNull();
  });

  it('with no tags, says tags need 5 raters tonight and 2 guests per tag', async () => {
    headsUps.mockResolvedValue({ ok: true, tags: [] });
    await render(<HeadsUpCard eventId="e1" refreshKey={1} canVote contactEmail="" />);
    expect(await screen.findByText(NO_HEADS_UPS)).toBeOnTheScreen();
    // VC-67: the server sends nothing until 5 guests rated tonight, so say so.
    expect(NO_HEADS_UPS).toContain('5 or more guests have rated tonight');
    expect(NO_HEADS_UPS).toContain('2 or more of them');
    // No tags, so no info tap either.
    expect(screen.queryByRole('button', { name: INFO_LINK })).toBeNull();
  });
});

describe('share text (VC-60: tags never go on shares)', () => {
  it('has no heads-up words in it', () => {
    const message = buildShareMessage({
      title: 'Felt unsafe night',
      area_label: 'Shaw, DC',
      starts_at: '2026-11-07T03:00:00Z',
      ends_at: '2026-11-07T07:00:00Z',
    });
    // Only the event's own title can carry those words; nothing is added.
    const withoutTitle = message.split('\n').slice(1).join('\n');
    for (const tag of HEADS_UP_TAGS) {
      expect(withoutTitle).not.toContain(tag.label);
      expect(withoutTitle).not.toContain(tag.emoji);
    }
  });
});
