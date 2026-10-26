/**
 * Sign-in screen: email one-time code (task VC-B03), in the v3 look
 * (task VC-B03c, spec team/projects/vibecheck/design/v3-ui-spec.md, 2.1-2.2).
 *
 * How it works, in two steps on one screen:
 *   1. Email step: the person types their email and taps "Continue".
 *      Supabase emails them a code of EMAIL_CODE_LENGTH digits (and creates
 *      their login the first time).
 *   2. Code step: they type the code into one box per digit. When the last
 *      digit goes in, the code is checked straight away (the "Continue" button does the
 *      same). If it's right, Supabase signs them in, and the root layout
 *      moves them on (to the age gate the first time, or straight to Tonight
 *      after that).
 *
 * No passwords: nothing to forget, nothing to leak. The one exception is the
 * "Reviewer sign-in" link (task B14), which shows only in development
 * builds for now; see src/components/ReviewerSignIn.tsx.
 * Until real email delivery is set up (task VC-B11), Supabase only sends these
 * emails to the founder's Supabase team members.
 */
import { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
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
import { Headline } from '@/components/Headline';
import { ReviewerSignIn } from '@/components/ReviewerSignIn';
import { TextField } from '@/components/TextField';
import { describeSignInError } from '@/lib/auth-errors';
import { cleanCode, cleanEmail, EMAIL_CODE_LENGTH, looksLikeEmail } from '@/lib/sign-in-input';
import { supabase } from '@/lib/supabase';
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
  // Which step we're on: typing the email, typing the code, or (dev builds
  // only) the reviewer email-and-password form.
  const [step, setStep] = useState<'email' | 'code' | 'reviewer'>('email');
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
      // Create the login the first time this email is used.
      options: { shouldCreateUser: true },
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

  return (
    // The top safe area (under the clock) takes the hero's colour on the
    // email step, so the hero looks like it runs to the top of the screen.
    <SafeAreaView
      edges={['top']}
      style={[styles.top, step === 'email' ? styles.topHero : styles.topPlain]}
    >
      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.safe}>
        {/* Pushes the form up so the keyboard doesn't cover it on iPhone. */}
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {step === 'email' ? (
              <>
                {/* Hero block: wordmark at the top, headline at the bottom. */}
                <View style={[styles.hero, { minHeight: heroHeight }]}>
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

                <View style={styles.form}>
                  <TextField
                    label="Email"
                    value={email}
                    onChangeText={(text) => {
                      setEmail(text);
                      setEmailError(null);
                    }}
                    error={emailError}
                    helper={`We'll email you a ${CODE_LENGTH}-digit code. No password needed.`}
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
                  <Button label="Continue" busyLabel="Sending..." onPress={sendCode} busy={busy} />
                  {/* Reviewer sign-in (email + password): development builds
                      ONLY for now (`__DEV__` is false in store builds). Task
                      B14 decides how App Store reviewers will reach it. */}
                  {__DEV__ ? (
                    <Button
                      label="Reviewer sign-in"
                      variant="text"
                      size="small"
                      onPress={() => setStep('reviewer')}
                      disabled={busy}
                    />
                  ) : null}
                </View>
              </>
            ) : step === 'reviewer' ? (
              <ReviewerSignIn onBack={() => setStep('email')} />
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
});
