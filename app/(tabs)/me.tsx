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
 * stats row, "Your sound" genres and clips.
 *
 * The round gear button next to the name opens Settings (sign out, delete
 * account, terms and privacy), as in the v3 design (VC-B13).
 *
 * Since Q4 ("launch look") this is the Me tab of the bottom bar
 * (app/(tabs)/me.tsx, still at "/me"), so it has no Back button. Tapping
 * the Me tab while already here scrolls back to the top.
 */
import { useFocusEffect, useRouter, useScrollToTop } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FormMessage } from '@/components/FormMessage';
import { Icon } from '@/components/Icon';
import { wordColour } from '@/components/VibeMeter';
import { useAuth } from '@/lib/auth-context';
import { nightWord, recapDateLine } from '@/lib/recap';
import type { RecapItem } from '@/lib/recap';
import { getMyRecap } from '@/lib/recap-api';
import { colors, iconSize, minTapTarget, radius, spacing, typography } from '@/theme';

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
  // The scroll view, so a tap on the already-open Me tab scrolls to the top.
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  useScrollToTop(scrollRef);

  // Load the last 36 hours (for the card) and the whole list together. The
  // server decides what counts as "last night", so the app doesn't repeat
  // the 36-hour rule. State is set only in `.then`, and ignored once the
  // screen is left.
  //
  // Why useFocusEffect and not useEffect (cto, Q4): Me is a tab now, so it
  // stays open in the background. A plain useEffect would load only once,
  // and a night rated afterwards would never show. This runs every time the
  // Me tab comes into view (and again after "Try again"). On a refresh the
  // old list stays on screen until the new one arrives (no spinner flash),
  // and if the refresh fails the old list is kept rather than replaced by
  // an error.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.all([getMyRecap('recent'), getMyRecap('all')]).then(([recent, all]) => {
        if (!active) return;
        if (!recent.ok || !all.ok) {
          const message = !recent.ok ? recent.message : !all.ok ? all.message : '';
          setPhase((current) => (current.kind === 'ready' ? current : { kind: 'error', message }));
          return;
        }
        setPhase({ kind: 'ready', recent: recent.items, all: all.items });
      });
      return () => {
        active = false;
      };
      // `attempt` isn't read inside; listing it reloads after "Try again".
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attempt]),
  );

  return (
    // Top edge only: the tab bar below handles the home-bar space.
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {profile?.display_name || 'Me'}
          </Text>
          <SettingsButton onPress={() => router.push('/settings')} />
        </View>

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
 * The round Settings button from the v3 profile design: a 44 px circle with
 * a thin edge and the "gear" line icon (Q4 icon set).
 *
 * @param props.onPress - opens Settings.
 * @returns the button, read by screen readers as "Settings, button".
 */
function SettingsButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Settings"
      style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
    >
      <Icon name="gear" size={iconSize.md} color={colors.text} />
    </Pressable>
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
      {/* "Opens another screen" arrow: decoration, the label says it all. */}
      <Icon name="chevron-right" size={iconSize.md} color={colors.muted} />
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
  // Q4 spec 2.5: 20 below the safe area (SafeAreaView adds the inset).
  content: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 20,
    gap: 18,
    paddingBottom: spacing.lg,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  title: { ...typography.title, color: colors.text, flex: 1 },
  gear: {
    width: minTapTarget,
    height: minTapTarget,
    borderRadius: minTapTarget / 2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
