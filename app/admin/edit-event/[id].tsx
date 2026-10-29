/**
 * Admin "Edit event" screen (task VC-34), in the v3 look.
 *
 * Address: /admin/edit-event/<event id>. Opened by "Edit event" on the
 * admin view of the event page (app/event/[id].tsx).
 *
 * Who sees it: only admins. The event page shows the button only to them,
 * and the root layout (app/_layout.tsx) only lets admins open this address.
 * The real lock is on the server: `update_event` refuses anyone who isn't an
 * admin, even with a hand-made request.
 *
 * What the admin does:
 *   1. the form opens filled in with the event's name, state (VC-37), area,
 *      New York dates and times, switches, ticket link and summary;
 *   2. they fix whatever is wrong. The map pin and radius can't be shown
 *      (the app can't read them, VC-20), so they're kept unless the admin
 *      taps "Use my current location instead" / "Enter location", or types
 *      a new radius;
 *   3. "Save changes" sends ONLY what changed to update_event (anything not
 *      sent stays as it is), then goes back to the event page, which
 *      reloads.
 *
 * Rules that still apply (task B04): times are New York time whatever the
 * phone's zone; the Test event switch can't change once people have checked
 * in (the server answers VCTST and its message is shown under Save).
 *
 * The boxes are the same as New event (src/components/EventForm.tsx); the
 * rules are in src/lib/event-form.ts (validateEventEdit).
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { EventFormFields, useEventForm } from '@/components/EventForm';
import { FadeIn } from '@/components/FadeIn';
import { FormMessage } from '@/components/FormMessage';
import { Headline } from '@/components/Headline';
import { validateEventEdit, valuesFromEvent } from '@/lib/event-form';
import type { EditableEvent } from '@/lib/event-form';
import { getEventForEdit, updateEvent } from '@/lib/events-api';
import { FORM_SCROLL_PROPS, KEYBOARD_BEHAVIOR } from '@/lib/keyboard';
import { useDelayedFlag } from '@/lib/use-delayed-flag';
import { colors, spacing, typography } from '@/theme';

/** The words on this screen (exported so tests use the same text). */
export const SAVE_LABEL = 'Save changes';
export const NOTHING_CHANGED = 'Nothing has changed yet.';
export const FIX_BOXES = 'Fix the highlighted boxes, then try again.';

/** What the screen is showing while it loads the event. */
type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'notFound' }
  | { kind: 'ready'; event: EditableEvent };

/**
 * Renders the Edit event screen: loads the event, then shows the form.
 *
 * Returns: the screen's view. Its input is the `id` in the address.
 */
export default function EditEventScreen() {
  const router = useRouter();
  // The id from the address; expo-router may hand over a list, so take the first.
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  // Bumped by "Try again" to load once more.
  const [attempt, setAttempt] = useState(0);

  // Load the event's editable details. State is only set when the answer
  // arrives, and a late answer is ignored if the screen has closed.
  useEffect(() => {
    let active = true;
    const load = id ? getEventForEdit(id) : Promise.resolve({ ok: true as const, event: null });
    load.then((outcome) => {
      if (!active) return;
      if (!outcome.ok) setState({ kind: 'error', message: outcome.message });
      else if (!outcome.event) setState({ kind: 'notFound' });
      else setState({ kind: 'ready', event: outcome.event });
    });
    return () => {
      active = false;
    };
  }, [id, attempt]);

  /** Back to the event page (or home if there's no history). */
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);
  // VC-76: the spinner only after 300 ms of loading (no flash on fast loads).
  const showSpinner = useDelayedFlag(state.kind === 'loading');

  if (state.kind === 'ready') {
    // `key`: a different event gets a fresh form, never the old one's values.
    return <EditForm key={state.event.id} event={state.event} onDone={close} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <BackButton onPress={close} />
      </View>
      {state.kind === 'loading' ? (
        <View style={styles.centre} accessible accessibilityLabel="Loading the event">
          {showSpinner ? <ActivityIndicator color={colors.accent} size="large" /> : null}
        </View>
      ) : null}
      {state.kind === 'error' ? (
        <View style={styles.centre}>
          <FormMessage message={state.message} />
          <Button
            label="Try again"
            variant="outline"
            onPress={() => {
              setState({ kind: 'loading' });
              setAttempt((n) => n + 1);
            }}
          />
        </View>
      ) : null}
      {state.kind === 'notFound' ? (
        <View style={styles.centre}>
          <Text style={styles.title} accessibilityRole="header">
            Event not found
          </Text>
          <Text style={styles.body}>It may have been removed, or the link is wrong.</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/**
 * The filled-in form and its Save button.
 *
 * @param props.event - the event as loaded (the form starts from it, and
 *   only differences from it are sent).
 * @param props.onDone - called after a successful save (goes back).
 * @returns the form view.
 */
function EditForm({ event, onDone }: { event: EditableEvent; onDone: () => void }) {
  const form = useEventForm(valuesFromEvent(event));
  // A message under the Save button (nothing changed, server refusal...).
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Checks the form, sends only the changes, then goes back. Returns nothing. */
  async function save() {
    setMessage(null);
    const checked = validateEventEdit(form.values, event, new Date());
    if (!checked.ok) {
      form.setErrors(checked.errors);
      setMessage(FIX_BOXES);
      return;
    }
    form.setErrors({});
    if (!checked.changed) {
      setMessage(NOTHING_CHANGED);
      return;
    }
    setSaving(true);
    const outcome = await updateEvent(checked.input);
    setSaving(false);
    // The reply also carries the party code; it isn't shown or kept here
    // (the event page has "Show party code" for that, VC-35).
    if (outcome.ok) onDone();
    else setMessage(outcome.message);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        // VC-76: room for the keyboard on both platforms (src/lib/keyboard.ts).
        behavior={KEYBOARD_BEHAVIOR}
      >
        {/* VC-76: the loaded form fades in. */}
        <FadeIn style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content} {...FORM_SCROLL_PROPS}>
            <BackButton onPress={onDone} disabled={saving} />
            <Headline lead="Edit" highlight="event" />
            <Text style={styles.body}>Only admins can see this screen.</Text>

            <EventFormFields form={form} mode="edit" saving={saving} />

            <Button label={SAVE_LABEL} busyLabel="Saving..." busy={saving} onPress={save} />
            {message ? <FormMessage message={message} /> : null}
          </ScrollView>
        </FadeIn>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  content: { padding: spacing.authGutter, gap: 14 },
  centre: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  title: { ...typography.cardTitle, color: colors.text, textAlign: 'center' },
  body: { ...typography.body, color: colors.muted },
});
