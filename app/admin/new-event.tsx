/**
 * Admin "New event" screen (task VC-B04), in the v3 look.
 *
 * Who sees it: only admins. The Tonight header shows a "New event" button
 * only for them, and the root layout (app/_layout.tsx) only lets admins open
 * this address. The real lock is on the server: `create_event` refuses
 * anyone who isn't an admin, even with a hand-made request.
 *
 * What the admin does (goal: under 1 minute on the phone, at the party):
 *   1. types a name and the neighbourhood (never the address);
 *   2. checks the start and end (dates start on today);
 *   3. taps "Use my current location" while standing at the party;
 *   4. sets switches: party code fallback, test event, 21+, staff pick;
 *   5. for staff picks (VC-29), adds the ticket link and our own summary;
 *   6. taps "Create event", then sees the party code to print, with an
 *      option to swap it for a new one ("code rotate").
 *
 * The form's rules live in src/lib/event-form.ts (tested on their own).
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { FormMessage } from '@/components/FormMessage';
import { Headline } from '@/components/Headline';
import { TextField } from '@/components/TextField';
import { ToggleRow } from '@/components/ToggleRow';
import { DATE_INPUT_MAX_LENGTH, formatDateInput } from '@/lib/age';
import {
  dateInputFor,
  DEFAULT_RADIUS_M,
  MAX_AREA_LENGTH,
  MAX_SUMMARY_WORDS,
  MAX_TITLE_LENGTH,
  validateEventForm,
  wordCount,
} from '@/lib/event-form';
import type { EventFormErrors, EventFormField, EventFormValues } from '@/lib/event-form';
import { createEvent, rotateEventCode } from '@/lib/events-api';
import type { EventSaveResult } from '@/lib/events-api';
import { getCurrentPin } from '@/lib/location';
import { formatLatLng, parseLocationInput } from '@/lib/map-link';
import { colors, radius, spacing, typography } from '@/theme';

/** The four date and time boxes, which are checked together. */
const TIME_BOXES: EventFormField[] = ['startDate', 'startTime', 'endDate', 'endTime'];

/**
 * The form's starting values: dates on today, the default radius, all
 * switches off.
 *
 * @param now - the current moment.
 * @returns a fresh set of form values.
 */
function initialValues(now: Date): EventFormValues {
  const today = dateInputFor(now);
  return {
    title: '',
    areaLabel: '',
    startDate: today,
    startTime: '',
    endDate: today,
    endTime: '',
    radius: String(DEFAULT_RADIUS_M),
    codeEnabled: false,
    isTest: false,
    isStaffPick: false,
    is21Plus: false,
    ticketUrl: '',
    summary: '',
    pin: null,
  };
}

/**
 * Renders the New event form, and after saving, the party code.
 *
 * @returns the screen view. It takes no inputs.
 */
export default function NewEventScreen() {
  const router = useRouter();
  const [values, setValues] = useState<EventFormValues>(() => initialValues(new Date()));
  const [errors, setErrors] = useState<EventFormErrors>({});
  // A message under the Create button (server refusal, no internet).
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  // "Enter location" (VC-29 staff picks): whether the box is open, and its text.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState('');
  // Set once the event is saved: the screen then shows the party code.
  const [saved, setSaved] = useState<EventSaveResult | null>(null);

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

  /** Reads the phone's position once and puts it on the form. Returns nothing. */
  async function fillMyLocation() {
    setLocating(true);
    const outcome = await getCurrentPin();
    setLocating(false);
    if (outcome.status === 'ok') {
      update('pin', outcome.pin);
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
   * Reads the typed coordinates or pasted map link on the phone (no network
   * call) and puts the pin on the form, or shows why it couldn't. Returns
   * nothing.
   */
  function applyManualLocation() {
    const parsed = parseLocationInput(manualText);
    if (parsed.ok) {
      update('pin', { ...parsed.pin, accuracyM: null, typed: true });
      return;
    }
    setErrors((current) => ({ ...current, pin: parsed.message }));
  }

  /** Checks the form, then sends it to the server. Returns nothing. */
  async function submit() {
    setMessage(null);
    const checked = validateEventForm(values, new Date());
    if (!checked.ok) {
      setErrors(checked.errors);
      setMessage('Fix the highlighted boxes, then try again.');
      return;
    }
    setErrors({});
    setSaving(true);
    const outcome = await createEvent(checked.input);
    setSaving(false);
    if (outcome.ok) setSaved(outcome.result);
    else setMessage(outcome.message);
  }

  /** Swaps the party code for a new one ("code rotate"). Returns nothing. */
  async function rotateCode() {
    if (!saved) return;
    setSaving(true);
    setMessage(null);
    const outcome = await rotateEventCode(saved.eventId);
    setSaving(false);
    if (outcome.ok) setSaved(outcome.result);
    else setMessage(outcome.message);
  }

  /** Leaves the screen, back to Tonight. */
  function close() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  // ---- After saving: show the party code ----------------------------------
  if (saved) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <Headline lead="Event" highlight="created" />
          <Text style={styles.body}>
            {values.codeEnabled
              ? 'Print or write this party code on a card at the door. Guests whose GPS fails can type it in.'
              : 'The party code fallback is off. This code will work if you turn it on later.'}
          </Text>
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>Party code</Text>
            {/* Letters are spaced out so they're easy to copy onto a card. */}
            <Text
              style={styles.code}
              accessibilityLabel={`Party code ${saved.checkInCode.split('').join(' ')}`}
            >
              {saved.checkInCode}
            </Text>
          </View>
          <Button
            label="Get a new code"
            variant="outline"
            busy={saving}
            busyLabel="Getting a new code..."
            onPress={rotateCode}
          />
          {message ? <FormMessage message={message} /> : null}
          <Button label="Done" onPress={close} disabled={saving} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- The form ------------------------------------------------------------
  const summaryWords = wordCount(values.summary);
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <BackButton onPress={close} disabled={saving} />
          <Headline lead="New" highlight="event" />
          <Text style={styles.body}>Only admins can see this screen.</Text>

          <TextField
            label="Event name"
            value={values.title}
            onChangeText={(text) => update('title', text)}
            error={errors.title}
            maxLength={MAX_TITLE_LENGTH}
            autoCapitalize="sentences"
            placeholder="Saturday rooftop"
          />
          <TextField
            label="Area"
            value={values.areaLabel}
            onChangeText={(text) => update('areaLabel', text)}
            error={errors.areaLabel}
            helper="Neighbourhood only, like Shaw, DC. Never the address."
            maxLength={MAX_AREA_LENGTH}
            autoCapitalize="words"
            placeholder="Shaw, DC"
          />

          {/* Date and time sit side by side: the date box is wider. */}
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
              label={values.pin ? 'Update my location' : 'Use my current location'}
              variant="outline"
              busy={locating}
              busyLabel="Finding you..."
              onPress={fillMyLocation}
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
                Stand at the event. Guests never see the exact spot.
              </Text>
            ) : null}
            {/* Second way, for staff picks added from home (VC-29): paste a
                map link or type coordinates. Read on the phone only. */}
            {manualOpen ? (
              <>
                <TextField
                  label="Map link or coordinates"
                  value={manualText}
                  onChangeText={(text) => {
                    setManualText(text);
                    // Typing again clears the old "couldn't read that" message.
                    setErrors((current) => {
                      const next = { ...current };
                      delete next.pin;
                      return next;
                    });
                  }}
                  helper="Paste a full Google or Apple Maps link, or type like 38.9172, -77.0320."
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Button
                  label="Set this location"
                  variant="outline"
                  onPress={applyManualLocation}
                  disabled={saving}
                />
              </>
            ) : (
              <Button
                label="Enter location"
                variant="text"
                size="small"
                onPress={() => setManualOpen(true)}
                disabled={saving}
              />
            )}
          </View>

          <TextField
            label="Check-in radius (metres)"
            value={values.radius}
            onChangeText={(text) => update('radius', text.replace(/\D/g, ''))}
            error={errors.radius}
            helper="Guests this close can check in. 150 suits most places."
            keyboardType="number-pad"
            maxLength={4}
          />

          <ToggleRow
            label="Party code check-in"
            helper="For guests whose GPS fails indoors. You get the code after saving."
            value={values.codeEnabled}
            onValueChange={(on) => update('codeEnabled', on)}
          />
          <ToggleRow
            label="Test event"
            helper="Only testers see it. Use for trying things out."
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

          <Button label="Create event" busyLabel="Saving..." busy={saving} onPress={submit} />
          {message ? <FormMessage message={message} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { padding: spacing.authGutter, gap: 14 },
  body: { ...typography.body, color: colors.muted },
  // flexWrap lets the time box drop under the date box when text is very large.
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.gap12 },
  dateCol: { flexGrow: 3, flexBasis: 170 },
  timeCol: { flexGrow: 2, flexBasis: 120 },
  group: { gap: spacing.sm },
  label: { ...typography.label, color: colors.muted, textTransform: 'uppercase' },
  helper: { ...typography.caption, color: colors.muted },
  codeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  codeLabel: { ...typography.label, color: colors.muted, textTransform: 'uppercase' },
  code: { ...typography.h1, color: colors.accent, letterSpacing: 6 },
});
