/**
 * A date-only field that opens the phone's own date picker, for the home
 * list's date filter (VC-63: "Pick a date" and "Custom").
 *
 * What the guest sees: a box in the v3 field style reading, for example,
 * "Sat, Nov 7". Tapping it opens:
 *   - on iPhone: the date wheel under the box, in the dark theme, with a
 *     "Done" button;
 *   - on Android: the phone's calendar dialog.
 *
 * It uses the same picker package and the same New York time zone as the
 * admin form's DateTimeField (src/components/DateTimeField.tsx). That one
 * also picks a clock time and fills the form's text boxes, so the filter
 * gets this smaller date-only sibling instead of a pile of special cases.
 *
 * The value is a night's date (the evening's calendar date). The picker is
 * given noon New York on that date, which is safely inside the day whatever
 * daylight saving does, and the picked moment is read back as a New York
 * date (newYorkDate in src/lib/tonight.ts).
 */
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { EVENT_TIME_ZONE, newYorkDate, shortDate, zonedMoment } from '@/lib/tonight';
import type { CivilDate } from '@/lib/tonight';
import { colors, fieldHeight, radius, spacing, typography } from '@/theme';

/** What a DateField needs. */
export interface DateFieldProps {
  /** Shown above the box and read by screen readers, e.g. "Night" or "From". */
  label: string;
  /** The date shown and where the picker opens. */
  value: CivilDate;
  /** Called with the picked date. */
  onChange: (date: CivilDate) => void;
  /** The earliest date the picker allows (e.g. tonight). */
  minimum?: CivilDate;
  /** The latest date the picker allows (e.g. the end of a 60-night range). */
  maximum?: CivilDate;
  /** Lets tests find the iPhone wheel. */
  testID?: string;
}

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
 * Renders the field and opens the right picker for the phone.
 *
 * @returns the field view (label, box, and on iPhone the wheel when open).
 */
export function DateField({ label, value, onChange, minimum, maximum, testID }: DateFieldProps) {
  // iPhone only: whether the wheel is showing, and the date it shows.
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(() => noonOf(value));
  const readable = shortDate(value);
  const minimumDate = minimum ? noonOf(minimum) : undefined;
  const maximumDate = maximum ? noonOf(maximum) : undefined;

  /** Opens the picker: the wheel on iPhone, the calendar dialog on Android. */
  function openPicker() {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        mode: 'date',
        value: noonOf(value),
        timeZoneName: EVENT_TIME_ZONE,
        minimumDate,
        maximumDate,
        onValueChange: (_event, picked) => onChange(newYorkDate(picked)),
      });
      return;
    }
    setDraft(noonOf(value));
    setOpen(!open);
  }

  /** "Done": keeps what the wheel shows (even if it never moved) and closes it. */
  function done() {
    onChange(newYorkDate(draft));
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
        accessibilityValue={{ text: readable }}
        accessibilityHint="Opens the date picker."
        onPress={openPicker}
        style={[styles.box, open && styles.boxOpen]}
      >
        <Text style={styles.value}>{readable}</Text>
      </Pressable>
      {Platform.OS === 'ios' && open ? (
        <View style={styles.wheel}>
          <DateTimePicker
            testID={testID}
            mode="date"
            display="spinner"
            value={draft}
            timeZoneName={EVENT_TIME_ZONE}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            themeVariant="dark"
            textColor={colors.text}
            accessibilityLabel={`${label} date picker`}
            // The wheel moved: remember it and update the list straight away.
            onValueChange={(_event, moment) => {
              setDraft(moment);
              onChange(newYorkDate(moment));
            }}
          />
          <Button label="Done" variant="outline" size="small" onPress={done} />
        </View>
      ) : null}
    </View>
  );
}

/** Styles built only from theme tokens, matching DateTimeField's box. */
const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
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
  value: { ...typography.input, color: colors.text },
  wheel: {
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.field,
    backgroundColor: colors.surface,
  },
});
