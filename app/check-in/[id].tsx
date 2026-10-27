/**
 * Check-in screen (task VC-B06), in the v3 look (design/v3/Checkin.dc.html,
 * wireframe S4).
 *
 * Address: /check-in/<event id>. Opened by "I'm here" on the event page.
 *
 * What happens, step by step:
 *   1. Load the event's public facts (name and neighbourhood) to ask
 *      "You at <event>?". Never a map or an address: the app can't read
 *      them (they live in event_private, VC-20). The v3 mockup shows a map
 *      and a street address; both are left out on purpose.
 *   2. On "Yep, I'm here": ask for location permission if needed, take ONE
 *      foreground reading (src/lib/check-in-location.ts) and send it to the
 *      server's check_in function (src/lib/check-in-api.ts).
 *   3. Show the result: passed, too far, weak signal (offers the party code),
 *      too early or too late, a limit reached, or a permission problem.
 *      All wording lives in src/lib/check-in-screens.ts.
 *
 * Privacy: the reading is passed straight from step 2's reader to the
 * server call. It is never put in screen state, shown, or logged.
 *
 * The party code (task VC-B07): "GPS not working? Enter the party code"
 * under the main button, and "Enter the party code" on the weak-signal and
 * permission screens, open the code screen (app/join/[id].tsx).
 *
 * Not here on purpose: "Rate the night" (task VC-B08).
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { FormMessage } from '@/components/FormMessage';
import { Headline } from '@/components/Headline';
import { submitCheckIn } from '@/lib/check-in-api';
import { readLocationForCheckIn } from '@/lib/check-in-location';
import { resultScreen } from '@/lib/check-in-screens';
import type { CheckInAction, CheckInView } from '@/lib/check-in-screens';
import { getEvent } from '@/lib/events-read';
import type { PublicEvent } from '@/lib/tonight';
import { colors, radius, spacing, typography } from '@/theme';

/** The words on this screen (exported so tests use the same text). */
export const CHECK_IN_LABEL = 'CHECK IN';
export const CHECKED_IN_LABEL = 'CHECKED IN';
export const PRIVACY_NOTE =
  'Quick location check, just once. We never track you or save where you are.';
export const IM_HERE = "Yep, I'm here";
export const NOT_THIS_ONE = 'Not this one';
export const GPS_NOT_WORKING = 'GPS not working? Enter the party code';
export const CHECKING = 'Checking...';
export const NOT_FOUND_TITLE = 'Event not found';

/** What the screen is showing. */
type Phase =
  | { kind: 'loading' }
  | { kind: 'loadError'; message: string }
  | { kind: 'notFound' }
  /** "You at <event>?" with the button (busy while checking). */
  | { kind: 'confirm'; event: PublicEvent; checking: boolean }
  /** A result screen (see check-in-screens.ts). */
  | { kind: 'result'; event: PublicEvent; view: CheckInView }
  /** The server call failed (network, bad reading...). */
  | { kind: 'error'; event: PublicEvent; message: string };

/**
 * Renders the check-in screen.
 *
 * Returns: the screen's view. Its input is the `id` in the address.
 */
export default function CheckInScreen() {
  const router = useRouter();
  // The id from /check-in/<id>; expo-router may hand over a list, so take the first.
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  // Bumped by "Try again" after a load error, to load once more.
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Load the event's public facts. State is only set when the answer
  // arrives, and a late answer is ignored if the screen has closed.
  useEffect(() => {
    let active = true;
    const load = id ? getEvent(id) : Promise.resolve({ ok: true as const, event: null });
    load.then((outcome) => {
      if (!active) return;
      if (!outcome.ok) setPhase({ kind: 'loadError', message: outcome.message });
      else if (!outcome.event) setPhase({ kind: 'notFound' });
      else setPhase({ kind: 'confirm', event: outcome.event, checking: false });
    });
    return () => {
      active = false;
    };
  }, [id, loadAttempt]);

  /** Back to the event page, or home if there's no history. */
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  /**
   * "Yep, I'm here" (and "Try again"): read the location once, send it,
   * show the result.
   *
   * @param event - the event being checked in to.
   */
  const runCheckIn = useCallback(async (event: PublicEvent) => {
    setPhase({ kind: 'confirm', event, checking: true });
    const reading = await readLocationForCheckIn();
    if (reading.kind !== 'reading') {
      // A phone-side problem (permission, approximate, no fix): nothing was
      // sent to the server.
      setPhase({ kind: 'result', event, view: { source: 'phone', kind: reading.kind } });
      return;
    }
    // The reading goes straight into the request and is then forgotten.
    const outcome = await submitCheckIn(event.id, reading.reading);
    if (outcome.ok) {
      setPhase({ kind: 'result', event, view: { source: 'server', result: outcome.result } });
    } else if (outcome.kind === 'notFound') {
      setPhase({ kind: 'notFound' });
    } else {
      setPhase({ kind: 'error', event, message: outcome.message });
    }
  }, []);

  /**
   * Carries out a result-screen button.
   *
   * @param action - which button was tapped.
   * @param event - the event on screen.
   */
  const onAction = useCallback(
    (action: CheckInAction, event: PublicEvent) => {
      switch (action) {
        case 'retry':
          void runCheckIn(event);
          break;
        case 'settings':
          // Opens VibeCheck's page in the phone's Settings (the location switch).
          Linking.openSettings().catch(() => {});
          break;
        case 'code':
          router.push({ pathname: '/join/[id]', params: { id: event.id } });
          break;
        case 'back':
          goBack();
          break;
      }
    },
    [goBack, router, runCheckIn],
  );

  const checking = phase.kind === 'confirm' && phase.checking;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <BackButton onPress={goBack} disabled={checking} />
      </View>

      {phase.kind === 'loading' ? (
        <View style={styles.centre} accessible accessibilityLabel="Loading the event">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : null}

      {phase.kind === 'loadError' ? (
        <View style={styles.centre}>
          <FormMessage message={phase.message} />
          <Button
            label="Try again"
            variant="outline"
            onPress={() => {
              setPhase({ kind: 'loading' });
              setLoadAttempt((n) => n + 1);
            }}
          />
        </View>
      ) : null}

      {phase.kind === 'notFound' ? (
        <View style={styles.centre}>
          <Text style={styles.notFoundTitle} accessibilityRole="header">
            {NOT_FOUND_TITLE}
          </Text>
          <Text style={styles.muted}>It may have been removed, or the link is wrong.</Text>
        </View>
      ) : null}

      {phase.kind === 'confirm' ? (
        <Sheet>
          <Text style={styles.label}>{CHECK_IN_LABEL}</Text>
          <Headline lead="You at" highlight={`${phase.event.title}?`} />
          <Text style={styles.muted}>{phase.event.area_label}</Text>
          <View style={styles.note}>
            {/* A small diamond mark, drawn with text so we need no icon package. */}
            <Text
              style={styles.noteIcon}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              {'◈'}
            </Text>
            <Text style={styles.noteText}>{PRIVACY_NOTE}</Text>
          </View>
          <Button
            label={IM_HERE}
            busy={phase.checking}
            busyLabel={CHECKING}
            onPress={() => void runCheckIn(phase.event)}
          />
          {/* The indoor fallback, offered up front as well as after a weak signal. */}
          <Button
            label={GPS_NOT_WORKING}
            variant="text"
            size="small"
            onPress={() => onAction('code', phase.event)}
            disabled={phase.checking}
          />
          <Button label={NOT_THIS_ONE} variant="text" onPress={goBack} disabled={phase.checking} />
        </Sheet>
      ) : null}

      {phase.kind === 'result' ? (
        <ResultSheet
          view={phase.view}
          event={phase.event}
          onAction={(action) => onAction(action, phase.event)}
        />
      ) : null}

      {phase.kind === 'error' ? (
        <Sheet>
          <Text style={styles.label}>{CHECK_IN_LABEL}</Text>
          <FormMessage message={phase.message} />
          <Button label="Try again" onPress={() => void runCheckIn(phase.event)} />
          <Button label="Back to the event" variant="text" onPress={goBack} />
        </Sheet>
      ) : null}
    </SafeAreaView>
  );
}

/**
 * One result screen: headline, sentence and buttons.
 *
 * @param props.view - what happened.
 * @param props.event - the event (its name goes in the sentence).
 * @param props.onAction - called with the tapped button's action.
 * @returns the result sheet.
 */
function ResultSheet({
  view,
  event,
  onAction,
}: {
  view: CheckInView;
  event: PublicEvent;
  onAction: (action: CheckInAction) => void;
}) {
  const content = resultScreen(view, event.title);
  const last = content.actions.length - 1;
  return (
    <Sheet>
      <Text style={[styles.label, content.success && styles.successLabel]}>
        {content.success ? CHECKED_IN_LABEL : CHECK_IN_LABEL}
      </Text>
      <Headline lead={content.lead} highlight={content.highlight} />
      {/* Read aloud when it appears, so screen-reader users hear the result. */}
      <Text style={styles.body} accessibilityLiveRegion="polite">
        {content.body}
      </Text>
      {content.actions.map((button, index) => (
        <Button
          key={button.action}
          label={button.label}
          // The first button is the main (gold) one; the last of several is
          // a quiet text link; any in between are outlined.
          variant={index === 0 ? 'primary' : index === last ? 'text' : 'outline'}
          onPress={() => onAction(button.action)}
        />
      ))}
    </Sheet>
  );
}

/**
 * The v3 bottom sheet: empty space above, then a raised panel with a small
 * grab handle and rounded top corners. Scrolls if the text is large.
 *
 * @param props.children - what goes in the panel.
 * @returns the sheet view.
 */
function Sheet({ children }: { children: ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.sheetScroll} bounces={false}>
      <View style={styles.sheet}>
        <View style={styles.handle} />
        {children}
      </View>
    </ScrollView>
  );
}

/** Styles built from theme tokens (plus the v3 sheet's 28 px corners and 20 px sides). */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  centre: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.authGutter,
  },
  notFoundTitle: { ...typography.h1, color: colors.text, textAlign: 'center' },
  muted: { ...typography.bodySm, color: colors.muted },
  body: { ...typography.body, color: colors.muted },
  // Pushes the sheet to the bottom of the screen, like the v3 mockup.
  sheetScroll: { flexGrow: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.borderStrong,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: spacing.gap12,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
  },
  label: { ...typography.label, color: colors.muted },
  successLabel: { color: colors.success },
  note: {
    flexDirection: 'row',
    gap: spacing.gap12,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.field,
    paddingVertical: spacing.gap12,
    paddingHorizontal: 14,
  },
  noteIcon: { ...typography.bodySm, color: colors.accent },
  noteText: { ...typography.caption, color: colors.muted, flex: 1 },
});
