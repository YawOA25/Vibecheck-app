/**
 * Tests for the admin New event screen (app/admin/new-event.tsx), task VC-B04.
 *
 * Supabase, the phone's location and the router are replaced with fakes.
 * We check that:
 *   - an end time before the start shows the error under the end box and
 *     sends nothing to the server;
 *   - a missing location is flagged;
 *   - a complete form goes to `create_event` and then shows the party code;
 *   - "Get a new code" asks update_event to rotate it;
 *   - "Enter location" sets the pin from a pasted map link (no GPS);
 *   - a server refusal (not an admin) is shown in plain words.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import NewEventScreen from '../app/admin/new-event';
import { dateInputFor, END_BEFORE_START } from '@/lib/event-form';
import { getCurrentPin } from '@/lib/location';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: jest.fn() },
}));
jest.mock('@/lib/location', () => ({ getCurrentPin: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}));

const rpc = supabase.rpc as unknown as jest.Mock;
const pin = getCurrentPin as jest.Mock;

// Tomorrow and the day after, so "already over" never triggers whatever day
// the tests run.
const DAY = 24 * 60 * 60 * 1000;
const tomorrow = dateInputFor(new Date(Date.now() + DAY));
const dayAfter = dateInputFor(new Date(Date.now() + 2 * DAY));

beforeEach(() => {
  jest.clearAllMocks();
  pin.mockResolvedValue({ status: 'ok', pin: { lat: 38.91, lng: -77.02, accuracyM: 9 } });
  rpc.mockResolvedValue({
    data: { event_id: 'event-1', check_in_code: 'K7MX2Q' },
    error: null,
  });
});

/**
 * Fills in the name, area, dates and times. Dates are typed as digits only,
 * the way the number pad sends them.
 *
 * @param endDate - the end date box text (defaults to the day after tomorrow).
 */
async function fillForm(endDate: string = dayAfter) {
  await fireEvent.changeText(screen.getByLabelText('Event name'), 'Saturday rooftop');
  // VC-37: pick the state, then search its areas and pick the match.
  await fireEvent.changeText(screen.getByLabelText('State'), 'dc');
  await fireEvent.press(screen.getByRole('button', { name: 'District of Columbia (DC)' }));
  await fireEvent.changeText(screen.getByLabelText('Area'), 'Shaw');
  await fireEvent.press(screen.getByRole('button', { name: 'Shaw, DC' }));
  await fireEvent.changeText(screen.getByLabelText('Start date'), tomorrow.replace(/\D/g, ''));
  await fireEvent.changeText(screen.getByLabelText('Start time'), '10:00 PM');
  await fireEvent.changeText(screen.getByLabelText('End date'), endDate.replace(/\D/g, ''));
  await fireEvent.changeText(screen.getByLabelText('End time'), '2:00 AM');
}

describe('NewEventScreen', () => {
  it('refuses an end before the start and sends nothing', async () => {
    await render(<NewEventScreen />);
    // End on the same day as the start, at 2 AM: that's before 10 PM.
    await fillForm(tomorrow);
    await fireEvent.press(screen.getByRole('button', { name: 'Use my current location' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Create event' }));

    expect(screen.getByText(END_BEFORE_START)).toBeOnTheScreen();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('asks for the location when it is missing', async () => {
    await render(<NewEventScreen />);
    await fillForm();
    await fireEvent.press(screen.getByRole('button', { name: 'Create event' }));

    expect(
      screen.getByText(/Use my current location" while you are at the event/),
    ).toBeOnTheScreen();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('explains when location access is denied', async () => {
    pin.mockResolvedValue({ status: 'denied' });
    await render(<NewEventScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Use my current location' }));

    expect(screen.getByText(/Location access is off/)).toBeOnTheScreen();
  });

  it('creates the event, shows the party code, and can rotate it', async () => {
    await render(<NewEventScreen />);
    await fillForm();
    await fireEvent.press(screen.getByRole('button', { name: 'Use my current location' }));
    expect(screen.getByText('Location set (accurate to about 9 m).')).toBeOnTheScreen();
    // Turn on the code fallback (the whole row is the switch).
    await fireEvent.press(screen.getByRole('switch', { name: 'Party code check-in' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Create event' }));

    expect(rpc).toHaveBeenCalledWith(
      'create_event',
      expect.objectContaining({
        p_title: 'Saturday rooftop',
        p_area_label: 'Shaw, DC',
        p_lat: 38.91,
        p_lng: -77.02,
        p_radius_m: 150,
        p_code_check_in_enabled: true,
        p_source: 'host',
        p_state: 'DC',
      }),
    );
    expect(screen.getByText('K7MX2Q')).toBeOnTheScreen();

    rpc.mockResolvedValue({ data: { event_id: 'event-1', check_in_code: 'P3RT9W' }, error: null });
    await fireEvent.press(screen.getByRole('button', { name: 'Get a new code' }));
    expect(rpc).toHaveBeenLastCalledWith('update_event', {
      p_event_id: 'event-1',
      p_rotate_code: true,
    });
    expect(screen.getByText('P3RT9W')).toBeOnTheScreen();
  });

  it('sets a typed pin from a pasted map link, without GPS (VC-29 staff picks)', async () => {
    await render(<NewEventScreen />);
    await fillForm();
    await fireEvent.press(screen.getByRole('button', { name: 'Enter location' }));
    // A bad paste first: refused with a message, nothing set.
    await fireEvent.changeText(screen.getByLabelText('Map link or coordinates'), 'Black Cat');
    await fireEvent.press(screen.getByRole('button', { name: 'Set this location' }));
    expect(screen.getByText(/couldn't find coordinates/)).toBeOnTheScreen();
    // Then a real Apple Maps link.
    await fireEvent.changeText(
      screen.getByLabelText('Map link or coordinates'),
      'https://maps.apple.com/?ll=38.9172,-77.0320&q=Venue',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Set this location' }));
    expect(
      screen.getByText('Location set to 38.91720, -77.03200. Check it matches the venue.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('switch', { name: 'Staff pick' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Create event' }));

    expect(pin).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      'create_event',
      expect.objectContaining({ p_lat: 38.9172, p_lng: -77.032, p_source: 'staff_pick' }),
    );
  });

  it('shows a server refusal in plain words', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Only admins can create events.' },
    });
    await render(<NewEventScreen />);
    await fillForm();
    await fireEvent.press(screen.getByRole('button', { name: 'Use my current location' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Create event' }));

    expect(screen.getByText('Only admins can create or edit events.')).toBeOnTheScreen();
  });
});
