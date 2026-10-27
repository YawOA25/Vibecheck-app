/**
 * The admin event form, shared by "New event" (app/admin/new-event.tsx, task
 * VC-B04) and "Edit event" (app/admin/edit-event/[id].tsx, task VC-34).
 *
 * What's here:
 *   - useEventForm: the form's memory (what's typed, the error per box, the
 *     location buttons' busy state) and the actions that change it;
 *   - EventFormFields: the boxes, the Area picker (VC-37,
 *     src/components/AreaPicker.tsx), location buttons and switches, in the
 *     v3 look. Each screen adds its own heading and Save button around it.
 *
 * Why shared: one form means one set of boxes, helpers and rules, so "New"
 * and "Edit" can't drift apart. The rules themselves live in
 * src/lib/event-form.ts.
 *
 * Edit mode differences (mode="edit"):
 *   - the app can't read the current map pin or radius (they live in
 *     event_private, VC-20), so the location says "Keeping the current
 *     location" until the admin sets a new one, and the radius box is empty
 *     with "Leave empty to keep the current radius";
 *   - the Test event switch explains it can't change once people have
 *     checked in (the server enforces that, error VCTST).
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AreaPicker } from '@/components/AreaPicker';
import { Button } from '@/components/Button';
import { FormMessage } from '@/components/FormMessage';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TextField } from '@/components/TextField';
import { ToggleRow } from '@/components/ToggleRow';
import { AREA_STATES, stateForPin, stateOfListedArea } from '@/data/dmv-areas';
import type { AreaState } from '@/data/dmv-areas';
import { DATE_INPUT_MAX_LENGTH, formatDateInput } from '@/lib/age';
import { MAX_SUMMARY_WORDS, MAX_TITLE_LENGTH, wordCount } from '@/lib/event-form';
import type {
  EventFormErrors,
  EventFormField,
  EventFormMode,
  EventFormValues,
} from '@/lib/event-form';
import { getCurrentPin } from '@/lib/location';
import { formatLatLng, parseLocationInput } from '@/lib/map-link';
import { colors, spacing, typography } from '@/theme';

/** The four date and time boxes, which are checked together. */
const TIME_BOXES: EventFormField[] = ['startDate', 'startTime', 'endDate', 'endTime'];

/** Shown in edit mode while the event keeps its current pin (exported for tests). */
export const KEEPING_LOCATION = 'Keeping the current location. Set a new one only if it moved.';

/** Everything {@link useEventForm} gives a screen. */
export interface EventFormState {
  values: EventFormValues;
  errors: EventFormErrors;
  /** Replaces all box errors at once (after checking the whole form). */
  setErrors: (errors: EventFormErrors) => void;
  /** Changes one value and clears that box's error. */
  update: <K extends keyof EventFormValues>(
    field: K,
    value: EventFormValues[K],
    errorField?: EventFormField,
  ) => void;
  /** True while "Use my current location" is reading the GPS. */
  locating: boolean;
  /** Reads the phone's position once and puts it on the form. */
  fillMyLocation: () => Promise<void>;
  /** Whether the "Enter location" box is open, and its text. */
  manualOpen: boolean;
  openManual: () => void;
  manualText: string;
  changeManualText: (text: string) => void;
  /** Reads the typed coordinates or pasted map link into the pin. */
  applyManualLocation: () => void;
  /**
   * Picks the state (VC-37). An area chosen from the list in ANOTHER state
   * is cleared, since it no longer fits.
   */
  chooseState: (state: AreaState) => void;
  /** Changes whenever the Area box must start afresh (its own text resets). */
  areaResetKey: number;
}

/**
 * Holds the event form's state and the actions that change it.
 *
 * @param initial - the starting values (empty for New event, the event's
 *   current details for Edit event). Only read on the first render.
 * @returns the values, errors and actions (see {@link EventFormState}).
 */
export function useEventForm(initial: EventFormValues): EventFormState {
  const [values, setValues] = useState<EventFormValues>(initial);
  const [errors, setErrors] = useState<EventFormErrors>({});
  const [locating, setLocating] = useState(false);
  // "Enter location" (VC-29 staff picks): whether the box is open, and its text.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState('');
  // Bumped when changing the state clears the area, so the Area box (which
  // keeps its own typed text) starts empty again.
  const [areaResetKey, setAreaResetKey] = useState(0);

  /**
   * Changes one value on the form and clears that box's error.
   *
   * @param field - which value.
   * @param value - its new value.
   * @param errorField - which box's error to clear (defaults to `field`).
   */
  function update<K extends keyof EventFormValues>(
    field: K,
    value: EventFormValues[K],
    errorField?: EventFormField,
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    const key = errorField ?? (field as EventFormField);
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      // The "end after start" and "24 hours at most" messages sit on the end
      // boxes but are about all four time boxes, so editing any of them
      // clears those too.
      if (TIME_BOXES.includes(key)) {
        delete next.endTime;
        delete next.endDate;
      }
      return next;
    });
  }

  /**
   * Puts a new pin on the form and, if no state is picked yet, preselects
   * the state from where the pin is (a rough offline guess, VC-37). The
   * admin can still change it.
   *
   * @param pin - the new pin.
   */
  function setPin(pin: NonNullable<EventFormValues['pin']>) {
    update('pin', pin);
    const guess = stateForPin(pin.lat, pin.lng);
    if (!guess) return;
    setValues((current) => (current.state ? current : { ...current, state: guess }));
    setErrors((current) => {
      const next = { ...current };
      delete next.state;
      return next;
    });
  }

  /**
   * Picks the state, clearing an area from the list that belongs to a
   * different state. Typed ("Use ...") areas are kept: they have no state.
   *
   * @param state - the chosen state.
   */
  function chooseState(state: AreaState) {
    const areaState = stateOfListedArea(values.areaLabel);
    update('state', state);
    if (areaState && areaState !== state) {
      update('areaLabel', '');
      setAreaResetKey((n) => n + 1);
    }
  }

  /** Reads the phone's position once and puts it on the form. Returns nothing. */
  async function fillMyLocation() {
    setLocating(true);
    const outcome = await getCurrentPin();
    setLocating(false);
    if (outcome.status === 'ok') {
      setPin(outcome.pin);
      return;
    }
    setErrors((current) => ({
      ...current,
      pin:
        outcome.status === 'denied'
          ? 'Location access is off. Allow it for VibeCheck in your phone settings, then try again.'
          : "We couldn't find your location. Step outside or near a window and try again.",
    }));
  }

  /**
   * Updates the "Enter location" text. Typing again clears the old
   * "couldn't read that" message.
   *
   * @param text - the new text.
   */
  function changeManualText(text: string) {
    setManualText(text);
    setErrors((current) => {
      const next = { ...current };
      delete next.pin;
      return next;
    });
  }

  /**
   * Reads the typed coordinates or pasted map link on the phone (no network
   * call) and puts the pin on the form, or shows why it couldn't. Returns
   * nothing.
   */
  function applyManualLocation() {
    const parsed = parseLocationInput(manualText);
    if (parsed.ok) {
      setPin({ ...parsed.pin, accuracyM: null, typed: true });
      return;
    }
    setErrors((current) => ({ ...current, pin: parsed.message }));
  }

  return {
    values,
    chooseState,
    areaResetKey,
    errors,
    setErrors,
    update,
    locating,
    fillMyLocation,
    manualOpen,
    openManual: () => setManualOpen(true),
    manualText,
    changeManualText,
    applyManualLocation,
  };
}

/** What {@link EventFormFields} needs. */
export interface EventFormFieldsProps {
  /** The state from {@link useEventForm}. */
  form: EventFormState;
  /** 'create' (New event) or 'edit' (Edit event). */
  mode: EventFormMode;
  /** True while saving, to lock the location buttons. */
  saving: boolean;
}

/**
 * Draws every box, location button and switch of the event form.
 *
 * @returns the fields, top to bottom, without a heading or Save button.
 */
export function EventFormFields({ form, mode, saving }: EventFormFieldsProps) {
  const { values, errors, update } = form;
  const editing = mode === 'edit';
  const summaryWords = wordCount(values.summary);

  // The location button's words: the first pin, a fresh reading, or (edit
  // mode) swapping the event's current pin for where the admin is now.
  const locationLabel = values.pin
    ? 'Update my location'
    : editing
      ? 'Use my current location instead'
      : 'Use my current location';

  return (
    <>
      <TextField
        label="Event name"
        value={values.title}
        onChangeText={(text) => update('title', text)}
        error={errors.title}
        maxLength={MAX_TITLE_LENGTH}
        autoCapitalize="sentences"
        placeholder="Saturday rooftop"
      />
      {/* VC-37: pick from the DMV list, or "Other (type it)". */}
      <SegmentedControl
        label="State"
        options={AREA_STATES.map((s) => ({ value: s.code, label: s.name }))}
        value={values.state}
        onChange={form.chooseState}
        error={errors.state}
        helper="Pick first: the area search only shows this state's neighbourhoods."
      />
      <AreaPicker
        key={form.areaResetKey}
        state={values.state}
        value={values.areaLabel}
        onChange={(label) => update('areaLabel', label)}
        error={errors.areaLabel}
      />

      {/* Date and time sit side by side: the date box is wider. All times
          are New York time, whatever zone the phone is in (B04). */}
      <View style={styles.row}>
        <View style={styles.dateCol}>
          <TextField
            label="Start date"
            value={values.startDate}
            onChangeText={(text) => update('startDate', formatDateInput(text))}
            error={errors.startDate}
            keyboardType="number-pad"
            maxLength={DATE_INPUT_MAX_LENGTH}
            placeholder="MM / DD / YYYY"
          />
        </View>
        <View style={styles.timeCol}>
          <TextField
            label="Start time"
            value={values.startTime}
            onChangeText={(text) => update('startTime', text)}
            error={errors.startTime}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="10:00 PM"
          />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.dateCol}>
          <TextField
            label="End date"
            value={values.endDate}
            onChangeText={(text) => update('endDate', formatDateInput(text))}
            error={errors.endDate}
            keyboardType="number-pad"
            maxLength={DATE_INPUT_MAX_LENGTH}
            placeholder="MM / DD / YYYY"
          />
        </View>
        <View style={styles.timeCol}>
          <TextField
            label="End time"
            value={values.endTime}
            onChangeText={(text) => update('endTime', text)}
            error={errors.endTime}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="2:00 AM"
          />
        </View>
      </View>

      {/* Location: the exact spot is sent to the server and kept private. */}
      <View style={styles.group}>
        <Text style={styles.label}>Location</Text>
        <Button
          label={locationLabel}
          variant="outline"
          busy={form.locating}
          busyLabel="Finding you..."
          onPress={form.fillMyLocation}
          disabled={saving}
        />
        {values.pin ? (
          <FormMessage
            tone="success"
            message={
              // A typed pin shows its numbers so the admin can check them.
              values.pin.typed
                ? `Location set to ${formatLatLng(values.pin)}. Check it matches the venue.`
                : values.pin.accuracyM
                  ? `Location set (accurate to about ${Math.round(values.pin.accuracyM)} m).`
                  : 'Location set.'
            }
          />
        ) : null}
        {errors.pin ? <FormMessage message={errors.pin} /> : null}
        {!values.pin && !errors.pin ? (
          <Text style={styles.helper}>
            {editing ? KEEPING_LOCATION : 'Stand at the event. Guests never see the exact spot.'}
          </Text>
        ) : null}
        {/* Second way, for staff picks added from home (VC-29): paste a
            map link or type coordinates. Read on the phone only. */}
        {form.manualOpen ? (
          <>
            <TextField
              label="Map link or coordinates"
              value={form.manualText}
              onChangeText={form.changeManualText}
              helper="Paste a full Google or Apple Maps link, or type like 38.9172, -77.0320."
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Button
              label="Set this location"
              variant="outline"
              onPress={form.applyManualLocation}
              disabled={saving}
            />
          </>
        ) : (
          <Button
            label="Enter location"
            variant="text"
            size="small"
            onPress={form.openManual}
            disabled={saving}
          />
        )}
      </View>

      <TextField
        label="Check-in radius (metres)"
        value={values.radius}
        onChangeText={(text) => update('radius', text.replace(/\D/g, ''))}
        error={errors.radius}
        helper={
          editing
            ? 'Leave empty to keep the current radius, or enter 25 to 1000.'
            : 'Guests this close can check in. 150 suits most places.'
        }
        keyboardType="number-pad"
        maxLength={4}
        placeholder={editing ? 'Keep current' : undefined}
      />

      <ToggleRow
        label="Party code check-in"
        helper={
          editing
            ? 'For guests whose GPS fails indoors. See the code on the event page.'
            : 'For guests whose GPS fails indoors. You get the code after saving.'
        }
        value={values.codeEnabled}
        onValueChange={(on) => update('codeEnabled', on)}
      />
      <ToggleRow
        label="Test event"
        helper={
          editing
            ? "Only testers see it. Can't change once people have checked in."
            : 'Only testers see it. Use for trying things out.'
        }
        value={values.isTest}
        onValueChange={(on) => update('isTest', on)}
      />
      <ToggleRow
        label="21+ only"
        value={values.is21Plus}
        onValueChange={(on) => update('is21Plus', on)}
      />
      <ToggleRow
        label="Staff pick"
        helper="A venue event we picked, shown with a Staff pick label."
        value={values.isStaffPick}
        onValueChange={(on) => update('isStaffPick', on)}
      />

      <TextField
        label="Ticket link (optional)"
        value={values.ticketUrl}
        onChangeText={(text) => update('ticketUrl', text)}
        error={errors.ticketUrl}
        helper="https:// links on eventbrite.com only."
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="https://www.eventbrite.com/e/..."
      />
      <TextField
        label="Summary (optional)"
        value={values.summary}
        onChangeText={(text) => update('summary', text)}
        error={errors.summary}
        helper={`In our own words, never copied. ${summaryWords} of ${MAX_SUMMARY_WORDS} words.`}
        autoCapitalize="sentences"
        placeholder="Afrobeats on the roof, sunset start."
      />
    </>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  // flexWrap lets the time box drop under the date box when text is very large.
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.gap12 },
  dateCol: { flexGrow: 3, flexBasis: 170 },
  timeCol: { flexGrow: 2, flexBasis: 120 },
  group: { gap: spacing.sm },
  label: { ...typography.label, color: colors.muted, textTransform: 'uppercase' },
  helper: { ...typography.caption, color: colors.muted },
});
