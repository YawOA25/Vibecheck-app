/**
 * Sign-in screen: email one-time code (task VC-B03).
 *
 * How it works, in two steps on one screen:
 *   1. The person types their email and taps "Send code". Supabase emails them
 *      a short code (and creates their login the first time).
 *   2. They type the code and tap "Sign in". If it's right, Supabase signs
 *      them in. The root layout notices and moves them on (to the age gate
 *      the first time, or straight to Tonight after that).
 *
 * No passwords: nothing to forget, nothing to leak.
 * Until real email delivery is set up (task VC-B11), Supabase only sends these
 * emails to the founder's Supabase team members.
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { describeSignInError } from '@/lib/auth-errors';
import { cleanCode, cleanEmail, looksLikeEmail, MIN_CODE_LENGTH } from '@/lib/sign-in-input';
import { supabase } from '@/lib/supabase';
import { colors, spacing, typography } from '@/theme';

/**
 * Renders the sign-in screen.
 *
 * @returns the screen view. It takes no inputs.
 */
export default function SignInScreen() {
  // Which step we're on: typing the email, or typing the code.
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  // True while waiting for Supabase, so buttons can't be tapped twice.
  const [busy, setBusy] = useState(false);
  // The message under the form: an error, or "new code sent".
  const [message, setMessage] = useState<string | null>(null);

  // The address as we send it to Supabase (trimmed, lowercase).
  const address = cleanEmail(email);

  /**
   * Asks Supabase to email a code. Moves to the code step when it works.
   * Returns nothing; shows an error message when it fails.
   */
  async function sendCode() {
    if (!looksLikeEmail(address)) {
      setMessage("That email address doesn't look right.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      // Create the login the first time this email is used.
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) {
      setMessage(describeSignInError(error));
      return;
    }
    // Coming back here from "Send a new code" keeps the person on the code step.
    if (step === 'code') setMessage('We sent a new code.');
    setCode('');
    setStep('code');
  }

  /**
   * Checks the code with Supabase. On success Supabase stores the login and
   * the root layout moves on by itself, so there's nothing else to do here.
   * Returns nothing; shows an error message when the code is wrong.
   */
  async function verifyCode() {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.verifyOtp({
      email: address,
      token: code,
      type: 'email',
    });
    setBusy(false);
    if (error) setMessage(describeSignInError(error));
  }

  /** Goes back to the email step to fix a typo in the address. */
  function useDifferentEmail() {
    setStep('email');
    setCode('');
    setMessage(null);
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Pushes the form up so the keyboard doesn't cover it on iPhone. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title} accessibilityRole="header">
            {step === 'email' ? 'Sign in to VibeCheck' : 'Check your email'}
          </Text>

          {step === 'email' ? (
            <>
              <Text style={styles.note}>{"We'll email you a code. No password needed."}</Text>
              <TextField
                label="Email"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="send"
                onSubmitEditing={sendCode}
                placeholder="you@example.com"
              />
              <Button
                label="Send code"
                onPress={sendCode}
                busy={busy}
                disabled={address.length === 0}
              />
            </>
          ) : (
            <>
              <Text style={styles.note}>Enter the code we sent to {address}.</Text>
              <TextField
                label="Code"
                value={code}
                onChangeText={(text) => setCode(cleanCode(text))}
                keyboardType="number-pad"
                // Lets iPhone and Android offer the code from the email as a suggestion.
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                returnKeyType="done"
                onSubmitEditing={verifyCode}
              />
              <Button
                label="Sign in"
                onPress={verifyCode}
                busy={busy}
                disabled={code.length < MIN_CODE_LENGTH}
              />
              <Button label="Send a new code" variant="text" onPress={sendCode} disabled={busy} />
              <Button
                label="Use a different email"
                variant="text"
                onPress={useDifferentEmail}
                disabled={busy}
              />
            </>
          )}

          {/* accessibilityLiveRegion makes Android read new messages aloud;
              role "alert" does the same on iPhone. */}
          {message ? (
            <Text style={styles.message} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {message}
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { padding: spacing.gutter, gap: spacing.md },
  title: { ...typography.display, color: colors.text },
  note: { ...typography.body, color: colors.muted },
  message: { ...typography.body, color: colors.text },
});
