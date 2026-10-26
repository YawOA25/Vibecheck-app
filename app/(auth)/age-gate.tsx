/**
 * Age gate and profile screen (task VC-B03, proposal VC-10).
 *
 * Shown once, right after the first sign-in. The person enters a display name
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
 * (app/(auth)/blocked.tsx).
 *
 * Privacy (legal condition 1): the birthdate is sent to the server once and
 * is never logged, stored on the phone or shown in a message.
 *
 * The question is asked neutrally: the screen doesn't say what age is needed
 * before the answer, so it doesn't hint at which year to type. (A common
 * practice for age screens.)
 *
 * The date is three small number boxes (month, day, year) rather than a
 * calendar picker: it needs no extra package, works the same on iPhone and
 * Android, and is quick for a date decades in the past.
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { checkBirthdate, parseDateParts, toIsoDate } from '@/lib/age';
import { useAuth } from '@/lib/auth-context';
import { describeProfileError, isUnder18Error, ProfileErrorCode } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { colors, spacing, typography } from '@/theme';

/** The longest display name allowed (same as the database rule). */
const MAX_NAME_LENGTH = 40;

/**
 * Renders the age gate.
 *
 * @returns the screen view. It takes no inputs.
 */
export default function AgeGateScreen() {
  const { refreshProfile, signOut, markAgeBlocked } = useAuth();
  const [name, setName] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [year, setYear] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Checks the form for typing mistakes, then sends the answer to the
   * server, which decides. Returns nothing. Afterwards the root layout moves
   * on to Tonight (adult) or the "sorry" screen (refused); for anything else
   * a message is shown.
   */
  async function submit() {
    const displayName = name.trim();
    if (displayName.length < 1 || displayName.length > MAX_NAME_LENGTH) {
      setMessage('Please enter a name of 1 to 40 characters.');
      return;
    }
    const birth = parseDateParts(month, day, year);
    if (!birth) {
      setMessage('Please enter a real date, like 07 / 14 / 1999.');
      return;
    }
    // Only a date that can't be a birthdate (in the future, or before 1900)
    // stops here. An under-18 date is deliberately NOT stopped on the phone:
    // it goes to the server so the refusal is recorded there (VC-30).
    if (checkBirthdate(birth, new Date()) === 'invalid') {
      setMessage('Please enter a valid date of birth.');
      return;
    }

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
          <Text style={styles.title} accessibilityRole="header">
            Almost there
          </Text>
          <Text style={styles.note}>
            Pick the name people will see. We ask for your date of birth to check your age; other
            people never see it.
          </Text>

          <TextField
            label="Display name"
            value={name}
            onChangeText={setName}
            maxLength={MAX_NAME_LENGTH}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="nickname"
          />

          {/* Month, day and year side by side, in US order. */}
          <Text style={styles.groupLabel}>Date of birth</Text>
          <View style={styles.row}>
            <View style={styles.short}>
              <TextField
                label="Month"
                value={month}
                onChangeText={setMonth}
                keyboardType="number-pad"
                maxLength={2}
                placeholder="MM"
              />
            </View>
            <View style={styles.short}>
              <TextField
                label="Day"
                value={day}
                onChangeText={setDay}
                keyboardType="number-pad"
                maxLength={2}
                placeholder="DD"
              />
            </View>
            <View style={styles.long}>
              <TextField
                label="Year"
                value={year}
                onChangeText={setYear}
                keyboardType="number-pad"
                maxLength={4}
                placeholder="YYYY"
              />
            </View>
          </View>

          <Button label="Continue" onPress={submit} busy={busy} />
          <Button label="Use a different email" variant="text" onPress={signOut} disabled={busy} />

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
  groupLabel: { ...typography.body, color: colors.text },
  row: { flexDirection: 'row', gap: spacing.sm },
  // The month and day boxes are narrower than the year box.
  short: { flex: 1 },
  long: { flex: 2 },
  message: { ...typography.body, color: colors.text },
});
