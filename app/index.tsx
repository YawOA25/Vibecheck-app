/**
 * Tonight screen (task VC-B05): the list of today's and tomorrow's events,
 * in the v3 look (design/v3/Tonight.dc.html, spec v3-ui-spec.md 2.5).
 *
 * This is the first screen people see once signed in. It shows:
 *   - a header with the night in New York time ("SATURDAY NIGHT", still
 *     Saturday at 1 AM Sunday; see src/lib/tonight.ts), the "Tonight" title, a
 *     "Sign out" pill (VC-B03; it moves to settings in VC-B13), and for
 *     admins only a "New event" pill (VC-B04);
 *   - the events, in a "Today" and a "Tomorrow" section, each as a card
 *     (src/components/EventCard.tsx). Tapping a card opens the event page;
 *   - pull down to refresh;
 *   - a loading state, an error state with "Try again", and an empty state.
 *
 * Not here on purpose (VC-31, not approved for the MVP): the map, genre
 * filters, the featured host card, photos and clips.
 *
 * expo-router makes `app/index.tsx` the app's home address ("/"). The root
 * layout only allows it for signed-in people who passed the 18+ gate.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { EventCard } from '@/components/EventCard';
import { FormMessage } from '@/components/FormMessage';
import { useAuth } from '@/lib/auth-context';
import { listTonightEvents } from '@/lib/events-read';
import { groupByDay, tonightKicker } from '@/lib/tonight';
import type { PublicEvent } from '@/lib/tonight';
import { colors, radius, spacing, typography } from '@/theme';

/** Text for the empty state (exported so tests use the same words). */
export const EMPTY_TITLE = 'Nothing on yet';
export const EMPTY_BODY =
  'No events for tonight or tomorrow yet. Pull down to refresh, or check back later.';

/**
 * What the list is showing right now:
 *   loading - first load, nothing to show yet (spinner);
 *   error   - the first load failed (message plus "Try again");
 *   ready   - events loaded (maybe zero: then the empty state shows).
 *             `loadedAt` is the moment used for "Today" / "On now" labels.
 */
type ListState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; events: PublicEvent[]; loadedAt: Date };

/**
 * Renders the Tonight screen.
 *
 * Returns: the screen's view. It takes no inputs.
 */
export default function TonightScreen() {
  const { profile, signOut } = useAuth();
  const router = useRouter();
  // Only admins create events (the server checks this too, VC-B04).
  const isAdmin = profile?.role === 'admin';

  const [state, setState] = useState<ListState>({ kind: 'loading' });
  // True while a pull-to-refresh is running (the small spinner at the top).
  const [refreshing, setRefreshing] = useState(false);
  // A message when a refresh fails but we still have the older list to show.
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // Bumped by "Try again" to run the first load again.
  const [attempt, setAttempt] = useState(0);

  // Load the list when the screen opens, and again after "Try again".
  // State is only set inside `.then` (when the answer arrives), and
  // `active` ignores a late answer if the screen has closed or a newer
  // load started (lesson from VC-B03: avoid stale answers).
  useEffect(() => {
    let active = true;
    const now = new Date();
    listTonightEvents(now).then((outcome) => {
      if (!active) return;
      setState(
        outcome.ok
          ? { kind: 'ready', events: outcome.events, loadedAt: now }
          : { kind: 'error', message: outcome.message },
      );
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  /** "Try again" after a failed first load: back to the spinner, then reload. */
  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  /**
   * Pull to refresh. On failure the old list stays, with a message above it,
   * so a weak signal at a party never wipes what people were looking at.
   */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    const now = new Date();
    const outcome = await listTonightEvents(now);
    if (outcome.ok) {
      setState({ kind: 'ready', events: outcome.events, loadedAt: now });
      setRefreshError(null);
    } else {
      setRefreshError(outcome.message);
    }
    setRefreshing(false);
  }, []);

  /** Opens an event's page, e.g. /event/1234. */
  const openEvent = useCallback(
    (id: string) => router.push({ pathname: '/event/[id]', params: { id } }),
    [router],
  );

  return (
    // SafeAreaView adds padding so content isn't hidden under the iPhone's notch or clock.
    // The bottom edge is left to the list, so cards can scroll under the home bar.
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.kicker}>{tonightKicker(new Date())}</Text>
        {/* Title on the left, the header buttons on the right of the same row. */}
        <View style={styles.headerRow}>
          {/* accessibilityRole="header" lets screen readers announce this as a heading. */}
          <Text style={styles.title} accessibilityRole="header">
            Tonight
          </Text>
          <View style={styles.headerActions}>
            {isAdmin ? (
              <Button
                label="New event"
                size="small"
                onPress={() => router.push('/admin/new-event')}
              />
            ) : null}
            <Button label="Sign out" variant="outline" size="small" onPress={signOut} />
          </View>
        </View>
      </View>

      {state.kind === 'loading' ? <LoadingState /> : null}
      {state.kind === 'error' ? <ErrorState message={state.message} onRetry={retry} /> : null}
      {state.kind === 'ready' ? (
        <SectionList
          testID="tonight-list"
          sections={groupByDay(state.events, state.loadedAt)}
          keyExtractor={(event) => event.id}
          renderItem={({ item }) => (
            <EventCard event={item} now={state.loadedAt} onPress={() => openEvent(item.id)} />
          )}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {section.title.toUpperCase()}
            </Text>
          )}
          // Section headings scroll away with their cards instead of sticking.
          stickySectionHeadersEnabled={false}
          ItemSeparatorComponent={Gap}
          ListHeaderComponent={
            refreshError ? (
              <View style={styles.refreshError}>
                <FormMessage message={refreshError} />
              </View>
            ) : undefined
          }
          ListEmptyComponent={<EmptyState />}
          contentContainerStyle={styles.listContent}
          // Pull down to refresh. The spinner is gold to match the theme.
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
              progressBackgroundColor={colors.surface}
            />
          }
        />
      ) : null}
    </SafeAreaView>
  );
}

/**
 * The 14 px space between cards (v3 list gap).
 *
 * @returns an empty spacer view.
 */
function Gap() {
  return <View style={styles.gap} />;
}

/**
 * First-load spinner.
 *
 * @returns a centred spinner with a short line, read out by screen readers.
 */
function LoadingState() {
  return (
    <View style={styles.centre} accessible accessibilityLabel="Loading tonight's events">
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={styles.note}>Loading tonight&apos;s events...</Text>
    </View>
  );
}

/**
 * Shown when the first load failed.
 *
 * @param props.message - what went wrong, in plain words.
 * @param props.onRetry - runs the load again.
 * @returns the message (icon plus sentence, announced) and a "Try again" button.
 */
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.centre}>
      <FormMessage message={message} />
      <Button label="Try again" variant="outline" onPress={onRetry} />
    </View>
  );
}

/**
 * Shown when there are no events today or tomorrow.
 *
 * @returns a card with a heading and a hint to pull down to refresh.
 */
function EmptyState() {
  return (
    <View style={styles.card}>
      <Text style={styles.emptyTitle} accessibilityRole="header">
        {EMPTY_TITLE}
      </Text>
      <Text style={styles.note}>{EMPTY_BODY}</Text>
    </View>
  );
}

/** Styles for this screen, built only from theme tokens. */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.gutter,
    paddingBottom: spacing.xs,
    gap: spacing.xs,
  },
  kicker: { ...typography.label, color: colors.muted },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.gap12,
  },
  // The header buttons sit together on the right, and wrap if text is very large.
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    flexShrink: 1,
  },
  // flexShrink lets a very large title wrap instead of pushing the button off screen.
  title: { ...typography.title, color: colors.text, flexShrink: 1 },
  listContent: {
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.xl,
    // flexGrow lets the empty state fill a list that can still be pulled down.
    flexGrow: 1,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.muted,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  gap: { height: 14 },
  refreshError: { paddingTop: spacing.sm },
  centre: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  card: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: spacing.xs,
  },
  emptyTitle: { ...typography.cardTitle, color: colors.text },
  note: { ...typography.bodySm, color: colors.muted },
});
