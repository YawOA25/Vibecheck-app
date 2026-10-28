/**
 * The date filter on the home list (VC-63, revised by the founder
 * 2026-10-27): a compact row of chips, "Tonight", "This weekend", "This
 * week" (the default) and "Custom", in the v3 pill look.
 *
 * Custom: tapping the chip opens the date picker (src/components/
 * CustomDatesPicker.tsx): a bottom sheet on iPhone, the phone's calendar
 * dialogs on Android. The list only switches to Custom once the guest
 * finishes (Done); cancelling keeps the filter they had. While Custom is
 * picked, the chosen dates show under the chips as tappable text ("Nov 6 –
 * Nov 9") that opens the picker again. No picker ever stays in the list.
 *
 * Accessibility: the chips are radio buttons in one group ("Dates"), so
 * screen readers say "This week, radio button, checked, 3 of 4". The dates
 * summary is a button named "Custom dates" with the dates as its value.
 *
 * The rules for which nights each filter covers live in
 * src/lib/date-filter.ts; this component only draws the choices and hands
 * a tidy filter (in order, within the cap) back to the screen.
 */
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ChoiceChip } from '@/components/ChoiceChip';
import { CustomDatesSheet, openAndroidCustomFlow } from '@/components/CustomDatesPicker';
import { FILTER_LABELS, FILTER_ORDER, draftFor, filterNights, rangeText } from '@/lib/date-filter';
import type { CustomDraft, DateFilter } from '@/lib/date-filter';
import { colors, minTapTarget, spacing, typography } from '@/theme';

/** What a DateFilterBar needs. */
export interface DateFilterBarProps {
  /** The filter in use. */
  filter: DateFilter;
  /** The current moment (for "tonight", the earliest pickable night). */
  now: Date;
  /** Called with the new filter. */
  onChange: (filter: DateFilter) => void;
}

/**
 * Renders the chips, the Custom dates summary, and (iPhone, while open)
 * the Custom dates sheet.
 *
 * @returns the filter view.
 */
export function DateFilterBar({ filter, now, onChange }: DateFilterBarProps) {
  // iPhone only: where the open sheet started, or null while it's closed.
  const [sheet, setSheet] = useState<CustomDraft | null>(null);

  /** Opens the Custom picker, starting from the current Custom dates or tonight. */
  function openCustom() {
    const initial = draftFor(filter, now);
    if (Platform.OS === 'android') openAndroidCustomFlow(initial, now, onChange);
    else setSheet(initial);
  }

  /**
   * A chip was tapped.
   *
   * @param kind - which chip.
   */
  function pick(kind: DateFilter['kind']) {
    if (kind === 'custom') openCustom();
    else onChange({ kind });
  }

  // The Custom summary words, e.g. "Nov 6 – Nov 9" (tidied like the list).
  let summary: string | null = null;
  if (filter.kind === 'custom') {
    const { first, last } = filterNights(filter, now);
    summary = rangeText(first, last);
  }

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
        {FILTER_ORDER.map((kind) => (
          <ChoiceChip
            key={kind}
            label={FILTER_LABELS[kind]}
            selected={filter.kind === kind}
            onPress={() => pick(kind)}
            shape="pill"
            role="radio"
          />
        ))}
      </ScrollView>

      {summary ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Custom dates"
          accessibilityValue={{ text: summary }}
          accessibilityHint="Opens the date picker."
          onPress={openCustom}
          hitSlop={8}
          style={styles.summary}
        >
          <Text style={styles.summaryText}>{summary}</Text>
          <Text style={styles.change}>Change</Text>
        </Pressable>
      ) : null}

      {sheet ? (
        <CustomDatesSheet
          initial={sheet}
          now={now}
          onCancel={() => setSheet(null)}
          onDone={(next) => {
            setSheet(null);
            onChange(next);
          }}
        />
      ) : null}
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  // The dates line: the dates in plain text, then a gold "Change" link.
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
    minHeight: minTapTarget,
  },
  summaryText: { ...typography.bodySm, color: colors.text },
  change: { ...typography.label, color: colors.accent },
});
