/**
 * The Custom dates picker for the home list (VC-63, revised 2026-10-27).
 *
 * Why it exists: the founder reported "with custom when i select a date its
 * still on the ui". The old version put an iPhone date wheel inside the
 * list and left it there. This one never leaves a picker on the screen:
 *
 *   - iPhone: a bottom sheet (a pop-up panel from the bottom) with the
 *     calendar, a "Start" and an "End (optional)" box, and Cancel / Done.
 *     Picking a start date moves straight on to the end date; tapping Done
 *     (or Cancel, or the dimmed area) closes the sheet.
 *   - Android: the phone's own calendar dialog, twice: first "Start date"
 *     (Next / Cancel), then "End date (optional)" (Done / One night). Each
 *     dialog closes itself when a date is picked.
 *
 * Either way the guest picks one date or a start-to-end range (up to 60
 * nights), and the home list only changes once they finish. The rules for
 * the start and end live in src/lib/date-filter.ts (pickStart, pickEnd,
 * customFromDraft) and are tested on their own.
 *
 * Dates are night dates in New York time. The picker is handed noon New
 * York on a date (safely inside the day whatever daylight saving does) and
 * the picked moment is read back as a New York date.
 */
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import {
  MAX_RANGE_NIGHTS,
  customFromDraft,
  latestEnd,
  pickEnd,
  pickStart,
} from '@/lib/date-filter';
import type { CustomDraft, DateFilter } from '@/lib/date-filter';
import { EVENT_TIME_ZONE, newYorkDate, nightOf, shortDate, zonedMoment } from '@/lib/tonight';
import type { CivilDate } from '@/lib/tonight';
import { colors, minTapTarget, radius, spacing, typography } from '@/theme';

/** The note about the cap (exported so tests use the same words). */
export const RANGE_NOTE = `One date or a range, up to ${MAX_RANGE_NIGHTS} nights.`;

/** What the end box says when no end is picked (exported for tests). */
export const ONE_NIGHT = 'One night';

/**
 * Noon New York on a date, the moment handed to the picker.
 *
 * @param date - the calendar date.
 * @returns that moment.
 */
function noonOf(date: CivilDate): Date {
  return zonedMoment(date, 12);
}

/**
 * Android: runs the two-dialog flow (start date, then optional end date).
 *
 * @param initial - where the dialogs start (the current Custom dates, or
 *   tonight).
 * @param now - the current moment (tonight is the earliest pickable night).
 * @param onDone - called with the finished Custom filter. Not called if the
 *   guest cancels the first dialog (the list stays as it was).
 * @returns nothing; the dialogs are the phone's own.
 */
export function openAndroidCustomFlow(
  initial: CustomDraft,
  now: Date,
  onDone: (filter: DateFilter) => void,
) {
  DateTimePickerAndroid.open({
    mode: 'date',
    value: noonOf(initial.start),
    timeZoneName: EVENT_TIME_ZONE,
    minimumDate: noonOf(nightOf(now)),
    // `title` shows on Material 3 dialogs; the button words show on all.
    title: 'Start date',
    positiveButton: { label: 'Next' },
    negativeButton: { label: 'Cancel' },
    onValueChange: (_event, picked) => {
      const draft = pickStart(initial, newYorkDate(picked));
      // Second dialog: the end. "One night" (or the back button) keeps just
      // the start date.
      DateTimePickerAndroid.open({
        mode: 'date',
        value: noonOf(draft.end ?? draft.start),
        timeZoneName: EVENT_TIME_ZONE,
        minimumDate: noonOf(draft.start),
        maximumDate: noonOf(latestEnd(draft.start)),
        title: 'End date (optional)',
        positiveButton: { label: 'Done' },
        negativeButton: { label: ONE_NIGHT },
        onValueChange: (_e, end) => onDone(customFromDraft(pickEnd(draft, newYorkDate(end)), now)),
        onDismiss: () => onDone(customFromDraft({ start: draft.start, end: null }, now)),
      });
    },
  });
}

/** What the iPhone sheet needs. */
export interface CustomDatesSheetProps {
  /** Where the sheet starts (the current Custom dates, or tonight). */
  initial: CustomDraft;
  /** The current moment (tonight is the earliest pickable night). */
  now: Date;
  /** Closes the sheet without changing anything. */
  onCancel: () => void;
  /** Called with the finished Custom filter when the guest taps Done. */
  onDone: (filter: DateFilter) => void;
}

/**
 * iPhone: the bottom sheet with the calendar. Mount it only while it should
 * show (the parent renders it conditionally), so each opening starts fresh
 * from `initial`.
 *
 * @returns a Modal: dimmed background plus the panel.
 */
export function CustomDatesSheet({ initial, now, onCancel, onDone }: CustomDatesSheetProps) {
  const [draft, setDraft] = useState<CustomDraft>(initial);
  // Which box the calendar is changing: the start, or the end.
  const [step, setStep] = useState<'start' | 'end'>('start');
  const tonight = nightOf(now);
  const editing = step === 'start' ? draft.start : (draft.end ?? draft.start);

  /**
   * A day was tapped in the calendar.
   *
   * @param moment - the picked moment (read back as a New York date).
   */
  function picked(moment: Date) {
    const date = newYorkDate(moment);
    if (step === 'start') {
      setDraft(pickStart(draft, date));
      // Straight on to the (optional) end date: one clean flow.
      setStep('end');
    } else {
      setDraft(pickEnd(draft, date));
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        {/* Tapping the dimmed area above the panel cancels, like most sheets. */}
        <Pressable
          style={styles.dismissArea}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Close date picker"
        />
        <View style={styles.panel}>
          <Text style={styles.title} accessibilityRole="header">
            Choose dates
          </Text>
          <View style={styles.slots}>
            <Slot
              label="Start"
              value={shortDate(draft.start)}
              active={step === 'start'}
              onPress={() => setStep('start')}
            />
            <Slot
              label="End (optional)"
              value={draft.end ? shortDate(draft.end) : ONE_NIGHT}
              active={step === 'end'}
              onPress={() => setStep('end')}
            />
          </View>
          <DateTimePicker
            testID="custom-picker"
            mode="date"
            display="inline"
            value={noonOf(editing)}
            timeZoneName={EVENT_TIME_ZONE}
            minimumDate={noonOf(step === 'start' ? tonight : draft.start)}
            maximumDate={step === 'end' ? noonOf(latestEnd(draft.start)) : undefined}
            themeVariant="dark"
            accentColor={colors.accent}
            accessibilityLabel={step === 'start' ? 'Start date' : 'End date'}
            onValueChange={(_event, moment) => picked(moment)}
          />
          <Text style={styles.note}>
            {step === 'end' ? 'Pick an end date, or keep one night. ' : ''}
            {RANGE_NOTE}
          </Text>
          <View style={styles.actions}>
            {draft.end ? (
              <Button
                label="Clear end"
                variant="text"
                size="small"
                onPress={() => setDraft({ start: draft.start, end: null })}
              />
            ) : null}
            <View style={styles.spacer} />
            <Button label="Cancel" variant="outline" size="small" onPress={onCancel} />
            <Button label="Done" size="small" onPress={() => onDone(customFromDraft(draft, now))} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * One of the two boxes at the top of the sheet ("Start", "End (optional)").
 *
 * @param props.label - the box's name.
 * @param props.value - the date shown, or "One night".
 * @param props.active - whether the calendar is changing this box (gold edge).
 * @param props.onPress - makes this box the one the calendar changes.
 * @returns a pressable box, read out as e.g. "Start, Sat, Nov 7, selected".
 */
function Slot({
  label,
  value,
  active,
  onPress,
}: {
  label: string;
  value: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={{ text: value }}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.slot, active && styles.slotActive]}
    >
      <Text style={styles.slotLabel}>{label}</Text>
      <Text style={styles.slotValue}>{value}</Text>
    </Pressable>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  dismissArea: { flex: 1 },
  panel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.gap12,
  },
  title: { ...typography.cardTitle, color: colors.text },
  slots: { flexDirection: 'row', gap: spacing.sm },
  slot: {
    flex: 1,
    minHeight: minTapTarget,
    paddingHorizontal: spacing.gap12,
    paddingVertical: spacing.sm,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    backgroundColor: colors.surfaceRaised,
    gap: 2,
  },
  // Gold 2 px edge on the box being changed (like a focused text box); the
  // padding shrinks by 1 so the text doesn't jump.
  slotActive: {
    borderWidth: 2,
    borderColor: colors.accent,
    paddingHorizontal: spacing.gap12 - 1,
    paddingVertical: spacing.sm - 1,
  },
  slotLabel: { ...typography.label, color: colors.muted, textTransform: 'uppercase' },
  slotValue: { ...typography.input, color: colors.text },
  note: { ...typography.caption, color: colors.muted },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  spacer: { flex: 1 },
});
