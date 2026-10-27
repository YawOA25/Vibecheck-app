/**
 * The date filter on the home list (VC-63): a compact row of chips, "This
 * week" (the default), "This weekend", "Pick a date" and "Custom", in the
 * v3 pill look. "Pick a date" adds one date box under the row; "Custom"
 * adds "From" and "To" boxes. The boxes open the phone's own date picker
 * (src/components/DateField.tsx).
 *
 * Accessibility: the chips are radio buttons in one group ("Dates"), so
 * screen readers say "This week, radio button, checked, 1 of 4". The date
 * boxes are buttons named "Night", "From" and "To" with the date as their
 * value.
 *
 * The rules for which nights each filter covers live in
 * src/lib/date-filter.ts; this component only draws the choices and hands
 * a tidy filter (in order, within the cap) back to the screen.
 */
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ChoiceChip } from '@/components/ChoiceChip';
import { DateField } from '@/components/DateField';
import { FILTER_LABELS, MAX_RANGE_NIGHTS, filterNights } from '@/lib/date-filter';
import type { DateFilter } from '@/lib/date-filter';
import { addDays, nightOf } from '@/lib/tonight';
import type { CivilDate } from '@/lib/tonight';
import { colors, spacing, typography } from '@/theme';

/** What a DateFilterBar needs. */
export interface DateFilterBarProps {
  /** The filter in use. */
  filter: DateFilter;
  /** The current moment (for "tonight", the earliest pickable night). */
  now: Date;
  /** Called with the new filter. */
  onChange: (filter: DateFilter) => void;
}

/** The note under the Custom boxes (exported so tests use the same words). */
export const RANGE_NOTE = `Up to ${MAX_RANGE_NIGHTS} nights at a time.`;

/** How many nights a new Custom range covers before the guest changes it. */
const DEFAULT_RANGE_NIGHTS = 14;

/**
 * Renders the chips and, for "Pick a date" and "Custom", the date boxes.
 *
 * @returns the filter view.
 */
export function DateFilterBar({ filter, now, onChange }: DateFilterBarProps) {
  const tonight = nightOf(now);

  /**
   * Hands back a range in order, starting no earlier than tonight and cut
   * to the cap, so the boxes always show what the list really covers.
   *
   * @param from - the picked start night.
   * @param to - the picked end night.
   */
  function changeRange(from: CivilDate, to: CivilDate) {
    const { first, last } = filterNights({ kind: 'range', from, to }, now);
    onChange({ kind: 'range', from: first, to: last });
  }

  /** The four chips: what each one picks when tapped. */
  const chips: { kind: DateFilter['kind']; pick: () => void }[] = [
    { kind: 'week', pick: () => onChange({ kind: 'week' }) },
    { kind: 'weekend', pick: () => onChange({ kind: 'weekend' }) },
    // Starting on tonight; the box below changes it. Tapping the chip again
    // keeps the date already picked.
    {
      kind: 'date',
      pick: () => {
        if (filter.kind !== 'date') onChange({ kind: 'date', night: tonight });
      },
    },
    {
      kind: 'range',
      pick: () => {
        if (filter.kind !== 'range') {
          onChange({
            kind: 'range',
            from: tonight,
            to: addDays(tonight, DEFAULT_RANGE_NIGHTS - 1),
          });
        }
      },
    },
  ];

  return (
    <View style={styles.wrapper}>
      {/* A sideways-scrolling row, so the chips never squash on a small phone. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        accessibilityRole="radiogroup"
        accessibilityLabel="Dates"
      >
        {chips.map((chip) => (
          <ChoiceChip
            key={chip.kind}
            label={FILTER_LABELS[chip.kind]}
            selected={filter.kind === chip.kind}
            onPress={chip.pick}
            shape="pill"
            role="radio"
          />
        ))}
      </ScrollView>

      {filter.kind === 'date' ? (
        <DateField
          label="Night"
          value={filter.night}
          minimum={tonight}
          onChange={(night) => onChange({ kind: 'date', night })}
          testID="night-picker"
        />
      ) : null}

      {filter.kind === 'range' ? (
        <View style={styles.range}>
          <DateField
            label="From"
            value={filter.from}
            minimum={tonight}
            onChange={(from) => changeRange(from, filter.to)}
            testID="from-picker"
          />
          <DateField
            label="To"
            value={filter.to}
            minimum={filter.from}
            maximum={addDays(filter.from, MAX_RANGE_NIGHTS - 1)}
            onChange={(to) => changeRange(filter.from, to)}
            testID="to-picker"
          />
          <Text style={styles.note}>{RANGE_NOTE}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  range: { gap: spacing.sm },
  note: { ...typography.caption, color: colors.muted },
});
