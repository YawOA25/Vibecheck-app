/**
 * Party-code screen (task VC-B07), in the v3 look (the code boxes from the
 * sign-in screen, spec section 2.2, with letters instead of digits).
 *
 * Address: /join/<event id>. Opened by "GPS not working? Enter the party
 * code" on the check-in sheet, and by "Enter the party code" on the
 * check-in result screens (weak signal, location off, and so on).
 *
 * What happens, step by step:
 *   1. Load the event's public facts (name, and whether it's a test event).
 *   2. The guest types the 6-character code from the card at the party and
 *      taps "Check me in". The code goes to the server's
 *      check_in_with_code (src/lib/code-check-in-api.ts), which decides.
 *   3. A wrong code stays on the form: the boxes turn coral and the
 *      sentence says how many tries are left. Anything else (checked in,
 *      locked after 5 wrong codes, too early or too late, code switched
 *      off, a limit) replaces the form with a result screen. All wording
 *      lives in src/lib/join-screens.ts.
 *   Testers (profiles.is_tester) on a TEST event also see "Tester
 *   check-in", which checks them in with no GPS and no code. The server
 *   refuses it on real events anyway; hiding it is just tidiness.
 *
 * Privacy: the typed code is kept only in the box while typing, sent once,
 * and cleared after a wrong try. It is never logged or shown elsewhere.
 *
 * Motion and keyboard (VC-76, design/vc76-motion-spec.md): the screen rises
 * as a sheet from the bottom (app/_layout.tsx); on iPhone a swipe down
 * closes it, except while a code is being checked. The spinner only shows
 * if loading takes over 300 ms; the form and the result fade in. The
 * keyboard pushes the form up on both platforms (src/lib/keyboard.ts).
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
import { CodeInput } from '@/components/CodeInput';
import { FadeIn } from '@/components/FadeIn';
import { FormMessage } from '@/components/FormMessage';
import { Headline } from '@/components/Headline';
import { useAuth } from '@/lib/auth-context';
import type { ResultScreen } from '@/lib/check-in-screens';
import {
  PARTY_CODE_LENGTH,
  cleanPartyCode,
  submitCodeCheckIn,
  submitTesterCheckIn,
} from '@/lib/code-check-in-api';
import type { CodeCheckInOutcome } from '@/lib/code-check-in-api';
import { getEvent } from '@/lib/events-read';
import { tapSuccess, tapWarning } from '@/lib/haptics';
import { INCOMPLETE_CODE_MESSAGE, joinResultScreen, wrongCodeMessage } from '@/lib/join-screens';
import { FORM_SCROLL_PROPS, KEYBOARD_BEHAVIOR } from '@/lib/keyboard';
import { useSwipeToClose } from '@/lib/swipe-close';
import type { PublicEvent } from '@/lib/tonight';
import { useDelayedFlag } from '@/lib/use-delayed-flag';
import { colors, spacing, typography } from '@/theme';

/** The words on this screen (exported so tests use the same text). */
export const PARTY_CODE_LABEL = 'PARTY CODE';
export const CODE_FIELD_LABEL = '6-character party code';
export const CHECK_ME_IN = 'Check me in';
export const CHECKING = 'Checking...';
export const TESTER_CHECK_IN = 'Tester check-in (test events only)';
export const NOT_FOUND_TITLE = 'Event not found';

/** What the screen is showing. */
type Phase =
  | { kind: 'loading' }
  | { kind: 'loadError'; message: string }
  | { kind: 'notFound' }
  /** The code form. `busy` while a check is running. */
  | { kind: 'form'; event: PublicEvent; busy: boolean }
  /** A result that ends the form (see join-screens.ts). */
  | { kind: 'result'; event: PublicEvent; screen: ResultScreen };

/**
 * Renders the party-code screen.
 *
 * Returns: the screen's view. Its input is the `id` in the address.
 */
export default function JoinScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  // The id from /join/<id>; expo-router may hand over a list, so take the first.
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [code, setCode] = useState('');
  // The coral sentence under the boxes (wrong code, incomplete, bad format).
  const [codeError, setCodeError] = useState<string | null>(null);
  // A problem that isn't about the code itself (network, signed out...).
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped by "Try again" after a load error, to load once more.
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Load the event's public facts. State is set only when the answer
  // arrives, and a late answer is ignored if the screen has closed.
  useEffect(() => {
    let active = true;
    const load = id ? getEvent(id) : Promise.resolve({ ok: true as const, event: null });
    load.then((outcome) => {
      if (!active) return;
      if (!outcome.ok) setPhase({ kind: 'loadError', message: outcome.message });
      else if (!outcome.event) setPhase({ kind: 'notFound' });
      else setPhase({ kind: 'form', event: outcome.event, busy: false });
    });
    return () => {
      active = false;
    };
  }, [id, loadAttempt]);

  /** Back to the previous screen, or home if there's no history. */
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  /**
   * Shows the server's answer: a wrong code stays on the form; any other
   * answer becomes a result screen; errors show a sentence.
   *
   * @param event - the event on screen.
   * @param outcome - what the code or tester check-in returned.
   */
  const showOutcome = useCallback((event: PublicEvent, outcome: CodeCheckInOutcome) => {
    if (outcome.ok) {
      if (outcome.result.status === 'wrong_code') {
        // The phone's "warning" buzz, next to the coral sentence (VC-32d).
        tapWarning();
        // Clear the boxes so the next try starts fresh (and the wrong code
        // doesn't linger on screen).
        setCode('');
        setCodeError(wrongCodeMessage(outcome.result.triesLeft));
        setPhase({ kind: 'form', event, busy: false });
      } else {
        // The "success" buzz only when the check-in passed (VC-32d).
        if (outcome.result.status === 'passed') tapSuccess();
        setPhase({ kind: 'result', event, screen: joinResultScreen(outcome.result, event.title) });
      }
    } else if (outcome.kind === 'notFound') {
      setPhase({ kind: 'notFound' });
    } else if (outcome.kind === 'badCode') {
      setCodeError(outcome.message);
      setPhase({ kind: 'form', event, busy: false });
    } else {
      setNotice(outcome.message);
      setPhase({ kind: 'form', event, busy: false });
    }
  }, []);

  /**
   * "Check me in": checks the code is complete, then asks the server.
   *
   * @param event - the event on screen.
   */
  const submitCode = useCallback(
    async (event: PublicEvent) => {
      setNotice(null);
      if (code.length < PARTY_CODE_LENGTH) {
        setCodeError(INCOMPLETE_CODE_MESSAGE);
        return;
      }
      setCodeError(null);
      setPhase({ kind: 'form', event, busy: true });
      showOutcome(event, await submitCodeCheckIn(event.id, code));
    },
    [code, showOutcome],
  );

  /**
   * "Tester check-in": no GPS, no code (test events only; the server checks).
   *
   * @param event - the test event on screen.
   */
  const submitTester = useCallback(
    async (event: PublicEvent) => {
      setNotice(null);
      setCodeError(null);
      setPhase({ kind: 'form', event, busy: true });
      showOutcome(event, await submitTesterCheckIn(event.id));
    },
    [showOutcome],
  );

  const busy = phase.kind === 'form' && phase.busy;
  // VC-76: no swipe-down close while a code is being checked.
  useSwipeToClose(!busy);
  // VC-76: the spinner only after 300 ms of loading (no flash on fast loads).
  const showSpinner = useDelayedFlag(phase.kind === 'loading');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <BackButton onPress={goBack} disabled={busy} />
      </View>

      {phase.kind === 'loading' ? (
        <View style={styles.centre} accessible accessibilityLabel="Loading the event">
          {showSpinner ? <ActivityIndicator color={colors.accent} size="large" /> : null}
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
          <Text style={styles.title} accessibilityRole="header">
            {NOT_FOUND_TITLE}
          </Text>
          <Text style={styles.body}>It may have been removed, or the link is wrong.</Text>
        </View>
      ) : null}

      {phase.kind === 'form' ? (
        // VC-76: the keyboard pushes the form up (both platforms), and the
        // form fades in once loaded.
        <KeyboardAvoidingView style={styles.fill} behavior={KEYBOARD_BEHAVIOR}>
          <FadeIn style={styles.fill}>
            <ScrollView contentContainerStyle={styles.form} {...FORM_SCROLL_PROPS}>
              <Text style={styles.label}>{PARTY_CODE_LABEL}</Text>
              <Headline lead="Enter the" highlight="party code." />
              <Text style={styles.body}>
                Look for the card at {phase.event.title}, or ask the host. It&apos;s{' '}
                {PARTY_CODE_LENGTH} letters and numbers.
              </Text>
              <CodeInput
                value={code}
                onChangeText={(text) => {
                  // Capitals, letters and digits only; typing clears an old error.
                  setCode(cleanPartyCode(text));
                  setCodeError(null);
                }}
                length={PARTY_CODE_LENGTH}
                characters="letters"
                label={CODE_FIELD_LABEL}
                error={codeError}
                locked={phase.busy}
              />
              <Button
                label={CHECK_ME_IN}
                busyLabel={CHECKING}
                busy={phase.busy}
                onPress={() => void submitCode(phase.event)}
              />
              {/* Testers only, on test events only (the server refuses the rest). */}
              {profile?.is_tester && phase.event.is_test ? (
                <Button
                  label={TESTER_CHECK_IN}
                  variant="outline"
                  disabled={phase.busy}
                  onPress={() => void submitTester(phase.event)}
                />
              ) : null}
              {notice ? <FormMessage message={notice} /> : null}
            </ScrollView>
          </FadeIn>
        </KeyboardAvoidingView>
      ) : null}

      {phase.kind === 'result' ? (
        <FadeIn style={styles.fill}>
          {/* "handled": a tap on a button works first time even if the
            keyboard was still up (VC-76). */}
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <Text style={[styles.label, phase.screen.success && styles.successLabel]}>
              {phase.screen.success ? 'CHECKED IN' : PARTY_CODE_LABEL}
            </Text>
            <Headline lead={phase.screen.lead} highlight={phase.screen.highlight} />
            {/* Read aloud when it appears, so screen-reader users hear the result. */}
            <Text style={styles.body} accessibilityLiveRegion="polite">
              {phase.screen.body}
            </Text>
            {/* "Rate the night" (after a successful check-in, VC-B08) replaces
              this screen with the rating screen; every other button goes
              back. The first button is the main (gold) one, the rest are
              quiet text links. */}
            {phase.screen.actions.map((button, index) => (
              <Button
                key={button.action}
                label={button.label}
                variant={index === 0 ? 'primary' : 'text'}
                onPress={() =>
                  button.action === 'rate'
                    ? router.replace({ pathname: '/rate/[id]', params: { id: phase.event.id } })
                    : goBack()
                }
              />
            ))}
          </ScrollView>
        </FadeIn>
      ) : null}
    </SafeAreaView>
  );
}

/** Styles built only from theme tokens (same gutters as the sign-in code step). */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  // The keyboard and fade-in wrappers fill the screen under Back (VC-76).
  fill: { flex: 1 },
  topBar: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  centre: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.authGutter,
  },
  form: { padding: spacing.authGutter, gap: 14 },
  title: { ...typography.h1, color: colors.text, textAlign: 'center' },
  label: { ...typography.label, color: colors.muted },
  successLabel: { color: colors.success },
  body: { ...typography.body, color: colors.muted },
});
