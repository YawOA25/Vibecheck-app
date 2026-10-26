/**
 * Reviewer sign-in: email and password, for a test account (task B14,
 * brought forward on 2026-10-26 so the founder can test while real email
 * delivery is being set up; see team/decisions.md).
 *
 * Who sees it: for now ONLY development builds (`__DEV__`); the sign-in
 * screen decides that. Task B14 decides how App Store reviewers reach it.
 *
 * What it does: signs in with `supabase.auth.signInWithPassword`. After that
 * the normal flow runs exactly as for an email code: the root layout sends a
 * new login to the age gate, and the VC-30 lock still applies. The test
 * account itself is made by the founder in the Supabase dashboard; the app
 * never creates password accounts.
 *
 * Privacy: the password is kept only in this form's memory while typing. It
 * is never logged, never shown in a message, and cleared after a failed try.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { FormMessage } from '@/components/FormMessage';
import { Headline } from '@/components/Headline';
import { TextField } from '@/components/TextField';
import { describePasswordSignInError } from '@/lib/auth-errors';
import { cleanEmail } from '@/lib/sign-in-input';
import { supabase } from '@/lib/supabase';
import { spacing } from '@/theme';

/** What ReviewerSignIn needs. */
export interface ReviewerSignInProps {
  /** Goes back to the normal email-code sign-in. */
  onBack: () => void;
}

/**
 * Renders the reviewer email-and-password form.
 *
 * @returns the form view.
 */
export function ReviewerSignIn({ onBack }: ReviewerSignInProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Signs in with the typed email and password. On success Supabase stores
   * the login and the root layout moves on by itself (age gate or Tonight).
   * Returns nothing; shows a friendly message when it fails.
   */
  async function signIn() {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: cleanEmail(email),
      password,
    });
    setBusy(false);
    if (error) {
      // Only the error's code is looked at; the password is never part of the message.
      setMessage(describePasswordSignInError(error));
      setPassword('');
    }
  }

  return (
    <View style={styles.form}>
      <BackButton onPress={onBack} disabled={busy} />
      <Headline lead="Reviewer" highlight="sign-in" />
      <TextField
        label="Reviewer email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="username"
        placeholder="you@example.com"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        // Hides the typed characters and keeps the phone from suggesting or saving words.
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={signIn}
      />
      <Button
        label="Sign in"
        busyLabel="Signing in..."
        onPress={signIn}
        busy={busy}
        disabled={email.trim().length === 0 || password.length === 0}
      />
      {message ? <FormMessage message={message} /> : null}
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  form: { padding: spacing.authGutter, gap: 14 },
});
