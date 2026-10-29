/**
 * The admin report queue (proposal VC-58). Address: /admin/reports.
 *
 * What it shows: every open "Report this tag", grouped per event and tag,
 * oldest first. Each row says the event, the tag, how many reports and +1s,
 * how many reports gave each reason ("Not true 2 · Spam or fake 1", VC-65),
 * and how long it has waited against the 48-hour review promise ("Overdue"
 * at 48 hours, in the error colour). Tapping a row opens that event's
 * Moderate screen (app/admin/moderate/[id].tsx), where the admin hides or
 * keeps the tag with a reason. Pull down to refresh.
 *
 * Privacy: the queue only ever has counts. Who reported is never sent to the
 * app, not even to admins.
 *
 * Who can open it: admins only (app/_layout.tsx hides the address from
 * everyone else, and the server refuses non-admins).
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { FadeIn } from '@/components/FadeIn';
import { PressableScale } from '@/components/PressableScale';
import { FormMessage } from '@/components/FormMessage';
import { Tag } from '@/components/Tag';
import { reasonCountsText, waitingText } from '@/lib/moderation';
import { getTagReports } from '@/lib/moderation-api';
import type { TagReportGroup } from '@/lib/moderation-api';
import { headsUpLabel } from '@/lib/rating';
import { useDelayedFlag } from '@/lib/use-delayed-flag';
import { colors, motion, radius, spacing, typography } from '@/theme';

/** The screen's words (exported so tests use the same text). */
export const QUEUE_TITLE = 'Reports';
export const QUEUE_EMPTY = 'No open reports. Nice.';
export const QUEUE_HINT = 'Review each report within 48 hours. Tap one to decide.';

/** What the screen is showing. */
type QueueState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; groups: TagReportGroup[] };

/**
 * Renders the queue.
 *
 * @returns the screen's view.
 */
export default function ReportsScreen() {
  const router = useRouter();
  const [state, setState] = useState<QueueState>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  // Bumped by pull-to-refresh to load again.
  const [attempt, setAttempt] = useState(0);

  // Load when the screen comes into view (so it is fresh after a decision
  // on the Moderate screen) and after a pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getTagReports().then((outcome) => {
        if (!active) return;
        setRefreshing(false);
        setState(
          outcome.ok
            ? { kind: 'ready', groups: outcome.groups }
            : { kind: 'error', message: outcome.message },
        );
      });
      return () => {
        active = false;
      };
      // `attempt` isn't read inside, but bumping it must run the load again.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attempt]),
  );

  /** Pull-to-refresh. Returns nothing. */
  const refresh = useCallback(() => {
    setRefreshing(true);
    setAttempt((n) => n + 1);
  }, []);

  /** Back to Tonight. Returns nothing. */
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  // VC-76: the spinner only after 300 ms of loading (no flash on fast loads).
  const showSpinner = useDelayedFlag(state.kind === 'loading');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <BackButton onPress={goBack} />
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        <Text style={styles.title} accessibilityRole="header">
          {QUEUE_TITLE}
        </Text>
        <Text style={styles.muted}>{QUEUE_HINT}</Text>

        {state.kind === 'loading' ? (
          <View accessible accessibilityLabel="Loading reports" style={styles.spinnerSpace}>
            {showSpinner ? <ActivityIndicator color={colors.accent} /> : null}
          </View>
        ) : null}
        {state.kind === 'error' ? <FormMessage message={state.message} /> : null}
        {state.kind === 'ready' && state.groups.length === 0 ? (
          <Text style={styles.muted}>{QUEUE_EMPTY}</Text>
        ) : null}

        {/* VC-76: the loaded queue fades in once; pull to refresh swaps it in place. */}
        {state.kind === 'ready' && state.groups.length > 0 ? (
          <FadeIn style={styles.list}>
            {state.groups.map((group) => {
              const tag = headsUpLabel(group.tag) ?? group.tag;
              const counts = `${group.reports} ${group.reports === 1 ? 'report' : 'reports'} · ${
                group.votes
              } ${group.votes === 1 ? '+1' : '+1s'}`;
              const waiting = waitingText(group.hoursWaiting);
              // VC-65: counts per reason, e.g. "Not true 2 · Spam or fake 1".
              const reasons = reasonCountsText(group.reasons);
              return (
                // VC-76: a card shrinks to 0.97 while pressed.
                <PressableScale
                  scaleTo={motion.pressScale.row}
                  key={`${group.eventId}-${group.tag}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${tag} at ${group.eventTitle}, ${counts}${
                    reasons ? `, ${reasons}` : ''
                  }, ${waiting}`}
                  onPress={() =>
                    router.push({
                      pathname: '/admin/moderate/[id]',
                      params: { id: group.eventId, title: group.eventTitle },
                    })
                  }
                  style={({ pressed }) => [styles.card, pressed && styles.pressed]}
                >
                  <View style={styles.cardHead}>
                    <Text style={styles.name}>{tag}</Text>
                    {group.hidden ? <Tag label="Hidden" /> : null}
                  </View>
                  <Text style={styles.body}>{group.eventTitle}</Text>
                  <Text style={styles.muted}>{counts}</Text>
                  {reasons ? <Text style={styles.body}>{reasons}</Text> : null}
                  <Text style={group.overdue ? styles.overdue : styles.muted}>{waiting}</Text>
                </PressableScale>
              );
            })}
          </FadeIn>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  content: { padding: spacing.gutter, gap: spacing.gap12 },
  title: { ...typography.title, color: colors.text },
  muted: { ...typography.bodySm, color: colors.muted },
  body: { ...typography.bodySm, color: colors.text },
  overdue: { ...typography.bodySm, color: colors.error },
  name: { ...typography.button, color: colors.text, flexShrink: 1 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  // The cards keep the page's 12 px gap inside their fade wrapper (VC-76).
  list: { gap: spacing.gap12 },
  // Room for the (delayed) spinner, so the hint above doesn't jump (VC-76).
  spinnerSpace: { minHeight: 20, alignItems: 'center' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
