/**
 * The "Live vibe" card on the event page (task VC-B09, first drawn in
 * VC-B05), v3 look (design/v3/Detail.dc.html).
 *
 * What it shows:
 *   - the gold "LIVE VIBE" label;
 *   - the meter (src/components/VibeMeter.tsx): the score and its word, or
 *     "Early reading" / "No vibe yet";
 *   - one line under it: "5 people · updated 4 min ago", "Early reading: 3
 *     people so far", "Quiet for 2 hrs · night average 7.4" or "No vibe yet.
 *     Be the first.";
 *   - the headcount, "74 here" (proposal VC-42: a number only, never names);
 *   - the reaction tally, e.g. "🔥 3 · 💃 1", once there are 5+ ratings.
 *
 * How it stays fresh: it loads when the event page comes into view, then asks
 * again every 20 seconds while the page is on screen and the app is open
 * (the plan's polling). It stops when the guest leaves the page or the app
 * goes to the background, so it doesn't use data for nothing. If a refresh
 * fails, the last good reading stays on screen.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';

import { VibeMeter } from '@/components/VibeMeter';
import { VIBE_LOAD_ERROR, VIBE_REFRESH_MS, hereText, reactionLine, vibeDetail } from '@/lib/vibe';
import { getEventVibe } from '@/lib/vibe-api';
import type { Vibe } from '@/lib/vibe';
import { colors, radius, spacing, typography } from '@/theme';

/** What a LiveVibeCard needs. */
export interface LiveVibeCardProps {
  /** The event's id. */
  eventId: string;
  /** true once the event is over, so the headcount says "were here". */
  ended: boolean;
  /** Changing this number loads the vibe again straight away. */
  refreshKey: number;
}

/** What the card is showing: loading, an error (nothing loaded yet), or a vibe. */
type CardState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; vibe: Vibe };

/**
 * Renders the card.
 *
 * @returns the card view.
 */
export function LiveVibeCard({ eventId, ended, refreshKey }: LiveVibeCardProps) {
  const [state, setState] = useState<CardState>({ kind: 'loading' });

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

  return (
    <View style={styles.card}>
      <View style={styles.labelRow}>
        {/* The small gold dot is decoration; the words carry the meaning. */}
        <View style={styles.dot} />
        <Text style={styles.label} accessibilityRole="header">
          LIVE VIBE
        </Text>
      </View>

      {state.kind === 'loading' ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel="Loading the vibe" />
      ) : null}

      {state.kind === 'error' ? <Text style={styles.body}>{VIBE_LOAD_ERROR}</Text> : null}

      {state.kind === 'ready' ? <VibeBody vibe={state.vibe} ended={ended} /> : null}
    </View>
  );
}

/**
 * The card's body once a vibe has loaded.
 *
 * @param props.vibe - the event's vibe.
 * @param props.ended - whether the event is over (for "were here").
 * @returns the meter and the lines under it.
 */
function VibeBody({ vibe, ended }: { vibe: Vibe; ended: boolean }) {
  const here = hereText(vibe.here, ended);
  const reactions = reactionLine(vibe.reactions);
  return (
    <>
      <VibeMeter vibe={vibe} />
      <Text style={styles.body}>{vibeDetail(vibe)}</Text>
      {here ? <Text style={styles.here}>{here}</Text> : null}
      {reactions ? (
        <Text style={styles.body} accessibilityLabel={reactions.spoken}>
          {reactions.text}
        </Text>
      ) : null}
    </>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
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
  labelRow: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  label: { ...typography.label, color: colors.accent },
  body: { ...typography.caption, color: colors.muted, textAlign: 'center' },
  here: { ...typography.bodySm, color: colors.text, textAlign: 'center' },
});
