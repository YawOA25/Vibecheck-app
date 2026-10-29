/**
 * Sign-in screen: email one-time code (task VC-B03), in the v3 look
 * (task VC-B03c, spec team/projects/vibecheck/design/v3-ui-spec.md, 2.1-2.2).
 *
 * How it works, in steps on one screen:
 *   0. Age step (VC-74, the first thing a new person sees): "Date of birth".
 *      It is checked ON THE PHONE ONLY, before any email is asked for, and
 *      nothing is sent anywhere:
 *        - under 18 (under 13 and 13-17 alike): the "sorry" screen at once.
 *          No email is collected and the server is never called. The phone
 *          notes the refusal TIME (no date, no age) for 12 months so tapping
 *          back and typing an older year is refused too
 *          (src/lib/device-age-refusal.ts, which also states the limits);
 *        - 18 or older: the date waits in memory (auth-context
 *          `startSignUp`) and the person moves on to the email step. After
 *          the code, the age-gate screen asks for their name and sends that
 *          date to `complete_profile`, whose server check still decides.
 *      Returning people tap "Already have an account? Sign in" instead and
 *      skip the age step. That path asks Supabase NOT to create a login
 *      (shouldCreateUser: false), so it can't be used to sign up while
 *      dodging the age step; an unknown email gets "no account" instead.
 *      A login with no profile that signs in this way (it never finished
 *      sign-up) still meets the date of birth question and the server gate
 *      on the age-gate screen.
 *   1. Email step: the person types their email and taps "Continue".
 *      Supabase emails them a code of EMAIL_CODE_LENGTH digits (and, on the
 *      sign-up path only, creates their login the first time).
 *   2. Code step: they type the code into one box per digit. When the last
 *      digit goes in, the code is checked straight away (the "Continue" button does the
 *      same). If it's right, Supabase signs them in, and the root layout
 *      moves them on (to the age gate the first time, or straight to Tonight
 *      after that).
 *
 * No passwords: nothing to forget, nothing to leak. The one exception is the
 * "Reviewer sign-in" link (task B14), which shows only in development
 * builds for now; see src/components/ReviewerSignIn.tsx.
 * The email step also links to the Terms of Service and the Privacy Policy
 * (VC-32b); those screens are open while signed out (app/_layout.tsx).
 * The hero block at the top of the email step shows generated gold art
 * (VC-32a, src/components/GeneratedArt.tsx) where v3 has a photo.
 * Until real email delivery is set up (task VC-B11), Supabase only sends these
 * emails to the founder's Supabase team members.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { CodeInput } from '@/components/CodeInput';
import { FormMessage } from '@/components/FormMessage';
import { GeneratedArt } from '@/components/GeneratedArt';
import { Headline } from '@/components/Headline';
import { ReviewerSignIn } from '@/components/ReviewerSignIn';
import { TextField } from '@/components/TextField';
import {
  checkBirthdate,
  DATE_INPUT_MAX_LENGTH,
  formatDateInput,
  parseDateInput,
  toIsoDate,
} from '@/lib/age';
import { useAuth } from '@/lib/auth-context';
import { describeSignInError } from '@/lib/auth-errors';
import { hasRecentDeviceRefusal } from '@/lib/device-age-refusal';
import { SIGN_IN_ART_SEED } from '@/lib/generated-art';
import { cleanCode, cleanEmail, EMAIL_CODE_LENGTH, looksLikeEmail } from '@/lib/sign-in-input';
import { supabase } from '@/lib/supabase';
import { FORM_SCROLL_PROPS, KEYBOARD_BEHAVIOR } from '@/lib/keyboard';
import { colors, fonts, spacing, typography } from '@/theme';

/**
 * How many digits the code has, and so how many boxes the screen shows. It
 * comes from one shared constant that must match the hosted Supabase
 * project's "Email OTP Length" (see src/lib/sign-in-input.ts).
 */
const CODE_LENGTH = EMAIL_CODE_LENGTH;

/** How long "Resend code" stays switched off after a code is sent, in seconds. */
export const RESEND_WAIT_SECONDS = 30;

/** Shown when the email box is empty or doesn't look like an email. */
const BAD_EMAIL = 'Enter an email like you@example.com.';

/** Shown for a date that can't be a birthdate (13th month, 30 February, the future). */
const BAD_DATE = 'Enter a real date, like 04 / 18 / 1998.';

/**
 * Which way the person came to the email step (VC-74):
 *   'signUp' - passed the age step; Supabase may create a new login.
 *   'signIn' - "Already have an account? Sign in"; no new login is created.
 */
type EmailMode = 'signUp' | 'signIn';

/** A message under the code step's links: a failed resend, or "New code sent.". */
interface Notice {
  text: string;
  tone: 'error' | 'success';
}

/**
 * Renders the sign-in screen.
 *
 * @returns the screen view. It takes no inputs.
 */
export default function SignInScreen() {
  const router = useRouter();
  const { startSignUp, refuseBeforeSignIn } = useAuth();
  // Which step we're on: the date of birth (first, VC-74), typing the email,
  // typing the code, or (dev builds only) the reviewer email-and-password form.
  const [step, setStep] = useState<'age' | 'email' | 'code' | 'reviewer'>('age');
  // Sign-up (after the age step) or sign-in (returning person).
  const [mode, setMode] = useState<EmailMode>('signUp');
  // The date box's text on the age step, for example "04 / 18 / 1998". It
  // lives only in this screen's memory and is never sent from here.
  const [birthText, setBirthText] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  // True while waiting for Supabase, so buttons can't be tapped twice.
  const [busy, setBusy] = useState(false);
  // Error under the email box (email step).
  const [emailError, setEmailError] = useState<string | null>(null);
  // Error under the code boxes (code step).
  const [codeError, setCodeError] = useState<string | null>(null);
  // Message under the code step's links.
  const [notice, setNotice] = useState<Notice | null>(null);
  // The "Resend code" countdown: the moment it may be used again, and a
  // clock that ticks once a second while we wait (both in milliseconds).
  const [resendReadyAt, setResendReadyAt] = useState(0);
  const [now, setNow] = useState(0);
  // True while the on-screen keyboard is open: the hero block shrinks then.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const { height: windowHeight } = useWindowDimensions();

  // The address as we send it to Supabase (trimmed, lowercase).
  const address = cleanEmail(email);
  const secondsLeft = Math.max(0, Math.ceil((resendReadyAt - now) / 1000));

  // Ticks the countdown clock once a second, only while there is time left.
  useEffect(() => {
    if (resendReadyAt <= now) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendReadyAt, now]);

  // Watches the keyboard opening and closing, so the hero can shrink and
  // leave room for the form (spec 2.1).
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  /** Starts the 30-second wait before "Resend code" can be used. */
  function startResendWait() {
    const sentAt = Date.now();
    setNow(sentAt);
    setResendReadyAt(sentAt + RESEND_WAIT_SECONDS * 1000);
  }

  /**
   * The age step's "Continue" (VC-74). Checks the date on the phone only:
   * a typing mistake shows a message; under 18, or a refusal on this phone
   * in the last 12 months, shows the "sorry" screen without asking for an
   * email or calling the server; 18+ keeps the date in memory and moves on
   * to the email step. Returns nothing.
   */
  async function submitBirthdate() {
    const birth = parseDateInput(birthText);
    const check = birth ? checkBirthdate(birth, new Date()) : 'invalid';
    if (!birth || check === 'invalid') {
      setDateError(BAD_DATE);
      return;
    }
    setBusy(true);
    // A refusal on this phone earlier counts whatever year is typed now, so
    // trying again with an older year doesn't work.
    const refusedHere = await hasRecentDeviceRefusal();
    if (refusedHere || check === 'under18') {
      // The root layout swaps this screen for the "sorry" screen.
      await refuseBeforeSignIn();
      return;
    }
    setBusy(false);
    startSignUp(toIsoDate(birth));
    setMode('signUp');
    setEmailError(null);
    setStep('email');
  }

  /** "Already have an account? Sign in": straight to the email, no age step. */
  function chooseSignIn() {
    setMode('signIn');
    setEmailError(null);
    setStep('email');
  }

  /** The email step's Back button: returns to the first (age) screen. */
  function backToStart() {
    setEmailError(null);
    setStep('age');
  }

  /**
   * Asks Supabase to email a code. Moves to the code step when it works.
   * Returns nothing; shows an error message when it fails.
   */
  async function sendCode() {
    if (!looksLikeEmail(address)) {
      setEmailError(BAD_EMAIL);
      return;
    }
    setBusy(true);
    setEmailError(null);
    setNotice(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      // Only the sign-up path (after the age step) may create a login. The
      // sign-in path never does, so nobody can sign up without the age step
      // (VC-74); an unknown email then gets the "no account" message.
      options: { shouldCreateUser: mode === 'signUp' },
    });
    setBusy(false);
    if (error) {
      const text = describeSignInError(error);
      // On the code step (a resend), the email box isn't on screen.
      if (step === 'code') setNotice({ text, tone: 'error' });
      else setEmailError(text);
      return;
    }
    // Coming back here from "Resend code" keeps the person on the code step.
    if (step === 'code') setNotice({ text: 'New code sent.', tone: 'success' });
    setCode('');
    setCodeError(null);
    startResendWait();
    setStep('code');
  }

  /**
   * Checks a code with Supabase. On success Supabase stores the login and
   * the root layout moves on by itself, so there's nothing else to do here.
   *
   * @param token - the digits to check.
   * Returns nothing; on a wrong code it clears the boxes and shows why.
   */
  async function verifyCode(token: string) {
    setBusy(true);
    setCodeError(null);
    setNotice(null);
    const { error } = await supabase.auth.verifyOtp({
      email: address,
      token,
      type: 'email',
    });
    setBusy(false);
    if (error) {
      setCodeError(describeSignInError(error));
      // Clear the boxes so the person can type the code again straight away.
      setCode('');
    }
  }

  /**
   * Handles typing or pasting in the code boxes: keeps digits only, and
   * checks the code by itself as soon as all CODE_LENGTH digits are in (spec 2.2).
   *
   * @param text - what is in the (invisible) code box now.
   */
  function onCodeChange(text: string) {
    const digits = cleanCode(text).slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length > 0) setCodeError(null);
    if (digits.length === CODE_LENGTH && !busy) verifyCode(digits);
  }

  /** Goes back to the email step to fix a typo in the address. */
  function useDifferentEmail() {
    setStep('email');
    setCode('');
    setCodeError(null);
    setNotice(null);
  }

  // Hero block height (spec 2.1): about 36% of the screen, at least 220 px;
  // 140 px while the keyboard is open. It may still grow to fit large text.
  const heroHeight = keyboardOpen ? 140 : Math.max(220, windowHeight * 0.36);
  // The hero (art and headline) tops the age step and the email step.
  const showHero = step === 'age' || step === 'email';

  return (
    // The top safe area (under the clock) takes the hero's colour on the
    // email step, so the hero looks like it runs to the top of the screen.
    <SafeAreaView edges={['top']} style={[styles.top, showHero ? styles.topHero : styles.topPlain]}>
      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.safe}>
        {/* Pushes the form up so the keyboard doesn't cover it on iPhone. */}
        <KeyboardAvoidingView
          style={styles.flex}
          // VC-76: room for the keyboard on both platforms (src/lib/keyboard.ts).
          behavior={KEYBOARD_BEHAVIOR}
        >
          <ScrollView contentContainerStyle={styles.scroll} {...FORM_SCROLL_PROPS}>
            {showHero ? (
              <>
                {/* Hero block: wordmark at the top, headline at the bottom. */}
                <View style={[styles.hero, { minHeight: heroHeight }]}>
                  {/* VC-32a: generated gold-on-black art fills the hero, in
                      place of v3's photo (no licence or people needed). It
                      is drawn first so it sits behind the words, and fills
                      the block as it grows or shrinks with the keyboard. */}
                  <GeneratedArt seed={SIGN_IN_ART_SEED} testID="sign-in-hero-art" />
                  <Text style={styles.wordmark} accessibilityLabel="VibeCheck">
                    VIBECHECK
                  </Text>
                  <View style={styles.heroBottom}>
                    {/* Thin gold rule: decoration, hidden from screen readers. */}
                    <View
                      style={styles.goldRule}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    />
                    <Headline size="hero" lead="Know the vibe" highlight="before you pull up." />
                  </View>
                </View>

                {step === 'age' ? (
                  <View style={styles.form}>
                    {/* Asked neutrally: no age limit is mentioned, so the
                        question doesn't hint at which year to type. */}
                    <TextField
                      label="Date of birth"
                      value={birthText}
                      // Digits only, " / " added by itself (as on the age gate).
                      onChangeText={(text) => {
                        setBirthText(formatDateInput(text));
                        setDateError(null);
                      }}
                      error={dateError}
                      helper="Month, day, then year."
                      accessibilityHint="Month, day, year, eight digits"
                      keyboardType="number-pad"
                      maxLength={DATE_INPUT_MAX_LENGTH}
                      placeholder="MM / DD / YYYY"
                      returnKeyType="done"
                    />
                    <Button
                      label="Continue"
                      busyLabel="Checking..."
                      onPress={submitBirthdate}
                      busy={busy}
                    />
                    <Button
                      label="Already have an account? Sign in"
                      variant="text"
                      size="small"
                      onPress={chooseSignIn}
                      disabled={busy}
                    />
                    {/* Reviewer sign-in (email + password): development
                        builds ONLY for now (`__DEV__` is false in store
                        builds). Task B14 decides how App Store reviewers
                        will reach it. */}
                    {__DEV__ ? (
                      <Button
                        label="Reviewer sign-in"
                        variant="text"
                        size="small"
                        onPress={() => setStep('reviewer')}
                        disabled={busy}
                      />
                    ) : null}
                    <LegalLinks
                      onTerms={() => router.push('/terms')}
                      onPrivacy={() => router.push('/privacy')}
                    />
                  </View>
                ) : (
                  <View style={styles.form}>
                    <BackButton onPress={backToStart} disabled={busy} />
                    <TextField
                      label="Email"
                      value={email}
                      onChangeText={(text) => {
                        setEmail(text);
                        setEmailError(null);
                      }}
                      error={emailError}
                      helper={
                        mode === 'signIn'
                          ? `Welcome back. We'll email you a ${CODE_LENGTH}-digit code.`
                          : `We'll email you a ${CODE_LENGTH}-digit code. No password needed.`
                      }
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="email"
                      textContentType="emailAddress"
                      returnKeyType="send"
                      onSubmitEditing={sendCode}
                      placeholder="you@example.com"
                    />
                    {/* Stays tappable when empty: tapping explains what's needed (spec 2.1). */}
                    <Button
                      label="Continue"
                      busyLabel="Sending..."
                      onPress={sendCode}
                      busy={busy}
                    />
                    {/* Reviewer sign-in again here, so it is one tap away on
                      both first screens (dev builds only, as above). */}
                    {__DEV__ ? (
                      <Button
                        label="Reviewer sign-in"
                        variant="text"
                        size="small"
                        onPress={() => setStep('reviewer')}
                        disabled={busy}
                      />
                    ) : null}
                    <LegalLinks
                      onTerms={() => router.push('/terms')}
                      onPrivacy={() => router.push('/privacy')}
                    />
                  </View>
                )}
              </>
            ) : step === 'reviewer' ? (
              <ReviewerSignIn onBack={() => setStep('age')} />
            ) : (
              <View style={styles.form}>
                <BackButton onPress={useDifferentEmail} disabled={busy} />
                <Headline lead="Check your" highlight="email" />
                <Text style={styles.body}>
                  We sent a {CODE_LENGTH}-digit code to <Text style={styles.strong}>{address}</Text>
                  . Enter it below.
                </Text>

                <CodeInput
                  value={code}
                  onChangeText={onCodeChange}
                  length={CODE_LENGTH}
                  error={codeError}
                  locked={busy}
                />

                <Button
                  label="Continue"
                  busyLabel="Checking..."
                  onPress={() => verifyCode(code)}
                  busy={busy}
                  disabled={code.length < CODE_LENGTH}
                />

                <View style={styles.links}>
                  <Button
                    label={
                      secondsLeft > 0
                        ? `Resend code in 0:${String(secondsLeft).padStart(2, '0')}`
                        : 'Resend code'
                    }
                    variant="text"
                    size="small"
                    onPress={sendCode}
                    disabled={busy || secondsLeft > 0}
                  />
                  <Button
                    label="Use a different email"
                    variant="text"
                    size="small"
                    onPress={useDifferentEmail}
                    disabled={busy}
                  />
                </View>

                {notice ? <FormMessage message={notice.text} tone={notice.tone} /> : null}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaView>
  );
}

/**
 * The Terms and Privacy links (VC-32b), readable before signing up.
 *
 * @param props.onTerms - opens the Terms of Service.
 * @param props.onPrivacy - opens the Privacy Policy.
 * @returns the two small links side by side.
 */
function LegalLinks({ onTerms, onPrivacy }: { onTerms: () => void; onPrivacy: () => void }) {
  return (
    <View style={styles.legal}>
      <Button
        label="Terms"
        accessibilityLabel="Terms of Service"
        variant="text"
        size="small"
        onPress={onTerms}
      />
      <Button
        label="Privacy"
        accessibilityLabel="Privacy Policy"
        variant="text"
        size="small"
        onPress={onPrivacy}
      />
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  top: { flex: 1 },
  topHero: { backgroundColor: colors.surface },
  topPlain: { backgroundColor: colors.bg },
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, backgroundColor: colors.bg },
  hero: {
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingHorizontal: spacing.authGutter,
    paddingTop: spacing.lg,
    paddingBottom: 28,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  wordmark: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 4,
    color: colors.text,
  },
  heroBottom: { gap: spacing.gap12 },
  goldRule: { width: 32, height: 1, backgroundColor: colors.accent },
  form: { padding: spacing.authGutter, gap: 14 },
  body: { ...typography.body, color: colors.muted },
  strong: { fontFamily: fonts.bodySemi, color: colors.text },
  links: { alignItems: 'center' },
  legal: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md },
});
