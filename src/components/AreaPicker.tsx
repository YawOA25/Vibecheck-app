/**
 * The Area box on the admin event form (proposal VC-37), in the v3 look.
 * Used by both New event and Edit event (src/components/EventForm.tsx).
 *
 * Search-first (founder's clarifications, 2026-10-27): it looks and starts
 * like a normal text box. Nothing is listed until the admin types. From the
 * first letter, up to 6 matching neighbourhoods IN THE CHOSEN STATE
 * (src/data/dmv-areas.ts) appear under the box, matched anywhere in the
 * name and ignoring capitals ("yard" finds "Navy Yard, DC"). When nothing
 * matches, "Use '<what they typed>'" is offered instead: the "Other"
 * choice for a place not on the list. With no state picked yet, it says to
 * pick one first (and still offers "Use ...").
 *
 * Picking a suggestion (or "Use ...") fills the box and closes the list.
 * Only then does the form's area value change. Typing again clears it
 * until something is picked, so a half-typed search is never saved by
 * accident (the form then asks for an area).
 *
 * "Use ..." text follows the same free-text rules as before: neighbourhood
 * only, 60 characters, never a house number. The form checks that on save
 * (src/lib/event-form.ts) and the server checks it again.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TextField } from '@/components/TextField';
import { searchAreas } from '@/data/dmv-areas';
import type { AreaState } from '@/data/dmv-areas';
import { MAX_AREA_LENGTH } from '@/lib/event-form';
import { colors, minTapTarget, radius, spacing, typography } from '@/theme';

/** Shown while typing before a state is picked (exported for tests). */
export const PICK_STATE_FIRST = 'Pick DC, Maryland or Virginia above to see suggestions.';

/** Most suggestions shown at once (keeps the form short). */
export const MAX_AREA_RESULTS = 6;

/**
 * The words on the "Other" row.
 *
 * @param typed - what the admin typed (spaces at the ends removed).
 * @returns for example "Use 'Ivy City, DC'".
 */
export function typedAreaLabel(typed: string): string {
  return `Use '${typed}'`;
}

/** What an AreaPicker needs. */
export interface AreaPickerProps {
  /** The form's current area label ('' when nothing is picked). */
  value: string;
  /** Called with the picked label, or '' when the admin starts typing again. */
  onChange: (label: string) => void;
  /** The form's error for the Area box, if any. */
  error?: string;
  /** The chosen state (VC-37); suggestions only come from it. null = none yet. */
  state: AreaState | null;
}

/**
 * Renders the Area box and, while typing, its suggestions.
 *
 * @returns the picker view.
 */
export function AreaPicker({ value, onChange, error, state }: AreaPickerProps) {
  // What's in the box. Starts as the saved area (Edit event) or empty.
  const [text, setText] = useState(value);
  // Whether the suggestion list is showing (only after typing).
  const [open, setOpen] = useState(false);

  /**
   * The admin typed: show suggestions, and forget any earlier pick so a
   * half-typed search can't be saved by accident.
   *
   * @param next - the box's new text.
   */
  function onType(next: string) {
    setText(next);
    setOpen(true);
    if (value !== '') onChange('');
  }

  /**
   * Fills the box with a choice and closes the list.
   *
   * @param label - a listed area, or the typed text ("Use ...").
   */
  function choose(label: string) {
    setText(label);
    setOpen(false);
    onChange(label);
  }

  const typed = text.trim();
  const searching = open && typed !== '';
  const matches = searching && state ? searchAreas(typed, state).slice(0, MAX_AREA_RESULTS) : [];
  // "Use ..." is the way in for a place that isn't on the list: offered
  // only when nothing matches (founder's rule).
  const offerTyped = searching && matches.length === 0;

  return (
    <View style={styles.group}>
      <TextField
        label="Area"
        value={text}
        onChangeText={onType}
        error={error}
        helper="Start typing the neighbourhood, like Shaw or Clarendon. Never the address."
        maxLength={MAX_AREA_LENGTH}
        autoCapitalize="words"
        autoCorrect={false}
        placeholder="Shaw, DC"
      />
      {searching && !state ? <Text style={styles.hint}>{PICK_STATE_FIRST}</Text> : null}
      {matches.length > 0 || offerTyped ? (
        <View style={styles.results} accessibilityLabel="Area suggestions">
          {matches.map((area) => (
            <Pressable
              key={area}
              accessibilityRole="button"
              accessibilityLabel={area}
              onPress={() => choose(area)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <Text style={styles.rowText}>{area}</Text>
            </Pressable>
          ))}
          {offerTyped ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={typedAreaLabel(typed)}
              accessibilityHint="Not on the list: use exactly what you typed."
              onPress={() => choose(typed)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <Text style={styles.otherText}>{typedAreaLabel(typed)}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  hint: { ...typography.caption, color: colors.muted },
  results: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.field,
    overflow: 'hidden',
  },
  row: {
    minHeight: minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowPressed: { backgroundColor: colors.surfaceRaised },
  rowText: { ...typography.body, color: colors.text },
  // The "Use ..." row is gold, like a text link, so it reads as a different choice.
  otherText: { ...typography.body, color: colors.accent },
});
