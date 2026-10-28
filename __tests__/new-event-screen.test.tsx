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
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform } from 'react-native';

import NewEventScreen from '../app/admin/new-event';
import { pickDateTime } from '../test-utils/pick-date-time';
import { TEST_EVENT_HINT } from '@/components/EventForm';
import { todayInZone } from '@/lib/age';
import { takeCreatedEvent } from '@/lib/created-event';
import { END_BEFORE_START } from '@/lib/event-form';
import { zonedMoment } from '@/lib/tonight';
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

// Tomorrow 10 PM and the day after at 2 AM (New York), so "already over"
// never triggers whatever day the tests run.
const DAY = 24 * 60 * 60 * 1000;
const tomorrow = todayInZone(new Date(Date.now() + DAY));
const dayAfter = todayInZone(new Date(Date.now() + 2 * DAY));
const startTomorrow = zonedMoment(tomorrow, 22);
const endDayAfter = zonedMoment(dayAfter, 2);

beforeEach(() => {
  jest.clearAllMocks();
  // Start each test with no leftover "new event" note (VC-63b).
  takeCreatedEvent();
  pin.mockResolvedValue({ status: 'ok', pin: { lat: 38.91, lng: -77.02, accuracyM: 9 } });
  rpc.mockResolvedValue({
    data: { event_id: 'event-1', check_in_code: 'K7MX2Q' },
    error: null,
  });
});

/**
 * The words a Starts or Ends field shows (its accessibility value).
 *
 * @param label - 'Starts' or 'Ends'.
 * @returns for example "Sat, Nov 7 · 10:00 PM".
 */
function fieldText(label: 'Starts' | 'Ends'): string {
  return screen.getByRole('button', { name: label }).props.accessibilityValue?.text ?? '';
}

/**
 * Fills in the name, area, and the start and end (picked on the phone's
 * date and time wheel, see test-utils/pick-date-time.ts).
 *
 * @param end - the end moment (defaults to 2 AM the day after tomorrow).
 */
async function fillForm(end: Date = endDayAfter) {
  await fireEvent.changeText(screen.getByLabelText('Event name'), 'Saturday rooftop');
  // VC-37: pick the state, then search its areas and pick the match.
  await fireEvent.changeText(screen.getByLabelText('State'), 'dc');
  await fireEvent.press(screen.getByRole('button', { name: 'District of Columbia (DC)' }));
  await fireEvent.changeText(screen.getByLabelText('Area'), 'Shaw');
  await fireEvent.press(screen.getByRole('button', { name: 'Shaw, DC' }));
  await pickDateTime('Starts', startTomorrow);
  await pickDateTime('Ends', end);
}

describe('NewEventScreen', () => {
  it('refuses an end before the start and sends nothing', async () => {
    await render(<NewEventScreen />);
    // End on the same day as the start, at 2 AM: that's before 10 PM.
    await fillForm(zonedMoment(tomorrow, 2));
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
    // VC-63b: a note for the home list, so it reloads and can say where the
    // event is (tomorrow 10 PM New York).
    expect(takeCreatedEvent()).toEqual({ id: 'event-1', startsAt: startTomorrow.toISOString() });

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
    // Nothing was saved, so no note for the home list.
    expect(takeCreatedEvent()).toBeNull();
  });

  it('starts with Test event OFF and says who sees test events (VC-63b)', async () => {
    await render(<NewEventScreen />);
    const toggle = screen.getByRole('switch', { name: 'Test event' });
    expect(toggle).not.toBeChecked();
    expect(toggle.props.accessibilityHint).toBe(TEST_EVENT_HINT);
    expect(screen.getByText('Only testers and admins see test events.')).toBeOnTheScreen();
  });

  it('sends the "How to get in" link for a host event, and hides the box for staff picks', async () => {
    await render(<NewEventScreen />);
    await fillForm();
    await fireEvent.changeText(
      screen.getByLabelText('How to get in link (optional)'),
      'https://partiful.com/e/abc',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Use my current location' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Create event' }));
    expect(rpc).toHaveBeenCalledWith(
      'create_event',
      expect.objectContaining({ p_entry_url: 'https://partiful.com/e/abc', p_source: 'host' }),
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    await render(<NewEventScreen />);
    await fireEvent.press(screen.getByRole('switch', { name: 'Staff pick' }));
    expect(screen.queryByLabelText('How to get in link (optional)')).toBeNull();
  });

  // ---- Native date and time pickers (founder: "dates are hard to type") ----

  it('shows the picked start and end as words and saves them', async () => {
    await render(<NewEventScreen />);
    await fillForm();
    // For example "Sat, Nov 7 · 10:00 PM": always with minutes and AM/PM.
    expect(fieldText('Starts')).toMatch(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} · 10:00 PM$/);
    expect(fieldText('Ends')).toMatch(/ · 2:00 AM$/);
    await fireEvent.press(screen.getByRole('button', { name: 'Use my current location' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Create event' }));

    expect(rpc).toHaveBeenCalledWith(
      'create_event',
      expect.objectContaining({
        p_starts_at: startTomorrow.toISOString(),
        p_ends_at: endDayAfter.toISOString(),
      }),
    );
  });

  it('asks for the times when none were picked', async () => {
    await render(<NewEventScreen />);
    // The fields start on today's date with no time yet.
    expect(fieldText('Starts')).toMatch(/ · Pick a time$/);
    await fireEvent.press(screen.getByRole('button', { name: 'Create event' }));

    expect(screen.getByText('Pick the start time.')).toBeOnTheScreen();
    expect(screen.getByText('Pick the end time.')).toBeOnTheScreen();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses an event longer than 24 hours', async () => {
    await render(<NewEventScreen />);
    await fillForm(zonedMoment(dayAfter, 23));
    await fireEvent.press(screen.getByRole('button', { name: 'Use my current location' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Create event' }));

    expect(
      screen.getByText('An event can last 24 hours at most. Check the end date.'),
    ).toBeOnTheScreen();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses an event that is already over', async () => {
    const lastWeek = todayInZone(new Date(Date.now() - 7 * DAY));
    await render(<NewEventScreen />);
    await fillForm();
    await pickDateTime('Starts', zonedMoment(lastWeek, 20));
    await pickDateTime('Ends', zonedMoment(lastWeek, 23));
    await fireEvent.press(screen.getByRole('button', { name: 'Use my current location' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Create event' }));

    expect(screen.getByText(/That end time has already passed/)).toBeOnTheScreen();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('saves New York time on a phone set to Tokyo', async () => {
    // Jest runs in Asia/Tokyo (jest.global-setup.js). Friday 6 March 2037,
    // 10 PM in New York (EST, UTC-5; daylight saving starts on 8 March) is
    // 03:00 UTC on 7 March, which is already noon on Saturday in Tokyo. The
    // admin must still see and save 10 PM on Friday. Far in the future so "already over" never triggers.
    const start = new Date('2037-03-07T03:00:00.000Z');
    const end = new Date('2037-03-07T07:00:00.000Z');
    await render(<NewEventScreen />);
    await fillForm(end);
    await pickDateTime('Starts', start);
    expect(screen.getByRole('button', { name: 'Starts' })).toHaveAccessibilityValue({
      text: 'Fri, Mar 6 · 10:00 PM',
    });
    // The wheel is told to show New York time, not the phone's zone.
    await fireEvent.press(screen.getByRole('button', { name: 'Starts' }));
    expect(screen.getByTestId('starts-picker')).toHaveProp('timeZoneName', 'America/New_York');
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Use my current location' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Create event' }));

    expect(rpc).toHaveBeenCalledWith(
      'create_event',
      expect.objectContaining({
        p_starts_at: '2037-03-07T03:00:00.000Z',
        p_ends_at: '2037-03-07T07:00:00.000Z',
      }),
    );
  });

  describe('on Android', () => {
    const realOS = Platform.OS;
    const open = DateTimePickerAndroid.open as jest.Mock;
    beforeEach(() => {
      Platform.OS = 'android';
    });
    afterEach(() => {
      Platform.OS = realOS;
    });

    it('opens the date dialog, then the time dialog, in New York time', async () => {
      await render(<NewEventScreen />);
      await fireEvent.press(screen.getByRole('button', { name: 'Starts' }));

      // Step 1: the calendar, in New York time.
      expect(open).toHaveBeenCalledTimes(1);
      const dateDialog = open.mock.calls[0][0];
      expect(dateDialog).toEqual(
        expect.objectContaining({ mode: 'date', timeZoneName: 'America/New_York' }),
      );
      // The admin picks tomorrow: the date fills in and the clock opens.
      await act(async () => dateDialog.onValueChange({}, startTomorrow));
      expect(open).toHaveBeenCalledTimes(2);
      const timeDialog = open.mock.calls[1][0];
      expect(timeDialog).toEqual(
        expect.objectContaining({ mode: 'time', timeZoneName: 'America/New_York' }),
      );
      // Then 11:30 PM.
      await act(async () =>
        timeDialog.onValueChange({}, new Date(startTomorrow.getTime() + 90 * 60_000)),
      );
      expect(fieldText('Starts')).toMatch(/ · 11:30 PM$/);
      // No iPhone wheel on Android.
      expect(screen.queryByTestId('starts-picker')).toBeNull();
    });
  });
});
