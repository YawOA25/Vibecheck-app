/**
 * The "Live vibe" card on the event page (task VC-B09, first drawn in
 * VC-B05), v3 look (design/v3/Detail.dc.html), with the VC-52 arc gauge, the
 * VC-53 breakdown tiles and the VC-54 "Live / All night" switch.
 *
 * What it shows, top to bottom (design/score-visuals-and-tags-spec.md):
 *   - a header row: the label ("LIVE VIBE" with a gold dot, "LAST VIBE"
 *     with a grey dot when quiet, "TONIGHT'S VIBE" in the All night view,
 *     "LAST NIGHT'S VIBE" after 5 AM) and, once there is a score, the
 *     Live / All night switch;
 *   - the gauge (src/components/VibeMeter.tsx): the score and its word, or
 *     "Early reading" / "No vibe yet";
 *   - one line under it: "5 people · updated 4 min ago", "Early reading: 3
 *     people so far", "Quiet for 2 hrs", "No vibe yet. Be the first." or, in
 *     the All night view, "112 ratings tonight";
 *   - the Crowd / Music / Energy tiles (words only), when a score shows;
 *   - the headcount, "74 here" (proposal VC-42: a number only, never names);
 *   - the reaction tally, e.g. "🔥 3 · 💃 1", once there are 5+ ratings.
 *
 * The switch (VC-54): hidden until there's a score; starts on Live every
 * time the page opens (never remembered). "All night" shows the night's
 * vibe WORD and tiles, never a number (cto privacy fix; the night ends 5 AM
 * New York). After that 5 AM, Live means
 * nothing any more, so the switch hides and the night view shows alone.
 * The gauge, word, tiles and line switch together; "N here" and the tally
 * stay the same in both views.
 *
 * How it stays fresh: it loads when the event page comes into view, then asks
 * again every 20 seconds while the page is on screen and the app is open
 * (the plan's polling). It stops when the guest leaves the page or the app
 * goes to the background, so it doesn't use data for nothing. If a refresh
 * fails, the last good reading stays on screen.
 *
 * Smoothness (VC-76, design/vc76-motion-spec.md 2c and 2f): while the
 * first answer loads, the card already holds the space of the lines and
 * tiles under the gauge (two text-line blocks and a row of three tile
 * blocks), so it doesn't grow when the answer lands; the lines then fade in
 * (src/components/FadeIn.tsx). `sweepReady` is passed on to the gauge,
 * which holds its first sweep until the event page has finished sliding in.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { AccessibilityInfo, AppState, StyleSheet, Text, View } from 'react-native';

import { BreakdownTiles, TILE_HEIGHT, TILES_TOP_GAP } from '@/components/BreakdownTiles';
import { FadeIn } from '@/components/FadeIn';
import { SkeletonBlock, SkeletonGroup } from '@/components/Skeleton';
import { TwoWaySwitch } from '@/components/TwoWaySwitch';
import { VibeMeter } from '@/components/VibeMeter';
import {
  VIBE_LOAD_ERROR,
  VIBE_REFRESH_MS,
  hereText,
  meterSpoken,
  nightAsVibe,
  nightDetail,
  reactionLine,
  vibeDetail,
} from '@/lib/vibe';
import { getEventVibe } from '@/lib/vibe-api';
import type { Vibe, VibeView } from '@/lib/vibe';
import { colors, radius, spacing, typography } from '@/theme';

/** What a LiveVibeCard needs. */
export interface LiveVibeCardProps {
  /** The event's id. */
  eventId: string;
  /** true once the event is over, so the headcount says "were here". */
  ended: boolean;
  /** Changing this number loads the vibe again straight away. */
  refreshKey: number;
  /**
   * false holds the gauge's first sweep (VC-76): the event page passes
   * false until its slide-in has finished. Default true (start at once).
   */
  sweepReady?: boolean;
}

/** What the card is showing: loading, an error (nothing loaded yet), or a vibe. */
type CardState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; vibe: Vibe };

/** The switch's two options (VC-54), with what screen readers say. */
const VIEW_OPTIONS = [
  { key: 'live', label: 'Live', spoken: 'Live score' },
  { key: 'night', label: 'All night', spoken: 'All night score' },
] as const;

/** An empty vibe, for drawing the bare gauge while loading or after a failed load. */
const EMPTY_VIBE: Vibe = {
  state: 'none',
  raters: 0,
  here: 0,
  score: null,
  label: null,
  nightAverage: null,
  minutesSinceLast: null,
  reactions: [],
  breakdown: null,
  night: null,
};

/** What the card draws for one answer: which view, and the vibe to draw. */
export interface Shown {
  /** The view on screen (the picked one, unless only one makes sense). */
  view: VibeView;
  /** The vibe the gauge and tiles draw (the night's, in the night view). */
  vibe: Vibe;
  /** Whether the switch is offered. */
  showSwitch: boolean;
  /** The header words. */
  label: string;
  /** The dot before the header: gold, grey, or none. */
  dot: 'gold' | 'grey' | null;
}

/** What the card draws before an answer has arrived (or after a failed first load). */
const SHOWN_BEFORE_LOAD: Shown = {
  view: 'live',
  vibe: EMPTY_VIBE,
  showSwitch: false,
  label: 'LIVE VIBE',
  dot: 'gold',
};

/**
 * Works out what to draw for a vibe and the picked view.
 *
 * @param vibe - the server's answer.
 * @param picked - the option the guest picked on the switch.
 * @returns the view, the vibe to draw, whether the switch shows, and the
 *   header. Rules (spec, section 4): the switch shows only with a score and
 *   a night that isn't over; after 5 AM New York, a night with a word shows
 *   alone ("LAST NIGHT'S VIBE"); otherwise the live view.
 */
export function shownFor(vibe: Vibe, picked: VibeView): Shown {
  const night = vibe.night;
  const hasScore = vibe.state === 'live' || vibe.state === 'stale';
  if (hasScore && night && night.over && night.label !== null) {
    return {
      view: 'night',
      vibe: nightAsVibe(vibe, night),
      showSwitch: false,
      label: "LAST NIGHT'S VIBE",
      dot: null,
    };
  }
  const showSwitch = hasScore && night !== null && !night.over;
  if (showSwitch && picked === 'night' && night) {
    return {
      view: 'night',
      vibe: nightAsVibe(vibe, night),
      showSwitch,
      label: "TONIGHT'S VIBE",
      dot: null,
    };
  }
  const stale = vibe.state === 'stale';
  return {
    view: 'live',
    vibe,
    showSwitch,
    label: stale ? 'LAST VIBE' : 'LIVE VIBE',
    dot: stale ? 'grey' : 'gold',
  };
}

/**
 * Renders the card.
 *
 * @returns the card view.
 */
export function LiveVibeCard({ eventId, ended, refreshKey, sweepReady = true }: LiveVibeCardProps) {
  const [state, setState] = useState<CardState>({ kind: 'loading' });
  // The switch's choice. Starts on Live each time the card (page) opens.
  const [picked, setPicked] = useState<VibeView>('live');

  // Load now, then every 20 seconds while the page is in view. State is only
  // set when an answer arrives, and late answers are ignored once the page
  // has lost focus or the event changed (lesson: avoid stale answers).
  useFocusEffect(
    useCallback(() => {
      let active = true;

      /** Asks the server once and shows the answer. */
      function load() {
        getEventVibe(eventId).then((outcome) => {
          if (!active) return;
          setState((current) => {
            if (outcome.ok) return { kind: 'ready', vibe: outcome.vibe };
            // Keep the last good reading if a refresh fails (weak signal).
            return current.kind === 'ready' ? current : { kind: 'error' };
          });
        });
      }

      load();
      const timer = setInterval(() => {
        // Skip while the app is in the background (not on screen).
        if (AppState.currentState !== 'background') load();
      }, VIBE_REFRESH_MS);
      return () => {
        active = false;
        clearInterval(timer);
      };
      // `refreshKey` isn't read inside, but listing it reloads when it changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eventId, refreshKey]),
  );

  // Worked out only when the answer or the switch changes (VC-76), so the
  // gauge (memoised) gets the same vibe object and isn't re-drawn mid-sweep.
  const shown = useMemo(
    () => (state.kind === 'ready' ? shownFor(state.vibe, picked) : SHOWN_BEFORE_LOAD),
    [state, picked],
  );

  /**
   * Switches the view and tells screen-reader users what the gauge says now.
   *
   * @param next - the newly picked view.
   */
  function pick(next: VibeView) {
    setPicked(next);
    if (state.kind === 'ready') {
      const after = shownFor(state.vibe, next);
      AccessibilityInfo.announceForAccessibility(meterSpoken(after.vibe, after.view));
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.labelRow}>
          {/* The small dot is decoration; the words carry the meaning. */}
          {shown.dot ? <View style={[styles.dot, shown.dot === 'grey' && styles.dotGrey]} /> : null}
          <Text
            style={[styles.label, shown.dot !== 'gold' && styles.labelPlain]}
            accessibilityRole="header"
          >
            {shown.label}
          </Text>
        </View>
        {shown.showSwitch ? (
          <TwoWaySwitch options={VIEW_OPTIONS} value={shown.view} onChange={pick} />
        ) : null}
      </View>

      <VibeMeter
        vibe={shown.vibe}
        view={shown.view}
        loading={state.kind === 'loading'}
        blank={state.kind === 'error'}
        sweepReady={sweepReady}
      />

      {/* VC-76: hold the space of the lines and tiles while loading. */}
      {state.kind === 'loading' ? <LinesSkeleton /> : null}

      {state.kind === 'error' ? <Text style={styles.body}>{VIBE_LOAD_ERROR}</Text> : null}

      {state.kind === 'ready' ? (
        // Fades in once, when the first answer lands; later polls swap the
        // words in place (no fade, no blink).
        <FadeIn style={styles.lines} testID="live-vibe-lines">
          <VibeLines vibe={state.vibe} shown={shown} ended={ended} />
        </FadeIn>
      ) : null}
    </View>
  );
}

/**
 * The lines under the gauge once a vibe has loaded.
 *
 * @param props.vibe - the event's vibe (for "N here" and the tally, the same
 *   in both views).
 * @param props.shown - what the card is drawing (view and its vibe).
 * @param props.ended - whether the event is over (for "were here").
 * @returns the detail line, the tiles, the headcount and the tally.
 */
function VibeLines({ vibe, shown, ended }: { vibe: Vibe; shown: Shown; ended: boolean }) {
  const here = hereText(vibe.here, ended);
  const reactions = reactionLine(vibe.reactions);
  const detail =
    shown.view === 'night' && shown.vibe.night ? nightDetail(shown.vibe.night) : vibeDetail(vibe);
  return (
    <>
      <Text style={styles.body}>{detail}</Text>
      {shown.vibe.breakdown ? (
        <BreakdownTiles breakdown={shown.vibe.breakdown} stale={shown.vibe.state === 'stale'} />
      ) : null}
      {here ? <Text style={styles.here}>{here}</Text> : null}
      {reactions ? (
        <Text style={styles.body} accessibilityLabel={reactions.spoken}>
          {reactions.text}
        </Text>
      ) : null}
    </>
  );
}

/**
 * The space holder under the gauge while the first answer loads (VC-76):
 * two text lines (14 px tall, 70% and 50% wide) and a row of three blocks
 * at the real tile height.
 *
 * @returns the pulsing blocks (screen readers skip them; the gauge already
 *   says "Loading the vibe").
 */
function LinesSkeleton() {
  return (
    <SkeletonGroup style={styles.lines} testID="live-vibe-skeleton">
      <View style={styles.skeletonLines}>
        <SkeletonBlock height={14} width="70%" />
        <SkeletonBlock height={14} width="50%" />
      </View>
      <View style={styles.skeletonTiles}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.skeletonTile}>
            <SkeletonBlock height={TILE_HEIGHT} corner={12} />
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  // The lines under the gauge: full card width, centred, 4 px apart (the
  // card's own gap, so the FadeIn wrapper doesn't change the layout).
  lines: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.xs },
  skeletonLines: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.xs },
  skeletonTiles: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 8,
    marginTop: TILES_TOP_GAP,
  },
  skeletonTile: { flex: 1 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: 14,
    paddingBottom: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  // Label on the left, switch on the right; wraps under large text.
  headerRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  dotGrey: { backgroundColor: colors.muted },
  label: { ...typography.label, color: colors.accent },
  labelPlain: { color: colors.muted },
  body: { ...typography.caption, color: colors.muted, textAlign: 'center' },
  here: { ...typography.bodySm, color: colors.text, textAlign: 'center' },
});
