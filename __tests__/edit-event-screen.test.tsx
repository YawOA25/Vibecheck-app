/**
 * Tests for the admin Edit event screen (app/admin/edit-event/[id].tsx),
 * task VC-34.
 *
 * Supabase, the phone's location and the router are fakes. We check:
 *   - prefill: the form opens with the event's name, area, New York date
 *     and time, switches and summary; the location says it's being kept;
 *   - save: only the changed fields go to update_event, then it goes back;
 *   - "Use my current location instead" sends the new pin;
 *   - an untouched form sends nothing and says so;
 *   - the server's refusal to change the test flag after check-ins (VCTST)
 *     is shown in plain words, and the screen stays open;
 *   - a missing event shows "Event not found".
 * Admin-only visibility is tested in route-guards.test.tsx (the address)
 * and event-screen.test.tsx (the button).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import EditEventScreen, { NOTHING_CHANGED, SAVE_LABEL } from '../app/admin/edit-event/[id]';
import { KEEPING_LOCATION } from '@/components/EventForm';
import type { EditableEvent } from '@/lib/event-form';
import { getCurrentPin } from '@/lib/location';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));
jest.mock('@/lib/location', () => ({ getCurrentPin: jest.fn() }));
// The "mock" prefix lets jest.mock (which runs first) use these fakes.
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: 'event-1' }),
}));

const rpc = supabase.rpc as unknown as jest.Mock;
const from = supabase.from as unknown as jest.Mock;
const pin = getCurrentPin as jest.Mock;

/**
 * The stored event: Saturday 24 October 2026, 10 PM to 2 AM New York time.
 * Fixed dates are fine here: editing (unlike creating) allows events that
 * are already over, so these tests never go stale.
 *
 * @returns an EditableEvent.
 */
function storedEvent(): EditableEvent {
  return {
    id: 'event-1',
    title: 'Saturday rooftop',
    area_label: 'Shaw, DC',
    starts_at: '2026-10-25T02:00:00+00:00',
    ends_at: '2026-10-25T06:00:00+00:00',
    source: 'host',
    ticket_url: null,
    summary: 'Afrobeats on the roof.',
    is_21_plus: false,
    is_test: false,
    code_check_in_enabled: true,
    state: 'DC',
  };
}

/**
 * Makes supabase.from('events').select(...).eq(...).maybeSingle() answer.
 *
 * @param answer - what maybeSingle resolves to.
 * @returns the fake `select` so tests can check the columns asked for.
 */
function eventsReadReturns(answer: { data: unknown; error: unknown }) {
  const maybeSingle = jest.fn().mockResolvedValue(answer);
  const eq = jest.fn(() => ({ maybeSingle }));
  const select = jest.fn(() => ({ eq }));
  from.mockReturnValue({ select });
  return select;
}

beforeEach(() => {
  jest.clearAllMocks();
  pin.mockResolvedValue({ status: 'ok', pin: { lat: 38.92, lng: -77.03, accuracyM: 7 } });
  rpc.mockResolvedValue({ data: { event_id: 'event-1', check_in_code: 'K7MX2Q' }, error: null });
});

describe('EditEventScreen', () => {
  it('opens filled in with the event, in New York time, keeping the location', async () => {
    const select = eventsReadReturns({ data: storedEvent(), error: null });
    await render(<EditEventScreen />);

    // The admin read also asks for the party-code switch (never the pin).
    expect(select).toHaveBeenCalledWith(expect.stringContaining('code_check_in_enabled'));
    expect(select).not.toHaveBeenCalledWith(expect.stringMatching(/lat|lng|check_in_code\b/));
    expect(screen.getByLabelText('Event name')).toHaveDisplayValue('Saturday rooftop');
    // VC-37: the saved state is selected and the area box shows the area.
    expect(screen.getByRole('radio', { name: 'DC' })).toBeSelected();
    expect(screen.getByLabelText('Area')).toHaveDisplayValue('Shaw, DC');
    expect(screen.getByLabelText('Start date')).toHaveDisplayValue('10 / 24 / 2026');
    expect(screen.getByLabelText('Start time')).toHaveDisplayValue('10 PM');
    expect(screen.getByLabelText('End time')).toHaveDisplayValue('2 AM');
    expect(screen.getByLabelText('Summary (optional)')).toHaveDisplayValue(
      'Afrobeats on the roof.',
    );
    expect(screen.getByRole('switch', { name: 'Party code check-in' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Test event' })).not.toBeChecked();
    expect(screen.getByText(KEEPING_LOCATION)).toBeOnTheScreen();
    expect(screen.getByLabelText('Check-in radius (metres)')).toHaveDisplayValue('');
  });

  it('saves only what changed, then goes back to the event page', async () => {
    eventsReadReturns({ data: storedEvent(), error: null });
    await render(<EditEventScreen />);
    await fireEvent.changeText(screen.getByLabelText('Event name'), 'Sunday rooftop');
    await fireEvent.changeText(screen.getByLabelText('End time'), '3:00 AM');
    await fireEvent.press(screen.getByRole('button', { name: SAVE_LABEL }));

    expect(rpc).toHaveBeenCalledWith('update_event', {
      p_event_id: 'event-1',
      p_title: 'Sunday rooftop',
      p_ends_at: '2026-10-25T07:00:00.000Z',
    });
    expect(mockBack).toHaveBeenCalled();
  });

  it('"Use my current location instead" replaces the pin', async () => {
    eventsReadReturns({ data: storedEvent(), error: null });
    await render(<EditEventScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Use my current location instead' }));
    expect(screen.getByText('Location set (accurate to about 7 m).')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: SAVE_LABEL }));

    expect(rpc).toHaveBeenCalledWith('update_event', {
      p_event_id: 'event-1',
      p_lat: 38.92,
      p_lng: -77.03,
    });
  });

  it('sends nothing when nothing changed, and says so', async () => {
    eventsReadReturns({ data: storedEvent(), error: null });
    await render(<EditEventScreen />);
    await fireEvent.press(screen.getByRole('button', { name: SAVE_LABEL }));

    expect(rpc).not.toHaveBeenCalled();
    expect(screen.getByText(NOTHING_CHANGED)).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('shows the server refusing a test-flag change after check-ins (B04 rule)', async () => {
    eventsReadReturns({ data: storedEvent(), error: null });
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'VCTST', message: "People have checked in, so the test flag can't change." },
    });
    await render(<EditEventScreen />);
    await fireEvent.press(screen.getByRole('switch', { name: 'Test event' }));
    await fireEvent.press(screen.getByRole('button', { name: SAVE_LABEL }));

    expect(rpc).toHaveBeenCalledWith('update_event', { p_event_id: 'event-1', p_is_test: true });
    expect(
      screen.getByText("People have checked in, so the test flag can't change."),
    ).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('shows "Event not found" when the event is gone', async () => {
    eventsReadReturns({ data: null, error: null });
    await render(<EditEventScreen />);
    expect(screen.getByRole('header', { name: 'Event not found' })).toBeOnTheScreen();
  });
});
