/**
 * Age gate and profile screen (task VC-B03, proposal VC-10).
 *
 * Shown once, right after the first sign-in. The person enters a display name
 * and their date of birth; the app then calls the server function
 * `complete_profile`, which creates the profile only for people 18 or older.
 *
 * Two layers of checking:
 *   1. The phone checks the age first (src/lib/age.ts), so the answer is
 *      instant and an under-18 date is never even sent.
 *   2. The server checks again and has the final say. Even a hand-made
 *      request that skips this screen can't create an under-18 profile.
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
  const { refreshProfile, signOut } = useAuth();
  const [name, setName] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [year, setYear] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // True once the person is found to be under 18. The form is replaced by the
  // "sorry" message, and the only way on is to sign out.
  const [blocked, setBlocked] = useState(false);

  /**
   * Checks the form, then asks the server to create the profile.
   * Returns nothing. On success the profile is reloaded and the root layout
   * moves on to Tonight; otherwise a message (or the blocked view) is shown.
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
    // Instant check on the phone. Under 18: stop here, send nothing.
    const check = checkBirthdate(birth, new Date());
    if (check === 'under18') {
      setBlocked(true);
      return;
    }
    if (check === 'invalid') {
      setMessage('Please enter a valid date of birth.');
      return;
    }

    setBusy(true);
    setMessage(null);
    // `rpc` calls a server function by name. Parameter names must match the SQL.
    const { error } = await supabase.rpc('complete_profile', {
      p_display_name: displayName,
      p_birthdate: toIsoDate(birth),
    });
    if (error && isUnder18Error(error)) {
      // The server disagreed with the phone (for example, the phone's clock is
      // wrong). The server's answer wins.
      setBusy(false);
      setBlocked(true);
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

  if (blocked) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <Text style={styles.title} accessibilityRole="header">
            Sorry
          </Text>
          <Text style={styles.note}>VibeCheck is for people 18 and older.</Text>
          <Button label="Sign out" onPress={signOut} />
        </View>
      </SafeAreaView>
    );
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
