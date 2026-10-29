/**
 * "Your night": the next-morning recap (task VC-B12).
 *
 * Opened two ways:
 *   - from the 11 AM notification (or the "Last night, rated" card on the Me
 *     screen): `/recap` shows every event the guest rated in the last 36
 *     hours;
 *   - from a row in Nights out: `/recap?event=<id>` shows that one event,
 *     however old.
 *
 * Each event shows, side by side:
 *   - YOU: the guest's own word ("You called Fire"), their three row words
 *     and their reaction;
 *   - THE ROOM: the final night's word (words only, never a number, like the
 *     event page's "All night"), how many rated, the last published live
 *     score, and the top reaction from the published tally.
 * Everything about the room comes from the server's published snapshot, so
 * it matches the event page exactly and never reveals more (privacy rules in
 * supabase/migrations/20261028100000_my_recap.sql).
 *
 * States: loading, an error with "Try again", and an empty state.
 *
 * Motion (VC-76, design/vc76-motion-spec.md): the recap rises as a sheet
 * from the bottom (app/_layout.tsx) and closes with a swipe down. "See your
 * nights out" closes the sheet back to the Me tab (dismissTo), instead of
 * stacking another Me inside the sheet. The spinner only shows if loading
 * takes over 300 ms, and the loaded recap fades in.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { FadeIn } from '@/components/FadeIn';
import { FormMessage } from '@/components/FormMessage';
import { wordColour } from '@/components/VibeMeter';
import { REACTIONS } from '@/lib/rating';
import { recapDateLine, roomSummary, rowWord, topReaction } from '@/lib/recap';
import type { RecapItem } from '@/lib/recap';
import { getMyRecap } from '@/lib/recap-api';
import { useDelayedFlag } from '@/lib/use-delayed-flag';
import { colors, radius, spacing, typography } from '@/theme';

/** What the screen is showing. */
type Phase =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; items: RecapItem[] };

/**
 * Renders the recap screen.
 *
 * @returns the screen. Its optional input is `event` in the address.
 */
export default function RecapScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ event?: string | string[] }>();
  const eventId = Array.isArray(params.event) ? params.event[0] : params.event;

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  // Bumped by "Try again" to load once more.
  const [attempt, setAttempt] = useState(0);
  // VC-76: the spinner only after 300 ms of loading (no flash on fast loads).
  const showSpinner = useDelayedFlag(phase.kind === 'loading');

  // Load the recap. One event: look it up in the full list. Otherwise: the
  // last 36 hours. State is set only in `.then`, and ignored once closed.
  useEffect(() => {
    let active = true;
    getMyRecap(eventId ? 'all' : 'recent').then((outcome) => {
      if (!active) return;
      if (!outcome.ok) return setPhase({ kind: 'error', message: outcome.message });
      const items = eventId
        ? outcome.items.filter((item) => item.eventId === eventId)
        : outcome.items;
      setPhase({ kind: 'ready', items });
    });
    return () => {
      active = false;
    };
  }, [eventId, attempt]);

  /** Back to where the guest came from, or home if the notification opened us. */
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <BackButton onPress={goBack} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>THE MORNING AFTER</Text>
        <Text style={styles.title} accessibilityRole="header">
          Your night
        </Text>

        {phase.kind === 'loading' ? (
          <View style={styles.centre} accessible accessibilityLabel="Loading">
            {showSpinner ? <ActivityIndicator color={colors.accent} size="large" /> : null}
          </View>
        ) : null}

        {phase.kind === 'error' ? (
          <View style={styles.block}>
            <FormMessage message={phase.message} />
            <Button
              label="Try again"
              variant="outline"
              onPress={() => {
                setPhase({ kind: 'loading' });
                setAttempt((n) => n + 1);
              }}
            />
          </View>
        ) : null}

        {phase.kind === 'ready' && phase.items.length === 0 ? (
          <FadeIn>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Nothing to recap yet</Text>
              <Text style={styles.muted}>
                Rate an event and your recap lands here at 11 the next morning.
              </Text>
              <View style={styles.inlineAction}>
                <Button
                  label="See your nights out"
                  variant="outline"
                  size="small"
                  // VC-76: back down to the Me tab (closing this sheet),
                  // not a second Me opened inside the sheet.
                  onPress={() => router.dismissTo('/me')}
                />
              </View>
            </View>
          </FadeIn>
        ) : null}

        {phase.kind === 'ready' && phase.items.length > 0 ? (
          <FadeIn style={styles.list}>
            {phase.items.map((item) => (
              <RecapCard key={item.eventId} item={item} />
            ))}
          </FadeIn>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * One event's recap: your rating next to the room's published vibe.
 *
 * @param props.item - the recap item.
 * @returns the card.
 */
function RecapCard({ item }: { item: RecapItem }) {
  const room = roomSummary(item.vibe);
  const top = topReaction(item.vibe.reactions);
  const mineReaction = REACTIONS.find((r) => r.key === item.mine.reaction);
  const rows = `${rowWord('crowd', item.mine.crowd)} crowd · ${rowWord(
    'music',
    item.mine.music,
  )} music · ${rowWord('energy', item.mine.energy)} energy`;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} accessibilityRole="header">
        {item.title}
      </Text>
      <Text style={styles.muted}>{recapDateLine(item)}</Text>

      {/* YOU: the guest's own rating. */}
      <View
        style={styles.half}
        accessible
        accessibilityLabel={[
          `You called ${item.mine.label}.`,
          rows,
          // Their own reaction too, so screen-reader users hear everything shown.
          mineReaction ? `Your reaction: ${mineReaction.label}.` : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <Text style={styles.label}>YOU CALLED</Text>
        <Text style={[styles.word, { color: wordColour(item.mine.label) }]}>{item.mine.label}</Text>
        <Text style={styles.body}>{rows}</Text>
        {mineReaction ? (
          <Text style={styles.body}>
            {mineReaction.emoji} {mineReaction.label}
          </Text>
        ) : null}
      </View>

      {/* THE ROOM: the published snapshot only. */}
      <View
        style={styles.half}
        accessible
        accessibilityLabel={[
          room.word ? `The room said ${room.word}.` : 'The room: no night word.',
          room.detail,
          room.lastScore ? `Last score ${room.lastScore} out of 10.` : '',
          top ? `Top reaction ${top.word}, ${top.count}.` : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <Text style={styles.label}>THE ROOM, ALL NIGHT</Text>
        <Text style={[styles.word, { color: room.word ? wordColour(room.word) : colors.muted }]}>
          {room.word ?? '—'}
        </Text>
        <Text style={styles.body}>{room.detail}</Text>
        {room.lastScore ? <Text style={styles.muted}>Last score {room.lastScore}</Text> : null}
        {top ? (
          <Text style={styles.muted}>
            Top reaction: {top.emoji} {top.word} ({top.count})
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  content: { padding: spacing.gutter, gap: spacing.md, paddingBottom: spacing.xl },
  kicker: { ...typography.label, color: colors.accent },
  title: { ...typography.title, color: colors.text },
  centre: { paddingVertical: spacing.xl, alignItems: 'center' },
  // The recap cards keep the page's 16 px gap inside their fade wrapper.
  list: { gap: spacing.md },
  block: { gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    padding: 18,
    gap: spacing.sm,
  },
  cardTitle: { ...typography.cardTitle, color: colors.text },
  // One side of the comparison (you / the room), split by a thin line.
  half: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  label: { ...typography.label, color: colors.muted },
  word: { ...typography.title },
  body: { ...typography.bodySm, color: colors.text },
  muted: { ...typography.bodySm, color: colors.muted },
  inlineAction: { flexDirection: 'row', paddingTop: spacing.sm },
});
