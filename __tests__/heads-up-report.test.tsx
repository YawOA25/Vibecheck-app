/**
 * Tests for "Report this tag" on the Heads-up card
 * (src/components/HeadsUpCard.tsx), proposal VC-58.
 *
 * The server calls are fakes. We check:
 *   - guests see "Report this tag" once there are tags; admins don't (they
 *     moderate on their own screen), and nobody does when there are no tags;
 *   - picking a tag sends the report and shows the thank-you;
 *   - 'already' and 'too_many' are worded, and a failure is shown as an error;
 *   - the venue contact line appears only once an address is set, and the
 *     address constant ships empty (founder sets it).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  HeadsUpCard,
  REPORT_CANCEL,
  REPORT_LINK,
  REPORT_MESSAGES,
  REPORT_PICK,
  venueContactLine,
} from '@/components/HeadsUpCard';
import { VENUE_CONTACT_EMAIL } from '@/lib/contact';
import { reportHeadsUpTag } from '@/lib/moderation-api';
import { getEventHeadsUps } from '@/lib/ratings-api';

jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: { rpc: jest.fn() } }));
jest.mock('@/lib/ratings-api', () => ({ getEventHeadsUps: jest.fn(), addHeadsUp: jest.fn() }));
jest.mock('@/lib/moderation-api', () => ({ reportHeadsUpTag: jest.fn() }));

const headsUps = getEventHeadsUps as jest.Mock;
const report = reportHeadsUpTag as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  headsUps.mockResolvedValue({
    ok: true,
    tags: [
      { tag: 'overpriced', count: 3, mine: false },
      { tag: 'packed', count: 1, mine: false },
    ],
  });
});

/**
 * Renders the card as a guest (canVote) or an admin.
 *
 * @param canVote - false for admins.
 * @param contactEmail - the contact address to show ('' for none).
 */
async function renderCard(canVote = true, contactEmail = '') {
  await render(
    <HeadsUpCard eventId="e1" refreshKey={1} canVote={canVote} contactEmail={contactEmail} />,
  );
  await screen.findByRole('button', { name: /Overpriced, 3 people/ });
}

describe('HeadsUpCard: Report this tag (VC-58)', () => {
  it('lets a guest pick a shown tag and report it', async () => {
    report.mockResolvedValue({ ok: true, status: 'reported' });
    await renderCard();
    await fireEvent.press(screen.getByRole('button', { name: REPORT_LINK }));
    expect(screen.getByText(REPORT_PICK)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Overpriced' }));
    expect(report).toHaveBeenCalledWith('e1', 'overpriced');
    expect(await screen.findByText(REPORT_MESSAGES.reported)).toBeOnTheScreen();
    // The list closes after a report.
    expect(screen.queryByText(REPORT_PICK)).toBeNull();
  });

  it('words a repeat report and the daily limit', async () => {
    report.mockResolvedValueOnce({ ok: true, status: 'already' });
    report.mockResolvedValueOnce({ ok: true, status: 'too_many' });
    await renderCard();
    await fireEvent.press(screen.getByRole('button', { name: REPORT_LINK }));
    await fireEvent.press(screen.getByRole('button', { name: 'Packed' }));
    expect(await screen.findByText(REPORT_MESSAGES.already)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: REPORT_LINK }));
    await fireEvent.press(screen.getByRole('button', { name: 'Packed' }));
    expect(await screen.findByText(REPORT_MESSAGES.too_many)).toBeOnTheScreen();
  });

  it('shows a failure and keeps the list open to try again', async () => {
    report.mockResolvedValue({ ok: false, message: "We couldn't reach the server." });
    await renderCard();
    await fireEvent.press(screen.getByRole('button', { name: REPORT_LINK }));
    await fireEvent.press(screen.getByRole('button', { name: 'Packed' }));
    expect(await screen.findByText("We couldn't reach the server.")).toBeOnTheScreen();
    expect(screen.getByText(REPORT_PICK)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: REPORT_CANCEL }));
    expect(screen.queryByText(REPORT_PICK)).toBeNull();
  });

  it('has no report link for admins', async () => {
    await renderCard(false);
    expect(screen.queryByRole('button', { name: REPORT_LINK })).toBeNull();
  });

  it('has no report link when there are no tags to report', async () => {
    headsUps.mockResolvedValue({ ok: true, tags: [] });
    await render(<HeadsUpCard eventId="e1" refreshKey={1} canVote />);
    await screen.findByText(/No heads-ups yet/);
    expect(screen.queryByRole('button', { name: REPORT_LINK })).toBeNull();
  });
});

describe('venue contact email (VC-58)', () => {
  it('ships empty until the founder sets it, so no line is shown', async () => {
    expect(VENUE_CONTACT_EMAIL).toBe('');
    expect(venueContactLine('')).toBeNull();
    expect(venueContactLine('   ')).toBeNull();
    await render(<HeadsUpCard eventId="e1" refreshKey={1} canVote />);
    await screen.findByRole('button', { name: /Overpriced/ });
    expect(screen.queryByText(/Venue or host\?/)).toBeNull();
  });

  it('shows the line once an address is set', async () => {
    await renderCard(true, 'hello@example.com');
    expect(screen.getByText('Venue or host? Email hello@example.com')).toBeOnTheScreen();
  });
});
