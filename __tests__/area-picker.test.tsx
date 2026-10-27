/**
 * Tests for the State choice and the Area search on the admin event form
 * (proposal VC-37, with the founder's search-first and state-first
 * clarifications of 2026-10-27).
 *
 * What we check:
 *   - the list (src/data/dmv-areas.ts): about 40 areas, each tagged with a
 *     state that matches its label's ending, 60 characters or fewer, never
 *     starting with a number, no repeats;
 *   - search: "contains" matching, ignoring capitals; only the chosen state;
 *   - the offline pin check: DC, Maryland and Virginia spots around the DMV
 *     (including the tricky ones by the river), and no guess far away;
 *   - the Area box: no suggestions before typing; typing filters (at most
 *     6); picking fills the box and closes the list; with no match, "Use
 *     '<typed>'" fills it with exactly what was typed; with no state yet, it
 *     says to pick one;
 *   - on the real New event screen: the state filters suggestions, a pin
 *     preselects the state, changing the state clears an area from another
 *     state, and the no-house-number rule still applies to "Use ...".
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import NewEventScreen from '../app/admin/new-event';
import { AreaPicker, MAX_AREA_RESULTS, PICK_STATE_FIRST } from '@/components/AreaPicker';
import { DMV_AREAS, searchAreas, stateForPin, stateOfListedArea } from '@/data/dmv-areas';
import type { AreaState } from '@/data/dmv-areas';
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

/** Any suggestion row: its name ends with ", DC", ", MD" or ", VA". */
const SUGGESTION = /, (DC|MD|VA)$/;

/**
 * A tiny stand-in form holding the area value, like EventForm does.
 *
 * @param props.state - the chosen state (null = none yet).
 * @param props.onChange - spy told about every change.
 * @returns the Area box.
 */
function Harness({ state, onChange }: { state: AreaState | null; onChange?: jest.Mock }) {
  const [value, setValue] = useState('');
  return (
    <AreaPicker
      state={state}
      value={value}
      onChange={(label) => {
        setValue(label);
        onChange?.(label);
      }}
    />
  );
}

describe('the DMV area list and search', () => {
  it('has about 40 well-formed, unique labels, each tagged with its state', () => {
    expect(DMV_AREAS.length).toBeGreaterThanOrEqual(35);
    expect(DMV_AREAS.length).toBeLessThanOrEqual(50);
    expect(new Set(DMV_AREAS.map((a) => a.label)).size).toBe(DMV_AREAS.length);
    for (const area of DMV_AREAS) {
      expect(area.label).toMatch(/^[A-Za-z][^,]*, (DC|MD|VA)$/);
      expect(area.label.endsWith(`, ${area.state}`)).toBe(true);
      expect(area.label.length).toBeLessThanOrEqual(60);
    }
  });

  it('matches anywhere in the name, ignoring capitals, in the chosen state only', () => {
    expect(searchAreas('yard', 'DC')).toEqual(['Navy Yard, DC']);
    expect(searchAreas('CHINATOWN', 'DC')).toEqual(['Penn Quarter/Chinatown, DC']);
    expect(searchAreas('park', 'MD')).toEqual(['College Park, MD', 'Takoma Park, MD']);
    // Clarendon is in Virginia, so a DC search doesn't find it.
    expect(searchAreas('clar', 'DC')).toEqual([]);
    expect(searchAreas('', 'DC')).toEqual([]);
    expect(stateOfListedArea('Rosslyn, VA')).toBe('VA');
    expect(stateOfListedArea('Ivy City')).toBeNull();
  });

  it('guesses the state from a pin (approximately), river-side spots included', () => {
    expect(stateForPin(38.8764, -77.0034)).toBe('DC'); // Navy Yard
    expect(stateForPin(38.9054, -77.0629)).toBe('DC'); // Georgetown
    expect(stateForPin(38.8964, -77.0717)).toBe('VA'); // Rosslyn, just over Key Bridge
    expect(stateForPin(38.8574, -77.0511)).toBe('VA'); // Crystal City
    expect(stateForPin(38.8048, -77.0469)).toBe('VA'); // Old Town Alexandria
    expect(stateForPin(38.8868, -77.0953)).toBe('VA'); // Clarendon
    expect(stateForPin(38.9907, -77.0261)).toBe('MD'); // Silver Spring
    expect(stateForPin(38.9807, -77.1003)).toBe('MD'); // Bethesda
    expect(stateForPin(38.7829, -77.0169)).toBe('MD'); // National Harbor
    expect(stateForPin(39.1457, -77.4169)).toBe('MD'); // Poolesville (river bends west)
    expect(stateForPin(39.1157, -77.5636)).toBe('VA'); // Leesburg
    expect(stateForPin(40.7128, -74.006)).toBeNull(); // New York City
  });
});

describe('the Area box (search-first)', () => {
  it('shows no suggestions before typing, then up to 6 matches', async () => {
    await render(<Harness state="DC" />);
    expect(screen.queryAllByRole('button', { name: SUGGESTION })).toHaveLength(0);

    await fireEvent.changeText(screen.getByLabelText('Area'), 'o');
    const rows = screen.getAllByRole('button', { name: SUGGESTION });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(MAX_AREA_RESULTS);

    await fireEvent.changeText(screen.getByLabelText('Area'), 'yard');
    expect(screen.getAllByRole('button', { name: SUGGESTION })).toHaveLength(1);
  });

  it('picking a suggestion fills the box and closes the list', async () => {
    const onChange = jest.fn();
    await render(<Harness state="DC" onChange={onChange} />);
    await fireEvent.changeText(screen.getByLabelText('Area'), 'yard');
    await fireEvent.press(screen.getByRole('button', { name: 'Navy Yard, DC' }));

    expect(onChange).toHaveBeenLastCalledWith('Navy Yard, DC');
    expect(screen.getByLabelText('Area')).toHaveDisplayValue('Navy Yard, DC');
    expect(screen.queryAllByRole('button', { name: SUGGESTION })).toHaveLength(0);
  });

  it('typing again after a pick forgets the pick until something is chosen', async () => {
    const onChange = jest.fn();
    await render(<Harness state="DC" onChange={onChange} />);
    await fireEvent.changeText(screen.getByLabelText('Area'), 'shaw');
    await fireEvent.press(screen.getByRole('button', { name: 'Shaw, DC' }));
    await fireEvent.changeText(screen.getByLabelText('Area'), 'Shaw, D');
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('with no match, offers "Use \'<typed>\'", which fills the box with exactly that', async () => {
    const onChange = jest.fn();
    await render(<Harness state="DC" onChange={onChange} />);
    await fireEvent.changeText(screen.getByLabelText('Area'), 'Ivy City ');
    expect(screen.queryAllByRole('button', { name: SUGGESTION })).toHaveLength(0);

    await fireEvent.press(screen.getByRole('button', { name: "Use 'Ivy City'" }));
    expect(onChange).toHaveBeenLastCalledWith('Ivy City');
    expect(screen.getByLabelText('Area')).toHaveDisplayValue('Ivy City');
    expect(screen.queryByRole('button', { name: "Use 'Ivy City'" })).toBeNull();
  });

  it('does not offer "Use ..." while there are matches', async () => {
    await render(<Harness state="DC" />);
    await fireEvent.changeText(screen.getByLabelText('Area'), 'shaw');
    expect(screen.queryByRole('button', { name: "Use 'shaw'" })).toBeNull();
  });

  it('with no state yet, says to pick one first (and still offers "Use ...")', async () => {
    await render(<Harness state={null} />);
    await fireEvent.changeText(screen.getByLabelText('Area'), 'shaw');
    expect(screen.getByText(PICK_STATE_FIRST)).toBeOnTheScreen();
    expect(screen.queryAllByRole('button', { name: SUGGESTION })).toHaveLength(0);
    expect(screen.getByRole('button', { name: "Use 'shaw'" })).toBeOnTheScreen();
  });
});

describe('State and Area on the New event screen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('the chosen state filters the suggestions', async () => {
    await render(<NewEventScreen />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Virginia' }));
    expect(screen.getByRole('radio', { name: 'Virginia' })).toBeSelected();
    await fireEvent.changeText(screen.getByLabelText('Area'), 'r');
    const names = screen
      .getAllByRole('button', { name: SUGGESTION })
      .map((row) => row.props.accessibilityLabel as string);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => name.endsWith(', VA'))).toBe(true);
  });

  it('a location pin preselects the state, and the admin can still change it', async () => {
    (getCurrentPin as jest.Mock).mockResolvedValue({
      status: 'ok',
      pin: { lat: 38.9907, lng: -77.0261, accuracyM: 9 }, // Silver Spring
    });
    await render(<NewEventScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Use my current location' }));
    expect(screen.getByRole('radio', { name: 'Maryland' })).toBeSelected();

    await fireEvent.press(screen.getByRole('radio', { name: 'DC' }));
    expect(screen.getByRole('radio', { name: 'DC' })).toBeSelected();
    expect(screen.getByRole('radio', { name: 'Maryland' })).not.toBeSelected();
  });

  it('a typed map pin ("Enter location") preselects the state too', async () => {
    await render(<NewEventScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Enter location' }));
    await fireEvent.changeText(
      screen.getByLabelText('Map link or coordinates'),
      '38.8868, -77.0953',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Set this location' }));
    expect(screen.getByRole('radio', { name: 'Virginia' })).toBeSelected();
  });

  it('changing the state clears an area chosen from another state', async () => {
    await render(<NewEventScreen />);
    await fireEvent.press(screen.getByRole('radio', { name: 'DC' }));
    await fireEvent.changeText(screen.getByLabelText('Area'), 'shaw');
    await fireEvent.press(screen.getByRole('button', { name: 'Shaw, DC' }));
    expect(screen.getByLabelText('Area')).toHaveDisplayValue('Shaw, DC');

    await fireEvent.press(screen.getByRole('radio', { name: 'Maryland' }));
    expect(screen.getByLabelText('Area')).toHaveDisplayValue('');
  });

  it('still refuses a house number typed through "Use ..."', async () => {
    await render(<NewEventScreen />);
    await fireEvent.press(screen.getByRole('radio', { name: 'DC' }));
    await fireEvent.changeText(screen.getByLabelText('Area'), '1420 U St NW');
    await fireEvent.press(screen.getByRole('button', { name: "Use '1420 U St NW'" }));
    await fireEvent.press(screen.getByRole('button', { name: 'Create event' }));

    expect(screen.getByText(/Use the neighbourhood, not a street address/)).toBeOnTheScreen();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
