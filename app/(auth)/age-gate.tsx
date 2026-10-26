/**
 * Age gate and profile screen (task VC-B03, proposal VC-10), in the v3 look
 * (task VC-B03c, spec team/projects/vibecheck/design/v3-ui-spec.md, 2.3).
 *
 * Shown once, right after the first sign-in. The person enters their name
 * and their date of birth; the app then calls the server function
 * `complete_profile`, which creates the profile only for people 18 or older.
 *
 * Who decides (VC-30): EVERY real date goes to the server, and the server
 * alone decides. That matters because the server also remembers an under-18
 * answer: a 13-17 login is locked for good (signing out and typing an older
 * year doesn't work), and an under-13 login is deleted at once. The phone
 * only catches typing mistakes first (a date that doesn't exist, a future
 * date, an empty name), which aren't age answers.
 *
 * After a refusal the root layout swaps this screen for the "sorry" screen
 * (app/(auth)/blocked.tsx). There is no "edit your date" path afterwards.
 *
 * Privacy (legal condition 1): the birthdate is sent to the server once and
 * is never logged, stored on the phone or shown in a message.
 *
 * The question is asked neutrally: the screen never mentions an age limit,
 * so it doesn't hint at which year to type. (A common practice for age
 * screens.)
 *
 * The date is ONE number box that fills in " / " by itself ("MM / DD / YYYY")
 * rather than a calendar picker: it needs no extra package, works the same on
 * iPhone and Android, and is quick for a date decades in the past.
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FormMessage } from '@/components/FormMessage';
import { Headline } from '@/components/Headline';
import { TextField } from '@/components/TextField';
import {
  checkBirthdate,
  dateDigits,
  DATE_INPUT_MAX_LENGTH,
  formatDateInput,
  parseDateInput,
  toIsoDate,
} from '@/lib/age';
import { useAuth } from '@/lib/auth-context';
import { describeProfileError, isUnder18Error, ProfileErrorCode } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { colors, spacing, typography } from '@/theme';

/** The longest display name allowed (same as the database rule). */
const MAX_NAME_LENGTH = 40;

/** Shown for a date that can't be a birthdate (13th month, 30 February, the future). */
const BAD_DATE = 'Enter a real date, like 04 / 18 / 1998.';

/**
 * Renders the age gate.
 *
 * @returns the screen view. It takes no inputs.
 */
export default function AgeGateScreen() {
  const { refreshProfile, signOut, markAgeBlocked } = useAuth();
  const [name, setName] = useState('');
  // The date box's text, for example "04 / 18 / 1998".
  const [birthText, setBirthText] = useState('');
  const [busy, setBusy] = useState(false);
  // Errors under the name box, under the date box, and under the button.
  const [nameError, setNameError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // "Continue" stays off until there is a name and all 8 date digits (spec 2.3).
  const ready = name.length > 0 && dateDigits(birthText).length === 8;

  /**
   * Checks the form for typing mistakes, then sends the answer to the
   * server, which decides. Returns nothing. Afterwards the root layout moves
   * on to Tonight (adult) or the "sorry" screen (refused); for anything else
   * a message is shown.
   */
  async function submit() {
    const displayName = name.trim();
    const birth = parseDateInput(birthText);
    // Only a date that can't be a birthdate (not a real date, in the future,
    // or before 1900) stops here. An under-18 date is deliberately NOT
    // stopped on the phone: it goes to the server so the refusal is recorded
    // there (VC-30).
    const badDate = !birth || checkBirthdate(birth, new Date()) === 'invalid';
    setNameError(displayName.length < 1 ? 'Enter your name.' : null);
    setDateError(badDate ? BAD_DATE : null);
    if (displayName.length < 1 || !birth || badDate) return;

    setBusy(true);
    setMessage(null);
    // `rpc` calls a server function by name. Parameter names must match the
    // SQL. `data` is the function's answer: 'created', 'refused_locked' or
    // 'refused_deleted' (see the age-gate-lock migration).
    const { data, error } = await supabase.rpc('complete_profile', {
      p_display_name: displayName,
      p_birthdate: toIsoDate(birth),
    });
    if (!error && data === 'refused_deleted') {
      // Under 13: the server deleted the login. Sign this phone out and
      // show the "sorry" screen.
      await markAgeBlocked('deleted');
      return;
    }
    if ((!error && data === 'refused_locked') || isUnder18Error(error)) {
      // 13-17 (or a login that was already locked): show the "sorry" screen.
      await markAgeBlocked('locked');
      return;
    }
    if (error && error.code !== ProfileErrorCode.alreadyDone) {
      setBusy(false);
      setMessage(describeProfileError(error));
      return;
    }
    // Success (or the profile already existed, for example after a double
    // tap): load it, and the root layout moves on to Tonight.
    await refreshProfile();
    setBusy(false);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Headline lead="A little" highlight="about you" />
          <Text style={styles.body}>We use this to set up your account.</Text>

          <TextField
            label="Your name"
            value={name}
            onChangeText={(text) => {
              setName(text);
              setNameError(null);
            }}
            error={nameError}
            maxLength={MAX_NAME_LENGTH}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
          />

          <TextField
            label="Date of birth"
            value={birthText}
            // Tidies the text as it is typed: digits only, " / " added by itself.
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
          />

          <Button
            label="Continue"
            busyLabel="Saving..."
            onPress={submit}
            busy={busy}
            disabled={!ready}
          />
          {message ? <FormMessage message={message} /> : null}
          <Button
            label="Use a different email"
            variant="text"
            size="small"
            onPress={signOut}
            disabled={busy}
          />
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
