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
 *     Q6 ("home polish and motion"): loading shows three card-shaped
 *     skeleton blocks instead of a spinner; the error shows the alert icon
 *     in a circle over the sentence; the empty card has the moon centred
 *     above its heading. Cards shrink a touch (0.98) while pressed, and the
 *     list fades in when a new load lands. All motion is off under the
 *     phone's Reduce Motion setting (src/lib/reduce-motion.ts).
 *   - VC-76 ("smooth transitions", design/vc76-motion-spec.md 2d and 3d):
 *     the list fades in ONLY on the first load and after a filter change.
 *     Pull to refresh, the minute vibe refresh, a new event saved by an
 *     admin and "Load more" swap the data in place, so nothing blinks.
 *     After a filter change the old list stays on screen, dimmed to 40% and
 *     untappable, until the new one lands (the skeleton only shows when
 *     there was no list at all). Cards only re-draw when their own data
 *     changes (memoised rows), and the list draws 8 cards at a time.
 *
 *   - VC-79 (map view, founder approved 2026-10-28): a "List / Map" switch
 *     at the top right. Map shows the same date filter's events as area
 *     circles on a map (src/components/TonightMap.tsx); the chips drive
 *     both. It starts on List and is remembered until the app restarts.
 *     iPhone only for now: on Android the Map side says "Map coming soon"
 *     with a way back to the list (no Google Maps key yet).
 *
 *   - VC-80 (home redesign, Concept A "Live hero + carousel", founder
 *     approved 2026-10-29; design/vc80-home-redesign-spec.md): tonight's
 *     events no longer sit in the plain list. At the top, a big HERO card
 *     shows the live event with the highest published live score ("ON FIRE
 *     RIGHT NOW"), or with none yet the soonest event still to start ("NEXT
 *     UP"). Under it the other tonight events: one wide art card when there
 *     is only one other, else a sideways CAROUSEL that snaps card by card
 *     (the middle card full size, its neighbours 94%, the art drifting 12 px
 *     against the scroll). Then the later nights as the usual cards, under
 *     day headings that now STICK to the top while their night scrolls by.
 *     When the filter covers tonight but nothing is on tonight, a moon note
 *     says so above the later nights. The rules for who goes where are plain
 *     functions in src/lib/home-layout.ts. The scores are the same published
 *     snapshots the cards always used (no new data). As you scroll, the big
 *     title shrinks into a slim 17 px title (the kicker fades), with the
 *     chips staying put; the header keeps its height, so pull to refresh
 *     and the sticky day headings work as before. Light "ticks" (haptics):
 *     picking a date chip, the carousel settling on a new card, a new day
 *     heading reaching the top; a light tap when a pull to refresh starts.
 *     Under Reduce Motion: no title shrink, no scaling, no parallax and no
 *     LIVE pulse.
 *
 * Not here on purpose (VC-31, not approved for the MVP): genre filters, the
 * featured host card, photos and clips.
 *
 * expo-router makes `app/(tabs)/index.tsx` the app's home address ("/"):
 * the "(tabs)" folder doesn't change the address. It is the first tab of
 * the bottom bar (app/(tabs)/_layout.tsx). The root layout only allows it
 * for signed-in people who passed the 18+ gate. Tapping the Tonight tab
 * while already here scrolls the list back to the top (useScrollToTop).
 */
import { useFocusEffect, useRouter, useScrollToTop } from 'expo-router';
import type { SectionListData, SectionListRenderItem, ListViewToken } from 'react-native';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  Platform,
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
import { LiveDot } from '@/components/LiveDot';
import { ListSkeleton } from '@/components/Skeleton';
import { StatusPanel } from '@/components/StatusPanel';
import { ArtCard, HeroCard, TonightCarousel } from '@/components/TonightCards';
import { TonightMap } from '@/components/TonightMap';
import { TwoWaySwitch } from '@/components/TwoWaySwitch';
import type { SwitchOption } from '@/components/TwoWaySwitch';
import { takeCreatedEvent } from '@/lib/created-event';
import {
  FILTER_LABELS,
  THIS_WEEK,
  createdNotice,
  filterCoversNight,
  filterEmptyText,
  filterKicker,
  filterTitle,
} from '@/lib/date-filter';
import type { DateFilter } from '@/lib/date-filter';
import { listHomeEvents } from '@/lib/events-read';
import { tapLight, tapSelection } from '@/lib/haptics';
import {
  heroLabel,
  homeLayout,
  laterLabel,
  nothingTonightText,
  othersLabel,
} from '@/lib/home-layout';
import type { HomeLayout } from '@/lib/home-layout';
import { motionAllowed, useReduceMotion } from '@/lib/reduce-motion';
import { sendTestError } from '@/lib/sentry';
import { groupByDay, hasStarted, nightOf } from '@/lib/tonight';
import type { PublicEvent } from '@/lib/tonight';
import { LIST_VIBE_REFRESH_MS } from '@/lib/vibe';
import { getEventsVibe } from '@/lib/vibe-api';
import type { Vibe } from '@/lib/vibe';
import { colors, iconSize, motion, radius, spacing, typography } from '@/theme';

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
/** How long the list takes to fade in when a new load lands (VC-72). */
export const LIST_FADE_MS = motion.base.duration;
/**
 * How strong the old list stays while a new filter's list loads (VC-76): 40%,
 * so it reads as "on its way out" without the screen going blank.
 */
export const DIMMED_OPACITY = 0.4;
/** List or map (VC-79). */
export type TonightView = 'list' | 'map';
/** The List / Map switch's two options (spoken "List view" / "Map view"). */
export const VIEW_OPTIONS: readonly [SwitchOption<TonightView>, SwitchOption<TonightView>] = [
  { key: 'list', label: 'List', spoken: 'List view' },
  { key: 'map', label: 'Map', spoken: 'Map view' },
];
/**
 * VC-80 collapsing header: how far (in pixels of scrolling) the big title
 * takes to shrink into the slim one, and the slim title's size (17 px from
 * the 32 px title, spec "collapses into a 52 px bar with a 17 px title").
 */
export const COLLAPSE_DISTANCE = 60;
export const SLIM_TITLE_SCALE = 17 / 32;
/**
 * How far the title moves up as it shrinks: into the middle of the title
 * row, where the kicker (16 px) and its 4 px gap were.
 */
const SLIM_TITLE_LIFT = -10;
/**
 * When a row counts as on screen for the day-heading tick (VC-80): half of
 * it showing is enough.
 */
const DAY_VIEWABILITY = { itemVisiblePercentThreshold: 50 } as const;
/**
 * A stand-in "now" for when no list is loaded. Never shown: cards are only
 * drawn once a list is ready. Made once here (not per draw) so the memoised
 * cards (VC-76) don't see a new value every time.
 */
const NO_LIST = new Date(0);

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
  | {
      kind: 'ready';
      events: PublicEvent[];
      loadedAt: Date;
      hasMore: boolean;
      /**
       * Which list load this is (the load number from `loadSeq`). A new
       * number means a freshly loaded list, so the tonight carousel starts
       * over at its first card. "Load more" keeps the number (same list).
       */
      loadId: number;
    };

/**
 * Renders the home screen (the week's events).
 *
 * Returns: the screen's view. It takes no inputs.
 */
export default function HomeScreen() {
  const router = useRouter();
  // The list, so a tap on the already-open Tonight tab can scroll it to the top.
  const listRef = useRef<SectionList<PublicEvent, { title: string }>>(null);
  // VC-80: how far the list has scrolled, followed on the phone's UI thread
  // (native driver) so the header can shrink smoothly with it.
  const [scrollY] = useState(() => new Animated.Value(0));
  // VC-80 day-heading tick: the night at the top of the later list last
  // time, and whether the person has scrolled yet (no tick on first draw).
  const topNight = useRef<string | null>(null);
  const userScrolled = useRef(false);
  // The cast only quiets a typing gap: React Native 0.88's SectionList type
  // doesn't match the hook's older "scrollable" type, but at run time the
  // hook finds the list's scroll view (getScrollResponder) and scrolls it.
  useScrollToTop(listRef as unknown as Parameters<typeof useScrollToTop>[0]);

  const [state, setState] = useState<ListState>({ kind: 'loading' });
  // The date filter (VC-63). Kept in memory only, so it resets on restart.
  const [filter, setFilter] = useState<DateFilter>(THIS_WEEK);
  // VC-79: list or map. Kept in memory only, so it's back to List on restart.
  const [view, setView] = useState<TonightView>('list');
  /** Back to the list (the map's "See the list" buttons). */
  const showList = useCallback(() => setView('list'), []);
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
  // VC-72: the phone's Reduce Motion setting (null until it answers), and
  // the list's opacity for the fade-in. Read once here and handed to every
  // card, so 100 cards don't each ask the phone.
  const reduceMotion = useReduceMotion();
  const [listOpacity] = useState(() => new Animated.Value(1));
  // VC-76: counts the lists that should fade in. It goes up only when the
  // first load, a filter change or "Try again" lands (the effect further
  // down), never on pull to refresh, the minute vibe refresh or "Load
  // more". Before VC-76 the fade followed the list's load moment, which
  // pull to refresh also changes, so the list blinked on every refresh.
  const [fadeKey, setFadeKey] = useState(0);
  // VC-76: true while a new filter's list loads and the old list is still
  // on screen (dimmed, untappable).
  const [dimmed, setDimmed] = useState(false);

  // VC-80: a newly drawn list starts at the top (after the map, "Try
  // again" or the first load), so the header starts fully open too.
  useEffect(() => {
    scrollY.setValue(0);
  }, [view, state.kind, scrollY]);

  // VC-72 cross-fade: when a new list lands, start it see-through and fade
  // it in over 200 ms, so the swap from skeleton or old list feels soft.
  // Under Reduce Motion (or before the phone answers) it simply appears.
  // A layout effect runs before the new list is drawn, so it never flashes
  // at full strength for one frame before the fade starts.
  useLayoutEffect(() => {
    if (fadeKey === 0) return undefined;
    if (!motionAllowed(reduceMotion)) {
      listOpacity.setValue(1);
      return undefined;
    }
    listOpacity.setValue(0);
    const fade = Animated.timing(listOpacity, {
      toValue: 1,
      duration: LIST_FADE_MS,
      useNativeDriver: true,
    });
    fade.start();
    // If another load lands mid-fade, stop this one and show it fully; the
    // next load starts its own fade.
    return () => {
      fade.stop();
      listOpacity.setValue(1);
    };
    // Only a new list should fade, not a Reduce Motion change mid-way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fadeKey]);

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
      // VC-76: the old list (if one was kept, dimmed) gives way now, and a
      // newly landed list fades in.
      setDimmed(false);
      if (outcome.ok) {
        setFadeKey((n) => n + 1);
        // A new list: forget the night that was at the top, so its first
        // draw never counts as "the person scrolled to a new night" (tick).
        topNight.current = null;
      }
      setState(
        outcome.ok
          ? {
              kind: 'ready',
              events: outcome.events,
              loadedAt: now,
              hasMore: outcome.hasMore === true,
              loadId: seq,
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
   * A new filter was picked: load its events (the effect above does the
   * loading). VC-76: if a list is on screen, keep it there, dimmed and
   * untappable, until the new list lands; otherwise show the skeleton.
   *
   * @param next - the filter picked.
   */
  const chooseFilter = useCallback(
    (next: DateFilter) => {
      // VC-80: the light selection tick on a chip pick.
      tapSelection();
      setFilter(next);
      if (state.kind === 'ready') setDimmed(true);
      else setState({ kind: 'loading' });
      setRefreshError(null);
      // The "where to find your new event" note was about the old filter.
      setCreatedNote(null);
    },
    [state.kind],
  );

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
      // A new list: no day-heading tick for its first draw (see above).
      topNight.current = null;
      setState({
        kind: 'ready',
        events: outcome.events,
        loadedAt: now,
        hasMore: outcome.hasMore === true,
        loadId: seq,
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
    // VC-76: the dimmed list belongs to the old filter; never add to it.
    if (dimmed) return;
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
  }, [state, filter, dimmed]);

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

  /**
   * VC-80: the person pulled the list down. A light tap says "refreshing",
   * then the refresh runs. (Kept apart from `refresh`, which also runs
   * after an admin saves an event, when no tap should happen.)
   */
  const pullToRefresh = useCallback(() => {
    tapLight();
    void refresh();
  }, [refresh]);

  /**
   * VC-80: a light tick when a new night's cards reach the top while the
   * person scrolls (that night's heading is the one sticking). React Native
   * doesn't allow this function to change while the list is on screen, so
   * it keeps what it needs in refs.
   *
   * @param info.viewableItems - the rows on screen, top first.
   */
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ListViewToken[] }) => {
      const top = viewableItems.find((row) => row.isViewable && row.section);
      const night = top ? (top.section as { title: string }).title : null;
      if (night === null || night === topNight.current) return;
      const first = topNight.current === null;
      topNight.current = night;
      // No tick for the first rows drawn, only for the person's own scrolling.
      if (!first && userScrolled.current) tapSelection();
    },
    [],
  );

  /** Opens an event's page, e.g. /event/1234. One function shared by every card. */
  const openEvent = useCallback(
    (id: string) => router.push({ pathname: '/event/[id]', params: { id } }),
    [router],
  );

  // --- VC-76 list speed (spec 3d) -----------------------------------------
  // The night sections, rebuilt only when the list itself changes (before
  // VC-76 they were rebuilt on every draw, which re-drew every card).
  const sections = useMemo(
    () => (state.kind === 'ready' ? groupByDay(state.events, state.loadedAt) : []),
    [state],
  );
  // "Now" for every card, worked out once per draw: the later of the
  // list's load time and the last vibe refresh, so "has it started?" moves
  // on with the minute refresh.
  const loadedAt = state.kind === 'ready' ? state.loadedAt : null;
  const listNow = loadedAt && clock && clock > loadedAt ? clock : (loadedAt ?? NO_LIST);
  // VC-72: the 0.98 press scale, only when motion is allowed. VC-80: the
  // same answer switches the LIVE pulse, carousel motion and header shrink.
  const animatePress = motionAllowed(reduceMotion);
  // VC-80: the hero, the other tonight events and the later nights. The
  // night sections stay as loaded; who is "live" moves on with the clock.
  const layout = useMemo(() => homeLayout(sections, vibes, listNow), [sections, vibes, listNow]);
  // VC-80: whether the filter covers tonight (for the "Nothing on tonight
  // yet" note), worked out from the list's load moment.
  const coversTonight = loadedAt !== null && filterCoversNight(filter, nightOf(loadedAt), loadedAt);

  /** Draws one card. Kept steady so unchanged cards aren't re-drawn. */
  const renderItem = useCallback<SectionListRenderItem<PublicEvent, { title: string }>>(
    ({ item }) => (
      <EventCard
        event={item}
        now={listNow}
        // Only this card's vibe, so a card re-draws only when it changes.
        vibe={vibes[item.id]}
        onPress={openEvent}
        animatePress={animatePress}
      />
    ),
    [listNow, vibes, openEvent, animatePress],
  );

  /** Draws one night's heading ("TONIGHT", "TOMORROW", ...). */
  const renderSectionHeader = useCallback(
    ({ section }: { section: SectionListData<PublicEvent, { title: string }> }) => (
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {section.title.toUpperCase()}
      </Text>
    ),
    [],
  );

  return (
    // SafeAreaView adds padding so content isn't hidden under the iPhone's notch or clock.
    // No bottom edge: the tab bar below takes care of the home-bar space.
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        {/* The kicker line over the title; the List / Map switch on the
            right (VC-79). VC-80: on scroll the kicker fades and the title
            shrinks to 17 px in its place (CollapsingTitle, below). */}
        <View style={styles.titleRow}>
          <CollapsingTitle
            kicker={filterKicker(filter, new Date())}
            title={filterTitle(filter, new Date())}
            scrollY={scrollY}
            collapse={animatePress && view === 'list'}
          />
          <TwoWaySwitch options={VIEW_OPTIONS} value={view} onChange={setView} />
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

      {view === 'map' ? (
        <TonightMap filter={filter} onSeeList={showList} onOpenEvent={openEvent} />
      ) : null}
      {view === 'list' && state.kind === 'loading' ? <ListSkeleton label="Loading events" /> : null}
      {view === 'list' && state.kind === 'error' ? (
        <ErrorState message={state.message} onRetry={retry} />
      ) : null}
      {view === 'list' && state.kind === 'ready' ? (
        // The list's fade-in wrapper (VC-72); testID lets tests read its opacity.
        <Animated.View style={[styles.fill, { opacity: listOpacity }]} testID="tonight-list-fade">
          {/* VC-76: while a new filter loads, the old list stays at 40% and
              ignores touches ("none"), so nothing old can be opened. */}
          <View
            style={[styles.fill, dimmed && styles.dimmed]}
            pointerEvents={dimmed ? 'none' : 'auto'}
            testID="tonight-list-dim"
          >
            <Animated.SectionList
              ref={listRef}
              testID="tonight-list"
              // VC-80: only the later nights are sections; tonight is drawn
              // above them (the hero and carousel, in the list's header).
              sections={layout.later}
              keyExtractor={(event) => event.id}
              renderItem={renderItem}
              renderSectionHeader={renderSectionHeader}
              // VC-76: draw 8 cards first and per batch, keep about 7 screens'
              // worth around the visible part, and (Android only, where it
              // helps most) drop cards far off screen from the drawing.
              initialNumToRender={8}
              maxToRenderPerBatch={8}
              windowSize={7}
              removeClippedSubviews={Platform.OS === 'android'}
              // VC-80: each night's heading sticks to the top while its
              // cards scroll by (it has the page colour behind it).
              stickySectionHeadersEnabled
              ItemSeparatorComponent={Gap}
              ListHeaderComponent={
                <TonightPart
                  layout={layout}
                  vibes={vibes}
                  now={listNow}
                  onOpen={openEvent}
                  animate={animatePress}
                  filterKind={filter.kind}
                  showNothingTonight={coversTonight && layout.later.length > 0}
                  refreshError={refreshError}
                  listId={state.kind === 'ready' ? state.loadId : 0}
                />
              }
              // VC-80: the header shrink follows the scroll on the UI thread.
              onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
                useNativeDriver: true,
              })}
              scrollEventThrottle={16}
              onScrollBeginDrag={() => {
                userScrolled.current = true;
              }}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={DAY_VIEWABILITY}
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
              // The empty card only when there is nothing at all (tonight
              // events with no later nights leave the sections empty too).
              ListEmptyComponent={
                state.events.length === 0 ? (
                  <EmptyState
                    filter={filter}
                    onShowWeek={filter.kind === 'week' ? null : () => chooseFilter(THIS_WEEK)}
                  />
                ) : undefined
              }
              contentContainerStyle={styles.listContent}
              // Pull down to refresh. The spinner is gold to match the theme.
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={pullToRefresh}
                  tintColor={colors.accent}
                  colors={[colors.accent]}
                  progressBackgroundColor={colors.surface}
                />
              }
            />
          </View>
        </Animated.View>
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
 * The header's kicker and title, which shrink as the list scrolls (VC-80).
 *
 * @param props.kicker - the small line ("SATURDAY TO FRIDAY").
 * @param props.title - the big title ("This week").
 * @param props.scrollY - how far the list has scrolled (animated).
 * @param props.collapse - false under Reduce Motion (or on the map): then
 *   nothing moves and the header stays as it is.
 * @returns the two lines. Over the first 30 px of scrolling the kicker
 *   fades out; over the first 60 px the title shrinks from 32 to 17 px and
 *   moves up into the kicker's place. All of it runs on the phone's UI
 *   thread (native driver), and scrolling back to the top undoes it.
 */
function CollapsingTitle({
  kicker,
  title,
  scrollY,
  collapse,
}: {
  kicker: string;
  title: string;
  scrollY: Animated.Value;
  collapse: boolean;
}) {
  // The three moving values, made only when their inputs change.
  const moves = useMemo(() => {
    if (!collapse) return null;
    /** Maps the scroll distance (0 to `to` px) onto a range, held at the ends. */
    const follow = (to: number, range: [number, number]) =>
      scrollY.interpolate({ inputRange: [0, to], outputRange: range, extrapolate: 'clamp' });
    return {
      kickerOpacity: follow(COLLAPSE_DISTANCE / 2, [1, 0]),
      titleScale: follow(COLLAPSE_DISTANCE, [1, SLIM_TITLE_SCALE]),
      titleLift: follow(COLLAPSE_DISTANCE, [0, SLIM_TITLE_LIFT]),
    };
  }, [collapse, scrollY]);

  return (
    <View style={styles.titleBlock}>
      <Animated.Text
        style={[styles.kicker, moves && { opacity: moves.kickerOpacity }]}
        testID="tonight-kicker"
      >
        {kicker}
      </Animated.Text>
      {/* accessibilityRole="header" lets screen readers announce this as a heading.
          Developers only (__DEV__ is false in store builds): a long-press
          on the title sends a test crash report to Sentry (VC-26).
          The shrink is measured from the title's left edge, so it stays
          lined up with the page's left margin. */}
      <Animated.Text
        style={[
          styles.title,
          moves && {
            transformOrigin: 'left center',
            transform: [{ translateY: moves.titleLift }, { scale: moves.titleScale }],
          },
        ]}
        accessibilityRole="header"
        onLongPress={__DEV__ ? confirmTestError : undefined}
        testID="tonight-title"
      >
        {title}
      </Animated.Text>
    </View>
  );
}

/** What the tonight part (the list's header) needs. */
interface TonightPartProps {
  layout: HomeLayout;
  vibes: Record<string, Vibe>;
  now: Date;
  onOpen: (id: string) => void;
  /** false under Reduce Motion. */
  animate: boolean;
  filterKind: DateFilter['kind'];
  /** true to show the "Nothing on tonight yet" note above later nights. */
  showNothingTonight: boolean;
  /** A pull-to-refresh failure message, shown at the very top. */
  refreshError: string | null;
  /** Which list load is on screen (changes on every reload, see ListState). */
  listId: number;
}

/**
 * The top of the list (VC-80): the hero card, the other tonight events (a
 * wide card for one, the carousel for two or more), the "Nothing on tonight
 * yet" note when it applies, and the label over the later nights.
 *
 * @returns the views above the later nights' sections.
 */
function TonightPart({
  layout,
  vibes,
  now,
  onOpen,
  animate,
  filterKind,
  showNothingTonight,
  refreshError,
  listId,
}: TonightPartProps) {
  const { hero, others, later, shape } = layout;
  return (
    <View>
      {refreshError ? (
        <View style={styles.refreshError}>
          <FormMessage message={refreshError} />
        </View>
      ) : null}
      {hero ? (
        <View style={styles.block}>
          <View style={styles.labelRow}>
            {/* The pulsing dot next to "ON FIRE RIGHT NOW" (decoration). */}
            {hero.kind === 'live' ? <LiveDot animate={animate} testID="hero-label-dot" /> : null}
            <Text style={styles.blockLabel} accessibilityRole="header">
              {heroLabel(hero, vibes[hero.event.id])}
            </Text>
          </View>
          <HeroCard
            event={hero.event}
            kind={hero.kind}
            vibe={vibes[hero.event.id]}
            now={now}
            onPress={onOpen}
            animate={animate}
          />
        </View>
      ) : null}
      {shape === 'pair' && others[0] ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel} accessibilityRole="header">
            {othersLabel(1)}
          </Text>
          <ArtCard
            event={others[0]}
            vibe={vibes[others[0].id]}
            now={now}
            onPress={onOpen}
            animate={animate}
            variant="wide"
          />
        </View>
      ) : null}
      {shape === 'carousel' ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel} accessibilityRole="header">
            {othersLabel(others.length)}
          </Text>
          {/* The carousel runs edge to edge, past the list's side margins. */}
          <View style={styles.bleed}>
            {/* `key`: a reloaded list gets a fresh carousel, back at its first
                card and with no remembered "settled" card, so the first
                swipe after a reload can't give a stray tick. */}
            <TonightCarousel
              key={listId}
              events={others}
              vibes={vibes}
              now={now}
              onPress={onOpen}
              animate={animate}
            />
          </View>
        </View>
      ) : null}
      {shape === 'none' && showNothingTonight ? <NothingTonight kind={filterKind} /> : null}
      {shape !== 'none' && later.length > 0 ? (
        <Text style={[styles.blockLabel, styles.laterLabel]} accessibilityRole="header">
          {laterLabel(filterKind)}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The moon note when the filter covers tonight but nothing is on tonight
 * (VC-80 "None tonight: moon card + list"); the later nights follow it.
 *
 * @param props.kind - the filter's kind, for "this week" or "this weekend".
 * @returns a card with the moon, a heading and a sentence.
 */
function NothingTonight({ kind }: { kind: DateFilter['kind'] }) {
  const text = nothingTonightText(kind);
  return (
    <View style={[styles.card, styles.nothingTonight]} testID="nothing-tonight">
      <View style={styles.emptyIcon}>
        <Icon name="moon" size={iconSize.lg} color={colors.muted} />
      </View>
      <Text style={[styles.emptyTitle, styles.centred]} accessibilityRole="header">
        {text.title}
      </Text>
      <Text style={[styles.note, styles.centred]}>{text.body}</Text>
    </View>
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
 * Shown when the first load failed.
 *
 * @param props.message - what went wrong, in plain words.
 * @param props.onRetry - runs the load again.
 * @returns the alert icon in a circle, the sentence (announced) and a
 *   "Try again" button (Q6 icon treatment).
 */
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <StatusPanel tone="error" message={message}>
      <Button label="Try again" variant="outline" onPress={onRetry} />
    </StatusPanel>
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
      {/* A quiet moon (Q4 icon set), centred above the heading as the card's
          focal point (Q6, polish audit); decoration only. */}
      <View style={styles.emptyIcon} testID="empty-moon">
        <Icon name="moon" size={iconSize.lg} color={colors.muted} />
      </View>
      <Text style={[styles.emptyTitle, styles.centred]} accessibilityRole="header">
        {text.title}
      </Text>
      <Text style={[styles.note, styles.centred]}>{text.body}</Text>
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
  // The fade wrapper fills the space under the header, like the list did.
  fill: { flex: 1 },
  // VC-76: the old list while a new filter loads.
  dimmed: { opacity: DIMMED_OPACITY },
  // Q4 spec 2.5: 20 below the safe area (SafeAreaView adds the inset), 16
  // at the sides, 12 below, and a 16 gap between the title and the chips.
  header: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 20,
    paddingBottom: spacing.gap12,
    gap: spacing.md,
  },
  // VC-79: the title on the left, the List / Map switch on the right.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  titleBlock: { flexShrink: 1, gap: spacing.xs },
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
  // VC-80: day headings stick to the top, so they carry the page colour
  // (cards scrolling under them don't show through).
  sectionTitle: {
    ...typography.label,
    color: colors.muted,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.bg,
  },
  // VC-80: one part of the tonight block (a label over a card or carousel).
  block: { paddingTop: spacing.md, gap: spacing.gap10 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  blockLabel: { ...typography.label, color: colors.muted },
  // The "LATER THIS WEEK" label, with room above it.
  laterLabel: { paddingTop: spacing.lg },
  // Lets the carousel run past the list's 16 px side margins.
  bleed: { marginHorizontal: -spacing.gutter },
  // The "Nothing on tonight yet" card sits a little lower.
  nothingTonight: { marginBottom: spacing.sm },
  gap: { height: 14 },
  refreshError: { paddingTop: spacing.sm },
  // The "Load more events" button (and any error) under the last card.
  loadMore: { paddingTop: spacing.md, gap: spacing.sm, alignItems: 'flex-start' },
  card: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: spacing.xs,
    // Q6: everything centred under the moon.
    alignItems: 'center',
  },
  // The moon in a 56 px circle, with a little room below it.
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  centred: { textAlign: 'center' },
  emptyTitle: { ...typography.cardTitle, color: colors.text },
  // The button sits centred, only as wide as its words.
  emptyAction: { flexDirection: 'row', paddingTop: spacing.sm },
  note: { ...typography.bodySm, color: colors.muted },
});
