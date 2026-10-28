/**
 * Home screen (task VC-B05, week view VC-61): every event from now through
 * the next 7 nights, in the v3 look (design/v3/Tonight.dc.html, spec
 * v3-ui-spec.md 2.5).
 *
 * This is the first screen people see once signed in. It shows:
 *   - a header with the nights covered in New York time ("SATURDAY TO
 *     FRIDAY", still starting Saturday at 1 AM Sunday; see
 *     src/lib/tonight.ts) over the "This week" title, and nothing on the
 *     right (Q4 "launch look": the Me, New event, Reports and Sign out
 *     pills are gone. Me and Admin are tabs in the bottom bar now, and
 *     Sign out lives in Settings);
 *   - the events, one section per night ("Tonight", "Tomorrow", then
 *     weekday names, VC-61), each as a card (src/components/EventCard.tsx).
 *     Tapping a card opens the event page;
 *   - on each card that has started, the live vibe and the headcount (task
 *     VC-B09, VC-42), fetched in one call for the started events only, when
 *     the list loads, when the screen comes back into view, on pull to
 *     refresh, and every minute while it's on screen. Cards for events that
 *     haven't started show the details only (VC-61); an event that starts
 *     while the list is open gets its vibe at the next minute's refresh;
 *   - a date filter under the title (VC-63, revised 2026-10-27): "Tonight",
 *     "This weekend", "This week" (the default) or "Custom" (one date or a
 *     range, picked in a sheet or dialog; src/components/DateFilterBar.tsx).
 *     The title shows the filter ("Tonight", "This weekend", "Sat, Nov 7",
 *     "Nov 6 – Nov 15"); the list, pull to refresh and the minute
 *     vibe refresh all follow it; each filter has its own empty state with
 *     a "Show this week" button. The filter isn't saved anywhere: it is
 *     back to "This week" when the app restarts;
 *   - paging (VC-66): the list loads 100 events at a time. When there are
 *     more, scrolling near the end loads the next 100, and a "Load more
 *     events" button under the last card does the same (it also says when
 *     loading more failed). Pages always use the date window of the first
 *     page, and an answer for an older filter or an older refresh is
 *     ignored. Pull to refresh starts again from the first page;
 *   - after an admin creates an event (VC-63b): coming back here reloads
 *     the list, and if the date filter doesn't cover the new event's night
 *     a short note says where to find it ("Saved for Fri, Nov 14. Switch to
 *     Custom to see it."). The note goes away when the filter changes;
 *   - pull down to refresh;
 *   - a loading state, an error state with "Try again", and an empty state.
 *
 * Not here on purpose (VC-31, not approved for the MVP): the map, genre
 * filters, the featured host card, photos and clips.
 *
 * expo-router makes `app/(tabs)/index.tsx` the app's home address ("/"):
 * the "(tabs)" folder doesn't change the address. It is the first tab of
 * the bottom bar (app/(tabs)/_layout.tsx). The root layout only allows it
 * for signed-in people who passed the 18+ gate. Tapping the Tonight tab
 * while already here scrolls the list back to the top (useScrollToTop).
 */
import { useFocusEffect, useRouter, useScrollToTop } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { DateFilterBar } from '@/components/DateFilterBar';
import { EventCard } from '@/components/EventCard';
import { FormMessage } from '@/components/FormMessage';
import { Icon } from '@/components/Icon';
import { takeCreatedEvent } from '@/lib/created-event';
import {
  FILTER_LABELS,
  THIS_WEEK,
  createdNotice,
  filterEmptyText,
  filterKicker,
  filterTitle,
} from '@/lib/date-filter';
import type { DateFilter } from '@/lib/date-filter';
import { listHomeEvents } from '@/lib/events-read';
import { sendTestError } from '@/lib/sentry';
import { groupByDay, hasStarted } from '@/lib/tonight';
import type { PublicEvent } from '@/lib/tonight';
import { LIST_VIBE_REFRESH_MS } from '@/lib/vibe';
import { getEventsVibe } from '@/lib/vibe-api';
import type { Vibe } from '@/lib/vibe';
import { colors, iconSize, radius, spacing, typography } from '@/theme';

/** "This week"'s empty-state words (exported so tests use the same words). */
const WEEK_EMPTY = filterEmptyText(THIS_WEEK, new Date());
export const EMPTY_TITLE = WEEK_EMPTY.title;
export const EMPTY_BODY = WEEK_EMPTY.body;
/** The screen's title with the default filter (VC-61: the week, not just tonight). */
export const LIST_TITLE = FILTER_LABELS.week;
/** The empty state's way back to the default filter (VC-63). */
export const SHOW_WEEK_LABEL = 'Show this week';
/** The button under the last card when more events follow (VC-66). */
export const LOAD_MORE_LABEL = 'Load more events';

/**
 * What the list is showing right now:
 *   loading - first load, nothing to show yet (spinner);
 *   error   - the first load failed (message plus "Try again");
 *   ready   - events loaded (maybe zero: then the empty state shows).
 *             `loadedAt` is the moment used for the night sections and
 *             for the date window of every later page. `hasMore` is true
 *             when more events follow the ones loaded (VC-66).
 */
type ListState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; events: PublicEvent[]; loadedAt: Date; hasMore: boolean };

/**
 * Renders the home screen (the week's events).
 *
 * Returns: the screen's view. It takes no inputs.
 */
export default function HomeScreen() {
  const router = useRouter();
  // The list, so a tap on the already-open Tonight tab can scroll it to the top.
  const listRef = useRef<SectionList<PublicEvent>>(null);
  // The cast only quiets a typing gap: React Native 0.88's SectionList type
  // doesn't match the hook's older "scrollable" type, but at run time the
  // hook finds the list's scroll view (getScrollResponder) and scrolls it.
  useScrollToTop(listRef as unknown as Parameters<typeof useScrollToTop>[0]);

  const [state, setState] = useState<ListState>({ kind: 'loading' });
  // The date filter (VC-63). Kept in memory only, so it resets on restart.
  const [filter, setFilter] = useState<DateFilter>(THIS_WEEK);
  // Numbers each list load. Only the newest load's answer is used, so a
  // slow answer for an old filter (or an old pull to refresh) never
  // replaces the list for the filter now picked.
  const loadSeq = useRef(0);
  // True while a pull-to-refresh is running (the small spinner at the top).
  const [refreshing, setRefreshing] = useState(false);
  // A message when a refresh fails but we still have the older list to show.
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // VC-66: true while the next page is loading (a ref too, so a scroll and
  // a button tap at the same moment can't load the same page twice), and a
  // message when loading more failed.
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  // Bumped by "Try again" to run the first load again.
  const [attempt, setAttempt] = useState(0);
  // Each event's vibe by id (VC-B09). Empty until the first answer; a failed
  // refresh keeps the last good scores (cards without one show no badge).
  const [vibes, setVibes] = useState<Record<string, Vibe>>({});
  // Bumped by pull to refresh so the scores reload with the list.
  const [vibeTick, setVibeTick] = useState(0);
  // The moment of the last vibe refresh (every minute). Cards use it to
  // decide "has it started?" (VC-61), so an event that starts while the
  // list is open shows its vibe without a pull to refresh.
  const [clock, setClock] = useState<Date | null>(null);
  // VC-63b: after creating an event that the filter hides, where to find it.
  const [createdNote, setCreatedNote] = useState<string | null>(null);

  // The events on screen as "id|start time" pairs, joined into one string so
  // the effect below only restarts when the list of events really changes.
  const eventsKey = useMemo(
    () =>
      state.kind === 'ready' ? state.events.map((e) => `${e.id}|${e.starts_at}`).join(',') : '',
    [state],
  );

  // Load the vibes for the started cards: now, then every minute while this
  // screen is in view and the app is open. Stops when the guest opens an
  // event (the event page refreshes its own) and starts again on the way back.
  useFocusEffect(
    useCallback(() => {
      if (!eventsKey) return undefined;
      let active = true;
      const onScreen = eventsKey.split(',').map((pair) => {
        const [id, starts_at] = pair.split('|');
        return { id, starts_at };
      });

      /**
       * Asks for the scores of the events that have started, in one call
       * (VC-61: not-started events are never asked about). With none
       * started there is no call at all.
       */
      function load() {
        const now = new Date();
        const started = onScreen.filter((e) => hasStarted(e, now)).map((e) => e.id);
        const call = started.length > 0 ? getEventsVibe(started) : Promise.resolve(null);
        call.then((outcome) => {
          if (!active) return;
          setClock(now);
          if (outcome === null) setVibes({});
          // Keep only the ids we asked about: if the server ever answered
          // for an event that hasn't started, it is dropped here.
          else if (outcome.ok) setVibes(pickIds(outcome.vibes, started));
        });
      }

      load();
      const timer = setInterval(() => {
        // Skip while the app is in the background (not on screen).
        if (AppState.currentState !== 'background') load();
      }, LIST_VIBE_REFRESH_MS);
      return () => {
        active = false;
        clearInterval(timer);
      };
      // `vibeTick` isn't read inside; listing it reloads after pull to refresh.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eventsKey, vibeTick]),
  );

  // Load the list when the screen opens, and again after "Try again".
  // State is only set inside `.then` (when the answer arrives), and
  // `active` ignores a late answer if the screen has closed or a newer
  // load started (lesson from VC-B03: avoid stale answers).
  // Also runs when the filter changes (VC-63).
  useEffect(() => {
    let active = true;
    const now = new Date();
    const seq = ++loadSeq.current;
    listHomeEvents(now, filter).then((outcome) => {
      if (!active || seq !== loadSeq.current) return;
      setState(
        outcome.ok
          ? {
              kind: 'ready',
              events: outcome.events,
              loadedAt: now,
              hasMore: outcome.hasMore === true,
            }
          : { kind: 'error', message: outcome.message },
      );
      setLoadMoreError(null);
    });
    return () => {
      active = false;
    };
  }, [attempt, filter]);

  /**
   * A new filter was picked: show the spinner and load its events (the
   * effect above does the loading).
   *
   * @param next - the filter picked.
   */
  const chooseFilter = useCallback((next: DateFilter) => {
    setFilter(next);
    setState({ kind: 'loading' });
    setRefreshError(null);
    // The "where to find your new event" note was about the old filter.
    setCreatedNote(null);
  }, []);

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
    const seq = ++loadSeq.current;
    const outcome = await listHomeEvents(now, filter);
    // The filter changed while this was loading: its own load wins.
    if (seq !== loadSeq.current) {
      setRefreshing(false);
      return;
    }
    if (outcome.ok) {
      setState({
        kind: 'ready',
        events: outcome.events,
        loadedAt: now,
        hasMore: outcome.hasMore === true,
      });
      setRefreshError(null);
      setLoadMoreError(null);
      // Fresh scores too, even if the same events came back.
      setVibeTick((n) => n + 1);
    } else {
      setRefreshError(outcome.message);
    }
    setRefreshing(false);
  }, [filter]);

  /**
   * Loads the next page of events (VC-66), after the last one shown, with
   * the same date window as the first page. Runs from scrolling near the
   * end and from the "Load more events" button.
   *
   * Stale answers: it remembers the load number it started under. If the
   * filter changed, "Try again" ran or a pull to refresh started meanwhile,
   * that number moved on and this answer is dropped, so a page for an old
   * list is never glued onto a new one. A second guard sits where the page
   * is added (cto review): the list on screen must still be the one the page
   * was asked for, i.e. the same load moment and the same last card. That
   * catches a refresh that started BEFORE this request and landed after it.
   */
  const loadMore = useCallback(async () => {
    if (state.kind !== 'ready' || !state.hasMore || state.events.length === 0) return;
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    const seq = loadSeq.current;
    const last = state.events[state.events.length - 1];
    // The list this page belongs to: its load moment (and, below, its last card).
    const askedLoadedAt = state.loadedAt;
    const outcome = await listHomeEvents(askedLoadedAt, filter, last);
    loadingMoreRef.current = false;
    setLoadingMore(false);
    if (seq !== loadSeq.current) return;
    if (!outcome.ok) {
      setLoadMoreError(outcome.message);
      return;
    }
    setState((current) => {
      if (current.kind !== 'ready') return current;
      // The list was replaced meanwhile (a refresh landed, or another page
      // was added): this page doesn't follow it, so drop it.
      const currentLast = current.events[current.events.length - 1];
      if (current.loadedAt !== askedLoadedAt || currentLast?.id !== last.id) return current;
      // Skip any event already in the list (it can't normally happen, but a
      // duplicate card would break the list's keys).
      const seen = new Set(current.events.map((e) => e.id));
      const added = outcome.events.filter((e) => !seen.has(e.id));
      return {
        ...current,
        events: [...current.events, ...added],
        hasMore: outcome.hasMore === true,
      };
    });
  }, [state, filter]);

  // VC-63b: back from New event with a new event saved? Reload the list (the
  // screen stayed open underneath, so it wouldn't reload by itself), and if
  // the filter doesn't cover the event's night, say where to find it. The
  // note is taken once, so opening other pages and coming back does nothing.
  useFocusEffect(
    useCallback(() => {
      const created = takeCreatedEvent();
      if (!created) return undefined;
      setCreatedNote(createdNotice(created.startsAt, filter, new Date()));
      void refresh();
      return undefined;
    }, [filter, refresh]),
  );

  /** Opens an event's page, e.g. /event/1234. */
  const openEvent = useCallback(
    (id: string) => router.push({ pathname: '/event/[id]', params: { id } }),
    [router],
  );

  return (
    // SafeAreaView adds padding so content isn't hidden under the iPhone's notch or clock.
    // No bottom edge: the tab bar below takes care of the home-bar space.
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        {/* The kicker line over the title; nothing on the right (Q4). */}
        <View style={styles.titleBlock}>
          <Text style={styles.kicker}>{filterKicker(filter, new Date())}</Text>
          {/* accessibilityRole="header" lets screen readers announce this as a heading.
              Developers only (__DEV__ is false in store builds): a long-press
              on the title sends a test crash report to Sentry (VC-26). */}
          <Text
            style={styles.title}
            accessibilityRole="header"
            onLongPress={__DEV__ ? confirmTestError : undefined}
          >
            {filterTitle(filter, new Date())}
          </Text>
        </View>
        <DateFilterBar filter={filter} now={new Date()} onChange={chooseFilter} />
        {createdNote ? (
          // Read out as soon as it appears, so screen-reader users hear it too.
          <Text
            style={styles.createdNote}
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
          >
            {createdNote}
          </Text>
        ) : null}
      </View>

      {state.kind === 'loading' ? <LoadingState /> : null}
      {state.kind === 'error' ? <ErrorState message={state.message} onRetry={retry} /> : null}
      {state.kind === 'ready' ? (
        <SectionList
          ref={listRef}
          testID="tonight-list"
          sections={groupByDay(state.events, state.loadedAt)}
          keyExtractor={(event) => event.id}
          renderItem={({ item }) => (
            <EventCard
              event={item}
              // The later of the list's load time and the last vibe refresh,
              // so "has it started?" moves on with the minute refresh.
              now={clock && clock > state.loadedAt ? clock : state.loadedAt}
              vibe={vibes[item.id]}
              onPress={() => openEvent(item.id)}
            />
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
          // VC-66: near the end of the list, load the next page (if any).
          onEndReached={state.hasMore ? () => void loadMore() : undefined}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            state.hasMore ? (
              <View style={styles.loadMore}>
                {loadMoreError ? <FormMessage message={loadMoreError} /> : null}
                <Button
                  label={LOAD_MORE_LABEL}
                  variant="outline"
                  size="small"
                  busy={loadingMore}
                  busyLabel="Loading..."
                  onPress={() => void loadMore()}
                />
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            <EmptyState
              filter={filter}
              onShowWeek={filter.kind === 'week' ? null : () => chooseFilter(THIS_WEEK)}
            />
          }
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
 * Developers only: sends a test error to Sentry and says what happened, so
 * the founder can check it arrives in the Sentry dashboard (VC-26).
 *
 * @returns nothing; shows a small pop-up with the result.
 */
function confirmTestError() {
  const sent = sendTestError();
  Alert.alert(
    sent ? 'Test error sent' : 'Sentry is off',
    sent
      ? 'Look for it in the Sentry dashboard (environment: development) in a minute.'
      : 'Add EXPO_PUBLIC_SENTRY_DSN to .env, then restart Expo.',
  );
}

/**
 * Keeps only some ids' entries from a vibes-by-id answer.
 *
 * @param vibes - the server's answer, by event id.
 * @param ids - the ids to keep (the started events we asked about).
 * @returns a new object with just those ids that are present.
 */
function pickIds(vibes: Record<string, Vibe>, ids: string[]): Record<string, Vibe> {
  const kept: Record<string, Vibe> = {};
  for (const id of ids) if (vibes[id]) kept[id] = vibes[id];
  return kept;
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
    <View style={styles.centre} accessible accessibilityLabel="Loading events">
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={styles.note}>Loading events...</Text>
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
 * Shown when the filter's nights have no events.
 *
 * @param props.filter - the filter in use (VC-63: each has its own words).
 * @param props.onShowWeek - goes back to "This week", or null when that is
 *   already the filter (then there is no button).
 * @returns a card with a heading, a hint to pull down to refresh, and the
 *   "Show this week" button for the other filters.
 */
function EmptyState({
  filter,
  onShowWeek,
}: {
  filter: DateFilter;
  onShowWeek: (() => void) | null;
}) {
  const text = filterEmptyText(filter, new Date());
  return (
    <View style={styles.card}>
      {/* A quiet moon (Q4 icon set); decoration only. */}
      <Icon name="moon" size={iconSize.lg} color={colors.muted} />
      <Text style={styles.emptyTitle} accessibilityRole="header">
        {text.title}
      </Text>
      <Text style={styles.note}>{text.body}</Text>
      {onShowWeek ? (
        <View style={styles.emptyAction}>
          <Button label={SHOW_WEEK_LABEL} variant="outline" size="small" onPress={onShowWeek} />
        </View>
      ) : null}
    </View>
  );
}

/** Styles for this screen, built only from theme tokens. */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  // Q4 spec 2.5: 20 below the safe area (SafeAreaView adds the inset), 16
  // at the sides, 12 below, and a 16 gap between the title and the chips.
  header: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 20,
    paddingBottom: spacing.gap12,
    gap: spacing.md,
  },
  titleBlock: { gap: spacing.xs },
  kicker: { ...typography.label, color: colors.muted },
  // The "Saved for ... Switch to ..." note (VC-63b), in the success colour.
  createdNote: { ...typography.bodySm, color: colors.success },
  // Q4 spec 2.5: the title at 32/38 here.
  title: { ...typography.title, lineHeight: 38, color: colors.text },
  listContent: {
    paddingHorizontal: spacing.gutter,
    // 24 is enough: the tab bar below now covers the home-bar space (Q4).
    paddingBottom: spacing.lg,
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
  // The "Load more events" button (and any error) under the last card.
  loadMore: { paddingTop: spacing.md, gap: spacing.sm, alignItems: 'flex-start' },
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
  // The button sits at the start, only as wide as its words.
  emptyAction: { flexDirection: 'row', paddingTop: spacing.sm },
  note: { ...typography.bodySm, color: colors.muted },
});
