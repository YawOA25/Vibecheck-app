/**
 * The Me screen (task VC-B12): a minimal version of the v3 profile
 * (design/v3/Profile.dc.html), holding only what B12 needs:
 *   - the guest's name;
 *   - a "LAST NIGHT, RATED" card when they rated something in the last 36
 *     hours, which opens the "Your night" recap;
 *   - "YOUR NIGHTS OUT": every event they rated, newest first (at most 50).
 *     Each row shows the night, the area, the guest's own word ("You: Fire")
 *     and, on the right, the room's final night word. Tapping a row opens
 *     that night's recap.
 * Words only for the room, never a number (the same rule as "All night").
 *
 * Not here on purpose (VC-31, not approved for the MVP): the photo, the
 * stats row, "Your sound" genres, clips and the bottom tab bar. Settings
 * (sign out, delete account) come with VC-B13.
 *
 * Opened from the "Me" button in the home screen's header.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { FormMessage } from '@/components/FormMessage';
import { wordColour } from '@/components/VibeMeter';
import { useAuth } from '@/lib/auth-context';
import { nightWord, recapDateLine } from '@/lib/recap';
import type { RecapItem } from '@/lib/recap';
import { getMyRecap } from '@/lib/recap-api';
import { colors, minTapTarget, radius, spacing, typography } from '@/theme';

/** What the screen is showing. */
type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; recent: RecapItem[]; all: RecapItem[] };

/**
 * Renders the Me screen.
 *
 * @returns the screen.
 */
export default function MeScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  // Bumped by "Try again" to load once more.
  const [attempt, setAttempt] = useState(0);

  // Load the last 36 hours (for the card) and the whole list together. The
  // server decides what counts as "last night", so the app doesn't repeat
  // the 36-hour rule. State is set only in `.then`, and ignored once closed.
  useEffect(() => {
    let active = true;
    Promise.all([getMyRecap('recent'), getMyRecap('all')]).then(([recent, all]) => {
      if (!active) return;
      if (!recent.ok) return setPhase({ kind: 'error', message: recent.message });
      if (!all.ok) return setPhase({ kind: 'error', message: all.message });
      setPhase({ kind: 'ready', recent: recent.items, all: all.items });
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  /** Back to the home screen. */
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
        <Text style={styles.title} accessibilityRole="header">
          {profile?.display_name || 'Me'}
        </Text>

        {phase.kind === 'loading' ? (
          <View style={styles.centre} accessible accessibilityLabel="Loading">
            <ActivityIndicator color={colors.accent} size="large" />
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

        {phase.kind === 'ready' && phase.recent[0] ? (
          <LastNightCard item={phase.recent[0]} onPress={() => router.push('/recap')} />
        ) : null}

        {phase.kind === 'ready' ? (
          <View>
            <Text style={styles.sectionLabel} accessibilityRole="header">
              YOUR NIGHTS OUT
            </Text>
            {phase.all.length === 0 ? (
              <Text style={styles.muted}>
                No nights yet. Check in and rate an event, and it shows up here.
              </Text>
            ) : (
              phase.all.map((item) => (
                <NightRow
                  key={item.eventId}
                  item={item}
                  onPress={() =>
                    router.push({ pathname: '/recap', params: { event: item.eventId } })
                  }
                />
              ))
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The gold "LAST NIGHT, RATED" card: your word and the room's word.
 *
 * @param props.item - the newest event rated in the last 36 hours.
 * @param props.onPress - opens the recap.
 * @returns the card.
 */
function LastNightCard({ item, onPress }: { item: RecapItem; onPress: () => void }) {
  const room = nightWord(item.vibe);
  const text = room
    ? `You called ${item.mine.label}. The room said ${room}.`
    : `You called ${item.mine.label}. See how the night went.`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Last night, rated. ${text} Opens your recap.`}
      style={({ pressed }) => [styles.lastNight, pressed && styles.pressed]}
    >
      <View style={styles.lastNightText}>
        <Text style={styles.goldLabel}>LAST NIGHT, RATED</Text>
        <Text style={styles.body}>{text}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

/**
 * One row of Nights out: the event, the night, your word, the room's word.
 *
 * @param props.item - the recap item.
 * @param props.onPress - opens that night's recap.
 * @returns the row.
 */
function NightRow({ item, onPress }: { item: RecapItem; onPress: () => void }) {
  const room = nightWord(item.vibe);
  const line = `${recapDateLine(item)} · You: ${item.mine.label}`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${line}. ${room ? `The room: ${room}` : 'No night word'}.`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.muted}>{line}</Text>
      </View>
      <Text style={[styles.rowWord, { color: room ? wordColour(room) : colors.muted }]}>
        {room ?? '—'}
      </Text>
    </Pressable>
  );
}

/** Styles built only from theme tokens (sizes from the v3 profile design). */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  content: { padding: spacing.gutter, gap: 18, paddingBottom: spacing.xl },
  title: { ...typography.title, color: colors.text },
  centre: { paddingVertical: spacing.xl, alignItems: 'center' },
  block: { gap: spacing.md },
  lastNight: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    borderRadius: radius.card,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: minTapTarget,
  },
  lastNightText: { flex: 1, gap: spacing.xs },
  goldLabel: { ...typography.label, color: colors.accent },
  chevron: { ...typography.cardTitle, color: colors.muted },
  sectionLabel: { ...typography.label, color: colors.muted, marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: minTapTarget,
  },
  rowText: { flex: 1, gap: 3 },
  rowTitle: { ...typography.cardTitle, color: colors.text },
  rowWord: { ...typography.button },
  body: { ...typography.bodySm, color: colors.text },
  muted: { ...typography.bodySm, color: colors.muted },
  pressed: { opacity: 0.7 },
});
