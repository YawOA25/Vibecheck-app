/**
 * The State box on the admin event form (VC-37 follow-up, founder decision
 * 2026-10-27 "State becomes a lookup"; spec
 * team/projects/vibecheck/design/state-lookup-spec.md). Used by both New
 * event and Edit event through src/components/EventForm.tsx.
 *
 * It replaces the old DC / Maryland / Virginia buttons with a search box
 * that looks and behaves like Area:
 *   - search-first: nothing is listed until the admin types;
 *   - at most three rows (DC, Maryland, Virginia), matched at the start of
 *     a word, with aliases like "district", "wash", "va" and "md"
 *     (src/lib/state-search.ts);
 *   - any other state, or anything that matches nothing, shows a plain
 *     "not yet" line that can't be tapped. There is never a "Use ..." row:
 *     the state is not free text;
 *   - a help line under the box always says we're DMV-only for now (hidden
 *     while the "not yet" line shows, so it isn't read twice).
 *
 * Picking a row fills the box with the state's name and tells the form the
 * code. Typing again clears the form's state until a row is tapped (like
 * Area), so a half-typed state is never saved.
 *
 * When the form sets the state itself (the pin preselects it), the box
 * fills in the name.
 *
 * Keys: Enter / "Done" picks the only row when exactly one matches. On web,
 * Up and Down move between rows, Enter picks the lit row, Esc closes.
 */
import { useState } from 'react';
import type { TextInputKeyPressEvent } from 'react-native';
import { StyleSheet, View } from 'react-native';

import { SuggestionList, SuggestionNote, SuggestionRow } from '@/components/SuggestionList';
import { TextField } from '@/components/TextField';
import { STATE_HELP_LINE, STATE_NOT_YET } from '@/copy/state-help';
import type { AreaState } from '@/data/dmv-areas';
import { searchStates, stateName } from '@/lib/state-search';
import { spacing } from '@/theme';

/** What a StatePicker needs. */
export interface StatePickerProps {
  /** The form's current state code, or null when none is picked. */
  value: AreaState | null;
  /** Called with the code when the admin taps a row. */
  onPick: (state: AreaState) => void;
  /** Called when the admin starts typing again after a pick. */
  onClear: () => void;
  /** The form's error for the State box, if any. */
  error?: string;
}

/**
 * Renders the State box, its help line and, while typing, its suggestions.
 *
 * @returns the picker view.
 */
export function StatePicker({ value, onPick, onClear, error }: StatePickerProps) {
  // What's in the box: the saved state's name (Edit event) or empty.
  const [text, setText] = useState(stateName(value));
  // Whether the suggestion list is showing (only after typing).
  const [open, setOpen] = useState(false);
  // Which row the arrow keys are on (web only); -1 means none.
  const [lit, setLit] = useState(-1);
  // The last state code this box saw from the form, to notice changes made
  // elsewhere (the pin preselecting a state).
  const [seenValue, setSeenValue] = useState(value);

  // The form changed the state by itself (e.g. the pin preselected it):
  // show that state's name. This is React's "adjust state when a prop
  // changes" pattern, done during render rather than in an effect. A change
  // to null came from our own typing, so the typed text is kept.
  if (value !== seenValue) {
    setSeenValue(value);
    if (value !== null) {
      setText(stateName(value));
      setOpen(false);
    }
  }

  const typed = text.trim();
  const searching = open && typed !== '';
  const matches = searching ? searchStates(typed) : [];
  // Typed something that isn't one of our three states: say "not yet".
  const notYet = searching && matches.length === 0;

  /**
   * The admin typed: show suggestions, and forget any earlier pick.
   *
   * @param next - the box's new text.
   */
  function onType(next: string) {
    setText(next);
    setOpen(true);
    setLit(-1);
    if (value !== null) onClear();
  }

  /**
   * Fills the box with a state's name, closes the list and tells the form.
   *
   * @param code - the picked state.
   */
  function choose(code: AreaState) {
    setText(stateName(code));
    setOpen(false);
    setLit(-1);
    onPick(code);
  }

  /**
   * Enter or "Done": picks the lit row (web arrows), or the only row when
   * exactly one matches. Otherwise does nothing (we never guess).
   */
  function onSubmit() {
    if (lit >= 0 && lit < matches.length) choose(matches[lit].code);
    else if (matches.length === 1) choose(matches[0].code);
  }

  /**
   * Web keyboard: Up and Down move between rows, Esc closes the list.
   * (Phones don't send these keys, so nothing changes there.)
   *
   * @param event - the key press.
   */
  function onKeyPress(event: TextInputKeyPressEvent) {
    const { key } = event.nativeEvent;
    if (key === 'ArrowDown' && matches.length > 0)
      setLit((n) => Math.min(n + 1, matches.length - 1));
    else if (key === 'ArrowUp' && matches.length > 0) setLit((n) => Math.max(n - 1, 0));
    else if (key === 'Escape') {
      setOpen(false);
      setLit(-1);
    }
  }

  return (
    <View style={styles.group}>
      <TextField
        label="State"
        value={text}
        onChangeText={onType}
        onSubmitEditing={onSubmit}
        onKeyPress={onKeyPress}
        error={error}
        // The help line hides while the "not yet" line shows (no double reading).
        helper={notYet ? undefined : STATE_HELP_LINE}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        placeholder="Start typing, like Virginia"
      />
      {matches.length > 0 || notYet ? (
        <SuggestionList accessibilityLabel="State suggestions">
          {matches.map((match, index) => (
            <SuggestionRow
              key={match.code}
              label={match.label}
              accessibilityLabel={match.accessibilityLabel}
              selected={match.code === value}
              highlighted={index === lit}
              onPress={() => choose(match.code)}
            />
          ))}
          {notYet ? <SuggestionNote text={STATE_NOT_YET} /> : null}
        </SuggestionList>
      ) : null}
    </View>
  );
}

/** Styles built only from theme tokens (row styles live in SuggestionList). */
const styles = StyleSheet.create({
  group: { gap: spacing.sm },
});
