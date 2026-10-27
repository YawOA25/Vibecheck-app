/**
 * One admin moderation button with its reason picker (proposals VC-47 and
 * VC-58), e.g. "Hide rating", "Remove +1s", "Hide tag" or "Keep tag".
 *
 * What it does:
 *   - shows a small button with the action's name;
 *   - tapping it opens a short form: pick a reason (only the ones that fit:
 *     the three removal reasons, or the two restore reasons), add an
 *     optional note, then Confirm or Cancel;
 *   - Confirm calls `onConfirm` with the reason and note. If that answers
 *     with a message (a failure), the form stays open and shows it.
 *
 * Why every action needs a reason: the written removal rule (legal review,
 * section 5) says what may be removed and why; logging the reason shows each
 * decision followed it, whoever complained. The server checks it again.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ChoiceChip } from '@/components/ChoiceChip';
import { FormMessage } from '@/components/FormMessage';
import { TextField } from '@/components/TextField';
import { MAX_NOTE_LENGTH, reasonsFor } from '@/lib/moderation';
import type { ModerationReason } from '@/lib/moderation';
import { colors, radius, spacing, typography } from '@/theme';

/** The form's words (exported so tests use the same text). */
export const PICK_REASON = 'Why? Pick one.';
export const CONFIRM_LABEL = 'Confirm';
export const CANCEL_LABEL = 'Cancel';
export const NOTE_LABEL = 'Note for admins (optional)';

/** What a ModerationAction needs. */
export interface ModerationActionProps {
  /** The button's words, e.g. "Hide rating". */
  label: string;
  /**
   * Who or what it acts on, e.g. the guest's name or the tag's words. Screen
   * readers hear "Hide rating, Ava", so the many buttons with the same words
   * on one screen can be told apart.
   */
  target: string;
  /** true for hide/remove (removal reasons), false for restore/keep. */
  removing: boolean;
  /**
   * Runs the action. Resolves to null when it worked (the parent reloads),
   * or to a sentence to show when it didn't.
   */
  onConfirm: (reason: ModerationReason, note: string) => Promise<string | null>;
}

/**
 * Renders the button, and the reason form once it's tapped.
 *
 * @returns the view.
 */
export function ModerationAction({ label, target, removing, onConfirm }: ModerationActionProps) {
  // "Hide rating, Ava": what screen readers hear for this action.
  const spoken = `${label}, ${target}`;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ModerationReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /** Closes the form and forgets what was picked. Returns nothing. */
  function close() {
    setOpen(false);
    setReason(null);
    setNote('');
    setMessage(null);
  }

  /** Sends the action with the picked reason. Returns nothing. */
  async function confirm() {
    if (!reason) {
      setMessage(PICK_REASON);
      return;
    }
    setBusy(true);
    setMessage(null);
    const failure = await onConfirm(reason, note);
    setBusy(false);
    if (failure) setMessage(failure);
    else close();
  }

  if (!open) {
    return (
      <Button
        label={label}
        accessibilityLabel={spoken}
        variant="outline"
        size="small"
        onPress={() => setOpen(true)}
      />
    );
  }

  return (
    <View style={styles.form}>
      <Text style={styles.title}>{spoken}</Text>
      <Text style={styles.muted}>{PICK_REASON}</Text>
      <View style={styles.chips}>
        {reasonsFor(removing).map((r) => (
          <ChoiceChip
            key={r.key}
            shape="pill"
            role="radio"
            label={r.label}
            selected={reason === r.key}
            disabled={busy}
            onPress={() => setReason(r.key)}
          />
        ))}
      </View>
      <TextField
        label={NOTE_LABEL}
        value={note}
        onChangeText={setNote}
        maxLength={MAX_NOTE_LENGTH}
        editable={!busy}
      />
      {message ? <FormMessage message={message} /> : null}
      <View style={styles.row}>
        <Button
          label={CONFIRM_LABEL}
          accessibilityLabel={`${CONFIRM_LABEL}: ${spoken}`}
          size="small"
          busy={busy}
          busyLabel="Saving..."
          onPress={() => void confirm()}
        />
        <Button
          label={CANCEL_LABEL}
          accessibilityLabel={`${CANCEL_LABEL}: ${spoken}`}
          variant="text"
          size="small"
          disabled={busy}
          onPress={close}
        />
      </View>
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  form: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    borderRadius: radius.card,
  },
  title: { ...typography.button, color: colors.text },
  muted: { ...typography.bodySm, color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
