/**
 * Admin "New event" screen (task VC-B04), in the v3 look.
 *
 * Who sees it: only admins. It opens from the gold plus in the bottom bar
 * (VC-82, src/components/TabBar.tsx), which only admins see, and the root
 * layout (app/_layout.tsx) only lets admins open this address. The real lock is on the server: `create_event` refuses
 * anyone who isn't an admin, even with a hand-made request.
 *
 * What the admin does (goal: under 1 minute on the phone, at the party):
 *   1. types a name, picks the state (DC, Maryland or Virginia), then
 *      searches and picks the neighbourhood, or uses what they typed
 *      (never the address; VC-37);
 *   2. checks the start and end (dates start on today);
 *   3. taps "Use my current location" while standing at the party;
 *   4. sets switches: party code fallback, test event, 21+, staff pick;
 *   5. for staff picks (VC-29), adds the ticket link and our own summary;
 *   6. taps "Create event", then sees the party code to print, with an
 *      option to swap it for a new one ("code rotate").
 *
 * After saving (VC-63b), it leaves a note for the home list
 * (src/lib/created-event.ts) so the list reloads when the admin goes back,
 * and says where to find the event if the date filter hides it.
 *
 * The form's boxes are shared with Edit event (src/components/EventForm.tsx,
 * VC-34); its rules live in src/lib/event-form.ts (tested on their own).
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { EventFormFields, useEventForm } from '@/components/EventForm';
import { FormMessage } from '@/components/FormMessage';
import { Headline } from '@/components/Headline';
import { PartyCodeCard } from '@/components/PartyCodeCard';
import { dateInputFor, DEFAULT_RADIUS_M, validateEventForm } from '@/lib/event-form';
import type { EventFormValues } from '@/lib/event-form';
import { noteCreatedEvent } from '@/lib/created-event';
import { createEvent, rotateEventCode } from '@/lib/events-api';
import type { EventSaveResult } from '@/lib/events-api';
import { FORM_SCROLL_PROPS, KEYBOARD_BEHAVIOR } from '@/lib/keyboard';
import { colors, spacing, typography } from '@/theme';

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
    state: null,
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
    entryUrl: '',
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
  // The form itself (values, errors, location buttons) is shared with
  // Edit event: src/components/EventForm.tsx.
  const form = useEventForm(initialValues(new Date()));
  const { values, setErrors } = form;
  // A message under the Create button (server refusal, no internet).
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Set once the event is saved: the screen then shows the party code.
  const [saved, setSaved] = useState<EventSaveResult | null>(null);

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
    if (outcome.ok) {
      // Tell the home list to reload (and maybe say where the event is).
      noteCreatedEvent({ id: outcome.result.eventId, startsAt: checked.input.p_starts_at });
      setSaved(outcome.result);
    } else {
      setMessage(outcome.message);
    }
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

  /** Leaves the screen, back to where the admin was (usually Home). */
  function close() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  // ---- After saving: show the party code ----------------------------------
  if (saved) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} {...FORM_SCROLL_PROPS}>
          <Headline lead="Event" highlight="created" />
          <Text style={styles.body}>
            {values.codeEnabled
              ? 'Print or write this party code on a card at the door. Guests whose GPS fails can type it in.'
              : 'The party code fallback is off. This code will work if you turn it on later.'}
          </Text>
          <PartyCodeCard code={saved.checkInCode} />
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
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        // VC-76: room for the keyboard on both platforms (src/lib/keyboard.ts).
        behavior={KEYBOARD_BEHAVIOR}
      >
        <ScrollView contentContainerStyle={styles.content} {...FORM_SCROLL_PROPS}>
          <BackButton onPress={close} disabled={saving} />
          <Headline lead="New" highlight="event" />
          <Text style={styles.body}>Only admins can see this screen.</Text>

          <EventFormFields form={form} mode="create" saving={saving} />

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
});
