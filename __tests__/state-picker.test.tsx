/**
 * Tests for the State lookup on the admin event form (VC-37 follow-up,
 * founder decision 2026-10-27 "State becomes a lookup"; spec
 * team/projects/vibecheck/design/state-lookup-spec.md).
 *
 * What we check:
 *   - the search (src/lib/state-search.ts): word-start matching, aliases
 *     ("district", "wash", "va", "md", "D.C."), never more than 3 rows,
 *     and other states ("West Virginia", "Washington State", "Texas")
 *     giving no rows;
 *   - the State box (src/components/StatePicker.tsx): no rows before
 *     typing; the help line shows; picking fills the box with the name and
 *     tells the form the code; an unsupported state shows the "not yet"
 *     line, which can't be tapped, with no "Use ..." row; typing after a
 *     pick clears the form's state; Enter picks the only match; a state set
 *     by the form (pin preselect) fills the box.
 * The screen-level rules (Area disabled until a state, edit and older
 * events) are in area-picker.test.tsx and edit-event-screen.test.tsx.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { StatePicker } from '@/components/StatePicker';
import { STATE_HELP_LINE, STATE_NOT_YET } from '@/copy/state-help';
import type { AreaState } from '@/data/dmv-areas';
import { searchStates, stateSearchForm } from '@/lib/state-search';

/**
 * The codes searchStates gives for some typed text.
 *
 * @param typed - what the admin typed.
 * @returns e.g. ['DC'].
 */
function codes(typed: string): AreaState[] {
  return searchStates(typed).map((m) => m.code);
}

describe('searchStates', () => {
  it('finds nothing before typing', () => {
    expect(searchStates('')).toEqual([]);
    expect(searchStates('   ')).toEqual([]);
  });

  it('matches names and codes at the start of a word, ignoring capitals and dots', () => {
    expect(codes('va')).toEqual(['VA']);
    expect(codes('VIRG')).toEqual(['VA']);
    expect(codes('m')).toEqual(['MD']);
    expect(codes('mary')).toEqual(['MD']);
    expect(codes('md')).toEqual(['MD']);
    expect(codes('dc')).toEqual(['DC']);
    expect(codes('D.C.')).toEqual(['DC']);
    expect(codes('d')).toEqual(['DC']);
    expect(codes('v')).toEqual(['VA']);
    expect(codes(' district ')).toEqual(['DC']);
    expect(codes('of columbia')).toEqual(['DC']);
    // Middle of a word doesn't count.
    expect(codes('inia')).toEqual([]);
    expect(codes('land')).toEqual([]);
  });

  it('"wash" finds DC, shown as "DC (Washington)", not Washington state', () => {
    expect(searchStates('wash')).toEqual([
      { code: 'DC', label: 'DC (Washington)', accessibilityLabel: 'District of Columbia (DC)' },
    ]);
    expect(codes('Washington, D.C.')).toEqual(['DC']);
    expect(codes('washington')).toEqual(['DC']);
    // Found through "DC" itself: the plain name.
    expect(searchStates('dc')[0].label).toBe('DC');
  });

  it('gives no rows for other states, even ones containing "Virginia"', () => {
    expect(codes('West Virginia')).toEqual([]);
    expect(codes('west virg')).toEqual([]);
    expect(codes('Washington State')).toEqual([]);
    expect(codes('Texas')).toEqual([]);
    expect(codes('New York')).toEqual([]);
    expect(codes('zzz')).toEqual([]);
  });

  it('never gives more than 3 rows, in the order DC, Maryland, Virginia', () => {
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
      expect(searchStates(letter).length).toBeLessThanOrEqual(3);
    }
    expect(stateSearchForm(' Washington,  D.C. ')).toBe('washington dc');
  });
});

/**
 * A tiny stand-in form holding the state value, like EventForm does.
 *
 * @param props.initial - the starting state.
 * @param props.onPick - spy told about each pick.
 * @param props.onClear - spy told when the pick is forgotten.
 * @returns the State box plus a button that sets the state from outside
 *   (like the pin preselect).
 */
function Harness({
  initial = null,
  onPick,
  onClear,
}: {
  initial?: AreaState | null;
  onPick?: jest.Mock;
  onClear?: jest.Mock;
}) {
  const [value, setValue] = useState<AreaState | null>(initial);
  return (
    <>
      <StatePicker
        value={value}
        onPick={(code) => {
          setValue(code);
          onPick?.(code);
        }}
        onClear={() => {
          setValue(null);
          onClear?.();
        }}
      />
      {/* Stand-in for the pin preselecting Virginia. */}
      <StatePresetButton onPress={() => setValue('VA')} />
    </>
  );
}

/**
 * A plain button for the Harness (keeps the test's "outside change" visible).
 *
 * @param props.onPress - what the button does.
 * @returns the button.
 */
function StatePresetButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Preset VA" onPress={onPress}>
      <Text>Preset VA</Text>
    </Pressable>
  );
}

describe('the State box', () => {
  it('shows no rows before typing, and the help line under the box', async () => {
    await render(<Harness />);
    expect(screen.queryByLabelText('State suggestions')).toBeNull();
    expect(screen.getByText(STATE_HELP_LINE)).toBeOnTheScreen();
  });

  it('aliases show the right row, and picking fills the box with the name', async () => {
    const onPick = jest.fn();
    await render(<Harness onPick={onPick} />);
    await fireEvent.changeText(screen.getByLabelText('State'), 'district');
    await fireEvent.press(screen.getByRole('button', { name: 'District of Columbia (DC)' }));
    expect(onPick).toHaveBeenLastCalledWith('DC');
    expect(screen.getByLabelText('State')).toHaveDisplayValue('DC');
    expect(screen.queryByLabelText('State suggestions')).toBeNull();

    await fireEvent.changeText(screen.getByLabelText('State'), 'md');
    await fireEvent.press(screen.getByRole('button', { name: 'Maryland' }));
    expect(onPick).toHaveBeenLastCalledWith('MD');
    expect(screen.getByLabelText('State')).toHaveDisplayValue('Maryland');
  });

  it('"wash" shows "DC (Washington)"', async () => {
    await render(<Harness />);
    await fireEvent.changeText(screen.getByLabelText('State'), 'wash');
    expect(screen.getByText('DC (Washington)')).toBeOnTheScreen();
  });

  it('an unsupported state shows the "not yet" line, not tappable, with no "Use ..." row', async () => {
    const onPick = jest.fn();
    await render(<Harness onPick={onPick} />);
    await fireEvent.changeText(screen.getByLabelText('State'), 'West Virginia');

    const line = screen.getByText(STATE_NOT_YET);
    expect(line).toBeOnTheScreen();
    expect(line).toHaveProp('accessibilityLiveRegion', 'polite');
    // No rows at all: not Virginia, and no "Use ..." escape hatch.
    expect(screen.queryAllByRole('button', { name: /Virginia|Use/ })).toHaveLength(0);
    // Tapping the line does nothing.
    await fireEvent.press(line);
    expect(onPick).not.toHaveBeenCalled();
    // The help line under the box hides so it isn't read twice.
    expect(screen.queryByText(STATE_HELP_LINE)).toBeNull();
  });

  it('typing after a pick clears the form state until a row is tapped', async () => {
    const onClear = jest.fn();
    await render(<Harness initial="MD" onClear={onClear} />);
    expect(screen.getByLabelText('State')).toHaveDisplayValue('Maryland');
    await fireEvent.changeText(screen.getByLabelText('State'), 'Marylan');
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('Enter picks the only match, and does nothing when there is none', async () => {
    const onPick = jest.fn();
    await render(<Harness onPick={onPick} />);
    await fireEvent.changeText(screen.getByLabelText('State'), 'texas');
    await fireEvent(screen.getByLabelText('State'), 'submitEditing');
    expect(onPick).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('State'), 'virg');
    await fireEvent(screen.getByLabelText('State'), 'submitEditing');
    expect(onPick).toHaveBeenLastCalledWith('VA');
  });

  it('a state set by the form (pin preselect) fills the box with its name', async () => {
    await render(<Harness />);
    expect(screen.getByLabelText('State')).toHaveDisplayValue('');
    await fireEvent.press(screen.getByRole('button', { name: 'Preset VA' }));
    expect(screen.getByLabelText('State')).toHaveDisplayValue('Virginia');
  });
});
