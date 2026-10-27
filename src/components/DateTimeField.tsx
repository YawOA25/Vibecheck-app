/**
 * A date-and-time field that opens the phone's own pickers, used for
 * "Starts" and "Ends" on New and Edit event (founder: "dates are hard to
 * type", decisions.md 2026-10-27).
 *
 * What the admin sees: a box in the v3 field style that reads, for example,
 * "Sat, Nov 7 · 10:00 PM". Tapping it opens:
 *   - on iPhone: the spinning date-and-time wheel under the box, in the dark
 *     theme, with a "Done" button;
 *   - on Android: the phone's calendar dialog, then its clock dialog.
 *
 * Time zone: both pickers are told to show New York time (timeZoneName), so
 * a phone set to Tokyo still shows and picks the party's own clock time.
 * The picked moment is turned back into the form's text with pickedParts
 * (src/lib/event-form.ts), so all the form's rules stay the same.
 *
 * Why a separate component: the start and end fields are identical apart
 * from their words and values, and the platform differences live in one
 * place.
 */
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { FormMessage } from '@/components/FormMessage';
import { pickedParts, readableDateTime } from '@/lib/event-form';
import { EVENT_TIME_ZONE } from '@/lib/tonight';
import { colors, fieldHeight, radius, spacing, typography } from '@/theme';

/** What a DateTimeField needs. */
export interface DateTimeFieldProps {
  /** Shown above the box and read by screen readers, for example "Starts". */
  label: string;
  /** The form's date text, for example "11 / 07 / 2026". */
  date: string;
  /** The form's time text, for example "10 PM" ('' until picked). */
  time: string;
  /** Where the picker opens when nothing is picked yet (a real moment). */
  initialMoment: Date;
  /**
   * Called with the new text after a pick. Android picks the date and the
   * time in two steps, so either part may come alone.
   */
  onChange: (parts: { date?: string; time?: string }) => void;
  /** An error sentence for this field, shown under the box. */
  error?: string | null;
  /** Lets tests find the iPhone wheel. */
  testID?: string;
}

/**
 * Renders the field and opens the right picker for the phone.
 *
 * @returns the field view (label, box, optional wheel, optional error).
 */
export function DateTimeField({
  label,
  date,
  time,
  initialMoment,
  onChange,
  error,
  testID,
}: DateTimeFieldProps) {
  // iPhone only: whether the wheel is showing, and the moment it shows.
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(initialMoment);
  const readable = readableDateTime(date, time);
  const hasTime = time.trim() !== '';

  /** Opens the picker: the wheel on iPhone, two dialogs on Android. */
  function openPicker() {
    if (Platform.OS === 'android') {
      // Step 1: the calendar. Step 2 (only if a date was chosen): the clock,
      // starting on the chosen day. This is the library's documented way to
      // pick both on Android, which has no combined dialog.
      DateTimePickerAndroid.open({
        mode: 'date',
        value: initialMoment,
        timeZoneName: EVENT_TIME_ZONE,
        onValueChange: (_event, pickedDay) => {
          onChange({ date: pickedParts(pickedDay).date });
          DateTimePickerAndroid.open({
            mode: 'time',
            value: pickedDay,
            timeZoneName: EVENT_TIME_ZONE,
            is24Hour: false,
            onValueChange: (_e, pickedTime) => onChange({ time: pickedParts(pickedTime).time }),
          });
        },
      });
      return;
    }
    // iPhone: start the wheel on the current value and show it.
    setDraft(initialMoment);
    setOpen(!open);
  }

  /**
   * iPhone wheel moved: remember it and fill the form straight away, so
   * nothing is lost if the admin scrolls on without tapping Done.
   *
   * @param moment - the moment now under the wheel.
   */
  function wheelChanged(moment: Date) {
    setDraft(moment);
    onChange(pickedParts(moment));
  }

  /** "Done": keeps what the wheel shows (even if it never moved) and closes it. */
  function done() {
    onChange(pickedParts(draft));
    setOpen(false);
  }

  return (
    <View style={styles.wrapper}>
      {/* Screen readers skip this label: the box below carries the same words. */}
      <Text
        style={styles.label}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: readable || 'Not set' }}
        accessibilityHint={error ?? 'Opens the date and time picker. New York time.'}
        onPress={openPicker}
        style={[styles.box, open && styles.boxOpen, error ? styles.boxError : null]}
      >
        <Text style={[styles.value, !hasTime && styles.placeholder]}>
          {readable || 'Pick a date and time'}
        </Text>
      </Pressable>
      {Platform.OS === 'ios' && open ? (
        <View style={styles.wheel}>
          <DateTimePicker
            testID={testID}
            mode="datetime"
            display="spinner"
            value={draft}
            timeZoneName={EVENT_TIME_ZONE}
            themeVariant="dark"
            textColor={colors.text}
            onValueChange={(_event, moment) => wheelChanged(moment)}
          />
          <Button label="Done" variant="outline" size="small" onPress={done} />
        </View>
      ) : null}
      {error ? <FormMessage message={error} /> : null}
    </View>
  );
}

/** Styles built only from theme tokens, matching TextField's box. */
const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  label: { ...typography.label, color: colors.muted, textTransform: 'uppercase' },
  box: {
    minHeight: fieldHeight,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    backgroundColor: colors.surface,
  },
  // Gold 2 px edge while the wheel is open (like a focused text box).
  boxOpen: {
    borderWidth: 2,
    borderColor: colors.accent,
    paddingHorizontal: spacing.md - 1,
    paddingVertical: 13,
  },
  boxError: {
    borderWidth: 2,
    borderColor: colors.error,
    paddingHorizontal: spacing.md - 1,
    paddingVertical: 13,
  },
  value: { ...typography.input, color: colors.text },
  // "Pick a time" parts read in the muted colour, like a placeholder.
  placeholder: { color: colors.muted },
  wheel: {
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.field,
    backgroundColor: colors.surface,
  },
});
