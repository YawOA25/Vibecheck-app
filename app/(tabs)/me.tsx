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
 * VC-81 (founder approved 2026-10-29): under the name, "MEMBER SINCE OCT
 * 2026"; under that, the v3 stats row with two numbers, NIGHTS OUT
 * (different event nights you checked in to) and RATINGS (events you
 * rated). They are your own counts only, from get_my_stats
 * (src/lib/profile-stats-api.ts). They load next to the list; if they fail,
 * the row is simply left out (no error for a nice extra).
 *
 * Not here on purpose (VC-31, not approved for the MVP): the photo,
 * "Your sound" genres and clips (and so no CLIPS number in the stats row).
 *
 * The round gear button next to the name opens Settings (sign out, delete
 * account, terms and privacy), as in the v3 design (VC-B13).
 *
 * Since Q4 ("launch look") this is the Me tab of the bottom bar
 * (app/(tabs)/me.tsx, still at "/me"), so it has no Back button. Tapping
 * the Me tab while already here scrolls back to the top.
 *
 * Motion (VC-76, design/vc76-motion-spec.md 2a, 2b, 3a): the spinner only
 * shows if loading takes over 300 ms; the loaded list fades in once (later
 * refreshes swap it in place); the card and rows shrink a touch while
 * pressed, with a lighter background, and the gear circle shrinks to 0.96.
 * No shrinking under Reduce Motion (src/components/PressableScale.tsx).
 */
import { useFocusEffect, useRouter, useScrollToTop } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FadeIn } from '@/components/FadeIn';
import { FormMessage } from '@/components/FormMessage';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { wordColour } from '@/components/VibeMeter';
import { useAuth } from '@/lib/auth-context';
import { memberSinceText } from '@/lib/profile-stats';
import type { MyStats } from '@/lib/profile-stats';
import { getMyStats } from '@/lib/profile-stats-api';
import { nightWord, recapDateLine } from '@/lib/recap';
import type { RecapItem } from '@/lib/recap';
import { getMyRecap } from '@/lib/recap-api';
import { useDelayedFlag } from '@/lib/use-delayed-flag';
import {
  colors,
  fonts,
  iconSize,
  minTapTarget,
  motion,
  radius,
  spacing,
  typography,
} from '@/theme';

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
  // VC-81: your own counts, or null until (or unless) they load.
  const [stats, setStats] = useState<MyStats | null>(null);
  // The scroll view, so a tap on the already-open Me tab scrolls to the top.
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  useScrollToTop(scrollRef);
  // VC-76: the spinner only after 300 ms of loading (no flash on fast loads).
  const showSpinner = useDelayedFlag(phase.kind === 'loading');

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
      // VC-81: the stats load on their own. A failure keeps the last good
      // numbers (or none), and never turns the screen into an error.
      getMyStats().then((outcome) => {
        if (active && outcome.ok) setStats(outcome.stats);
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
          <View style={styles.nameBlock}>
            <Text style={styles.title} accessibilityRole="header">
              {profile?.display_name || 'Me'}
            </Text>
            {/* VC-81: the month you joined, under your name (v3 profile). */}
            {stats?.memberSince ? (
              <Text style={styles.memberSince}>{memberSinceText(stats.memberSince)}</Text>
            ) : null}
          </View>
          <SettingsButton onPress={() => router.push('/settings')} />
        </View>

        {stats ? <StatsRow stats={stats} /> : null}

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

        {/* VC-76: the loaded part fades in once; refreshes swap it in place. */}
        {phase.kind === 'ready' ? (
          <FadeIn style={styles.ready}>
            {phase.recent[0] ? (
              <LastNightCard item={phase.recent[0]} onPress={() => router.push('/recap')} />
            ) : null}

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
          </FadeIn>
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
    // A circle button: the existing dimming plus a 0.96 shrink (VC-76).
    <PressableScale
      scaleTo={motion.pressScale.circle}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Settings"
      style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
    >
      <Icon name="gear" size={iconSize.md} color={colors.text} />
    </PressableScale>
  );
}

/**
 * The stats row (VC-81, v3 profile design): two numbers side by side,
 * NIGHTS OUT and RATINGS, with a thin line between them.
 *
 * @param props.stats - your counts.
 * @returns the row, read out as one sentence, e.g. "4 nights out, 7 ratings".
 */
function StatsRow({ stats }: { stats: MyStats }) {
  const spoken = `${stats.nightsOut} ${stats.nightsOut === 1 ? 'night' : 'nights'} out, ${
    stats.ratings
  } ${stats.ratings === 1 ? 'rating' : 'ratings'}`;
  return (
    <View style={styles.stats} accessible accessibilityLabel={spoken} testID="me-stats">
      <View style={styles.stat}>
        <Text style={styles.statNumber}>{stats.nightsOut}</Text>
        <Text style={styles.statLabel}>NIGHTS OUT</Text>
      </View>
      <View style={[styles.stat, styles.statDivider]}>
        <Text style={styles.statNumber}>{stats.ratings}</Text>
        <Text style={styles.statLabel}>RATINGS</Text>
      </View>
    </View>
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
    // A card: shrinks to 0.98 with a lighter background while pressed (VC-76).
    <PressableScale
      scaleTo={motion.pressScale.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Last night, rated. ${text} Opens your recap.`}
      style={({ pressed }) => [styles.lastNight, pressed && styles.rowPressed]}
    >
      <View style={styles.lastNightText}>
        <Text style={styles.goldLabel}>LAST NIGHT, RATED</Text>
        <Text style={styles.body}>{text}</Text>
      </View>
      {/* "Opens another screen" arrow: decoration, the label says it all. */}
      <Icon name="chevron-right" size={iconSize.md} color={colors.muted} />
    </PressableScale>
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
    // A row: shrinks to 0.97 with a lighter background while pressed (VC-76).
    <PressableScale
      scaleTo={motion.pressScale.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${line}. ${room ? `The room: ${room}` : 'No night word'}.`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.muted}>{line}</Text>
      </View>
      <Text style={[styles.rowWord, { color: room ? wordColour(room) : colors.muted }]}>
        {room ?? '—'}
      </Text>
    </PressableScale>
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
  // The name and, under it, the VC-81 "member since" line.
  nameBlock: { flex: 1, gap: 2 },
  title: { ...typography.title, color: colors.text },
  memberSince: { ...typography.label, color: colors.muted },
  // VC-81 stats row (v3): a surface card, numbers in Bricolage 600 30/32.
  stats: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingVertical: 14,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  // The thin line between the two numbers.
  statDivider: { borderLeftWidth: 1, borderLeftColor: colors.border },
  statNumber: {
    fontFamily: fonts.displaySemi,
    fontSize: 30,
    lineHeight: 32,
    letterSpacing: -0.6,
    color: colors.text,
  },
  statLabel: { ...typography.label, color: colors.muted },
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
  // The gear circle's pressed look (unchanged).
  pressed: { opacity: 0.7 },
  // Cards and rows while pressed (VC-76, spec 3a): one step lighter.
  rowPressed: { backgroundColor: colors.surfaceRaised },
  // The loaded part keeps the page's 18 px gap inside its fade wrapper.
  ready: { gap: 18 },
});
