/**
 * The "Heads-up" card on the event page (proposal VC-43, folded into task
 * VC-B08): quick tags from guests who are there, such as "Lines are long",
 * each with how many people said it, and a "+1" for checked-in guests.
 *
 * What it does:
 *   - loads the counts from the server (get_event_heads_ups) when the card
 *     appears and whenever `refreshKey` changes (the event page bumps it
 *     each time it comes back into view);
 *   - tapping a tag adds the guest's +1 (add_heads_up). The server decides
 *     whether they may (checked in within 45 minutes, inside the event
 *     window, not an admin); if not, the card says why.
 *
 * Why there's no free text: nothing to moderate (VC-43). Free-text comments
 * are the separate backlog item VC-44. Nobody ever sees WHO added a tag.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ChoiceChip } from '@/components/ChoiceChip';
import { FormMessage } from '@/components/FormMessage';
import { headsUpLabel } from '@/lib/rating';
import type { HeadsUpTag } from '@/lib/rating';
import { addHeadsUp, getEventHeadsUps } from '@/lib/ratings-api';
import type { HeadsUpCount } from '@/lib/ratings-api';
import { headsUpRefusalMessage } from '@/lib/rating-screens';
import { colors, radius, spacing, typography } from '@/theme';

/** The card's words (exported so tests use the same text). */
export const HEADS_UP_TITLE = 'HEADS-UP';
export const NO_HEADS_UPS = 'No heads-ups yet. Guests who are here can add one when they rate.';
export const HEADS_UP_LOAD_ERROR = "We couldn't load the heads-ups.";
export const PLUS_ONE_HINT = 'Here now? Tap a heads-up to +1 it.';

/** What a HeadsUpCard needs. */
export interface HeadsUpCardProps {
  /** The event's id. */
  eventId: string;
  /** Changing this number reloads the counts. */
  refreshKey: number;
  /**
   * false for admins: they see the counts but can't +1 (staff rule, VC-05;
   * the server refuses them anyway).
   */
  canVote: boolean;
}

/** What the list part is showing. */
type ListState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; tags: HeadsUpCount[] };

/**
 * Renders the card.
 *
 * @returns the card view.
 */
export function HeadsUpCard({ eventId, refreshKey, canVote }: HeadsUpCardProps) {
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  // Bumped after a +1 so the counts reload.
  const [reload, setReload] = useState(0);
  // The tag being sent right now (its chip is disabled meanwhile).
  const [sending, setSending] = useState<HeadsUpTag | null>(null);
  // A sentence after a refused or failed +1.
  const [message, setMessage] = useState<string | null>(null);

  // Load the counts. State is only set when the answer arrives, and a late
  // answer is ignored if the card has gone or a newer load started.
  useEffect(() => {
    let active = true;
    getEventHeadsUps(eventId).then((outcome) => {
      if (!active) return;
      setList(outcome.ok ? { kind: 'ready', tags: outcome.tags } : { kind: 'error' });
    });
    return () => {
      active = false;
    };
  }, [eventId, refreshKey, reload]);

  /**
   * Sends the guest's +1 for one tag, then reloads the counts.
   *
   * @param tag - the tapped tag.
   */
  const plusOne = useCallback(
    async (tag: HeadsUpTag) => {
      setSending(tag);
      setMessage(null);
      const outcome = await addHeadsUp(eventId, tag);
      setSending(null);
      if (!outcome.ok) {
        setMessage(outcome.message);
      } else if (outcome.result.status === 'added' || outcome.result.status === 'already') {
        setReload((n) => n + 1);
      } else {
        setMessage(headsUpRefusalMessage(outcome.result));
      }
    },
    [eventId],
  );

  return (
    <View style={styles.card}>
      <Text style={styles.label} accessibilityRole="header">
        {HEADS_UP_TITLE}
      </Text>

      {list.kind === 'loading' ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel="Loading heads-ups" />
      ) : null}

      {list.kind === 'error' ? <Text style={styles.muted}>{HEADS_UP_LOAD_ERROR}</Text> : null}

      {list.kind === 'ready' && list.tags.length === 0 ? (
        <Text style={styles.muted}>{NO_HEADS_UPS}</Text>
      ) : null}

      {list.kind === 'ready' && list.tags.length > 0 ? (
        <>
          <View style={styles.chips}>
            {list.tags.map((item) => {
              // parseHeadsUpList only keeps tags this app knows, so a label exists.
              const label = headsUpLabel(item.tag) ?? item.tag;
              const people = `${item.count} ${item.count === 1 ? 'person' : 'people'}`;
              return (
                <ChoiceChip
                  key={item.tag}
                  shape="pill"
                  label={`${label} · ${item.count}`}
                  // "Lines are long, 3 people, you +1'd this".
                  accessibilityLabel={`${label}, ${people}${item.mine ? ", you +1'd this" : ''}`}
                  accessibilityHint={canVote && !item.mine ? 'Tap to +1' : undefined}
                  // Highlighted (with a check mark) when the guest has +1'd it.
                  selected={item.mine}
                  // Nothing to do on your own +1 (it can't be taken back),
                  // for admins, or while this tag is being sent.
                  disabled={!canVote || item.mine || sending === item.tag}
                  onPress={() => void plusOne(item.tag)}
                />
              );
            })}
          </View>
          {canVote ? <Text style={styles.caption}>{PLUS_ONE_HINT}</Text> : null}
        </>
      ) : null}

      {message ? <FormMessage message={message} /> : null}
    </View>
  );
}

/** Styles built only from theme tokens (the same card look as LiveVibeCard). */
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  label: { ...typography.label, color: colors.muted },
  muted: { ...typography.bodySm, color: colors.muted },
  caption: { ...typography.caption, color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
