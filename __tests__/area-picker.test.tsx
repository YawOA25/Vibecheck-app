/**
 * Tests for the State choice and the Area search on the admin event form
 * (proposal VC-37, with the founder's search-first and state-first
 * clarifications of 2026-10-27).
 *
 * What we check:
 *   - the list (src/data/dmv-areas.ts): about 50 areas (Baltimore and
 *     Richmond added by VC-62), each tagged with a
 *     state that matches its label's ending, 60 characters or fewer, never
 *     starting with a number, no repeats;
 *   - search: "contains" matching, ignoring capitals; only the chosen state;
 *   - the offline pin check: DC, Maryland and Virginia spots around the DMV
 *     (including the tricky ones by the river), Baltimore and Richmond
 *     (VC-62), and no guess far away;
 *   - the Area box: no suggestions before typing; typing filters (at most
 *     6); picking fills the box and closes the list; with no match, "Use
 *     '<typed>'" fills it with exactly what was typed; with no state yet, it
 *     is disabled (State lookup spec, section 3);
 *   - on the real New event screen: the state filters suggestions, a pin
 *     preselects the state, changing the state clears an area from another
 *     state but keeps a typed one, Area waits for a state, a half-typed
 *     state can't be saved, and the no-house-number rule still applies to
 *     "Use ...".
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import NewEventScreen from '../app/admin/new-event';
import {
  AreaPicker,
  CHOOSE_STATE_FIRST,
  MAX_AREA_RESULTS,
  PICK_STATE_TO_CHANGE_AREA,
} from '@/components/AreaPicker';
import { DMV_AREAS, searchAreas, stateForPin, stateOfListedArea } from '@/data/dmv-areas';
import type { AreaState } from '@/data/dmv-areas';
import { STATE_REQUIRED } from '@/lib/event-form';
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
function Harness({
  state,
  onChange,
  initial = '',
}: {
  state: AreaState | null;
  onChange?: jest.Mock;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
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
  it('has about 50 well-formed, unique labels, each tagged with its state', () => {
    expect(DMV_AREAS.length).toBeGreaterThanOrEqual(45);
    expect(DMV_AREAS.length).toBeLessThanOrEqual(60);
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

  it('lists Baltimore and Richmond neighbourhoods under the right state (VC-62)', () => {
    expect(searchAreas('baltimore', 'MD')).toEqual([
      'Downtown Baltimore, MD',
      'Mount Vernon (Baltimore), MD',
    ]);
    expect(searchAreas('fells', 'MD')).toEqual(['Fells Point, MD']);
    expect(searchAreas('federal', 'MD')).toEqual(['Federal Hill, MD']);
    expect(searchAreas('canton', 'MD')).toEqual(['Canton, MD']);
    expect(searchAreas('richmond', 'VA')).toEqual(['Downtown Richmond, VA']);
    // The apostrophe is ignored when searching, so "scotts" finds it too.
    expect(searchAreas('scotts', 'VA')).toEqual(["Scott's Addition, VA"]);
    // ...and so does a phone's curly apostrophe.
    expect(searchAreas('scott’s', 'VA')).toEqual(["Scott's Addition, VA"]);
    expect(searchAreas('shockoe', 'VA')).toEqual(['Shockoe Bottom, VA']);
    expect(searchAreas('the fan', 'VA')).toEqual(['The Fan, VA']);
    expect(searchAreas('midlothian', 'VA')).toEqual(['Midlothian, VA']);
    // Baltimore names stay out of Virginia searches, and the other way round.
    expect(searchAreas('baltimore', 'VA')).toEqual([]);
    expect(searchAreas('richmond', 'MD')).toEqual([]);
    expect(stateOfListedArea('Fells Point, MD')).toBe('MD');
    expect(stateOfListedArea("Scott's Addition, VA")).toBe('VA');
  });

  it('guesses Maryland for Baltimore pins and Virginia for Richmond pins (VC-62)', () => {
    expect(stateForPin(39.2904, -76.6122)).toBe('MD'); // Downtown Baltimore
    expect(stateForPin(39.2847, -76.5927)).toBe('MD'); // Fells Point
    expect(stateForPin(39.2779, -76.6115)).toBe('MD'); // Federal Hill
    expect(stateForPin(39.2794, -76.5753)).toBe('MD'); // Canton
    expect(stateForPin(39.2976, -76.6156)).toBe('MD'); // Mount Vernon (Baltimore)
    expect(stateForPin(37.5407, -77.436)).toBe('VA'); // Downtown Richmond
    expect(stateForPin(37.5669, -77.4693)).toBe('VA'); // Scott's Addition
    expect(stateForPin(37.5512, -77.4728)).toBe('VA'); // The Fan
    expect(stateForPin(37.5318, -77.4297)).toBe('VA'); // Shockoe Bottom
    expect(stateForPin(37.5057, -77.6491)).toBe('VA'); // Midlothian
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

  it('with no state yet, is disabled and says to choose a state first', async () => {
    await render(<Harness state={null} />);
    const box = screen.getByLabelText('Area');
    expect(box).toBeDisabled();
    expect(box.props.editable).toBe(false);
    expect(screen.getByText(CHOOSE_STATE_FIRST)).toBeOnTheScreen();
  });

  it('with no state but a saved area, keeps the area greyed and says how to change it', async () => {
    await render(<Harness state={null} initial="Ivy City" />);
    expect(screen.getByLabelText('Area')).toHaveDisplayValue('Ivy City');
    expect(screen.getByLabelText('Area')).toBeDisabled();
    expect(screen.getByText(PICK_STATE_TO_CHANGE_AREA)).toBeOnTheScreen();
  });

  it('shows the example placeholder for the chosen state', async () => {
    await render(<Harness state="MD" />);
    expect(screen.getByLabelText('Area').props.placeholder).toBe('Bethesda, MD');
  });
});

/**
 * Picks a state through the State lookup: types, then taps the row.
 *
 * @param typed - what to type in the State box.
 * @param row - the row's spoken name, e.g. "Virginia".
 */
async function pickState(typed: string, row: string) {
  await fireEvent.changeText(screen.getByLabelText('State'), typed);
  await fireEvent.press(screen.getByRole('button', { name: row }));
}

/** The DC row's spoken name. */
const DC_ROW = 'District of Columbia (DC)';

describe('State and Area on the New event screen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('the chosen state filters the suggestions', async () => {
    await render(<NewEventScreen />);
    await pickState('virg', 'Virginia');
    expect(screen.getByLabelText('State')).toHaveDisplayValue('Virginia');
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
    expect(screen.getByLabelText('State')).toHaveDisplayValue('Maryland');
    expect(screen.getByLabelText('Area')).not.toBeDisabled();

    await pickState('dc', DC_ROW);
    expect(screen.getByLabelText('State')).toHaveDisplayValue('DC');
  });

  it('a typed map pin ("Enter location") preselects the state too', async () => {
    await render(<NewEventScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Enter location' }));
    await fireEvent.changeText(
      screen.getByLabelText('Map link or coordinates'),
      '38.8868, -77.0953',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Set this location' }));
    expect(screen.getByLabelText('State')).toHaveDisplayValue('Virginia');
  });

  it('changing the state clears an area chosen from another state', async () => {
    await render(<NewEventScreen />);
    await pickState('dc', DC_ROW);
    await fireEvent.changeText(screen.getByLabelText('Area'), 'shaw');
    await fireEvent.press(screen.getByRole('button', { name: 'Shaw, DC' }));
    expect(screen.getByLabelText('Area')).toHaveDisplayValue('Shaw, DC');

    await pickState('mary', 'Maryland');
    expect(screen.getByLabelText('Area')).toHaveDisplayValue('');
  });

  it('changing the state keeps a typed ("Use ...") area', async () => {
    await render(<NewEventScreen />);
    await pickState('dc', DC_ROW);
    await fireEvent.changeText(screen.getByLabelText('Area'), 'Ivy City');
    await fireEvent.press(screen.getByRole('button', { name: "Use 'Ivy City'" }));

    await pickState('va', 'Virginia');
    expect(screen.getByLabelText('Area')).toHaveDisplayValue('Ivy City');
  });

  it('Area is disabled until a state is picked, and again while the state is retyped', async () => {
    await render(<NewEventScreen />);
    expect(screen.getByLabelText('Area')).toBeDisabled();
    await pickState('dc', DC_ROW);
    expect(screen.getByLabelText('Area')).not.toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Area'), 'shaw');
    await fireEvent.press(screen.getByRole('button', { name: 'Shaw, DC' }));

    // Retyping the state disables Area but keeps its text.
    await fireEvent.changeText(screen.getByLabelText('State'), 'D');
    expect(screen.getByLabelText('Area')).toBeDisabled();
    expect(screen.getByLabelText('Area')).toHaveDisplayValue('Shaw, DC');
  });

  it('saving with a half-typed state asks for a pick from the list', async () => {
    await render(<NewEventScreen />);
    await fireEvent.changeText(screen.getByLabelText('State'), 'Virg');
    await fireEvent.press(screen.getByRole('button', { name: 'Create event' }));
    expect(screen.getByText(STATE_REQUIRED)).toBeOnTheScreen();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('still refuses a house number typed through "Use ..."', async () => {
    await render(<NewEventScreen />);
    await pickState('dc', DC_ROW);
    await fireEvent.changeText(screen.getByLabelText('Area'), '1420 U St NW');
    await fireEvent.press(screen.getByRole('button', { name: "Use '1420 U St NW'" }));
    await fireEvent.press(screen.getByRole('button', { name: 'Create event' }));

    expect(screen.getByText(/Use the neighbourhood, not a street address/)).toBeOnTheScreen();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
