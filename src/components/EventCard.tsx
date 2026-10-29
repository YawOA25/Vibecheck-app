/**
 * One event on the home list (VC-B05, week view VC-61), in the v3 compact card look: the
 * name and a "where · when" line on the left, the vibe on the right.
 *
 * What it shows: title, neighbourhood label (never an address), when it is
 * ("Today · 10 PM", or "On now · until 2 AM"), a "Staff pick" chip for
 * venue events the team picked (VC-29/VC-14), a "21+" chip when set, a
 * "TEST" chip on test events (VC-63b: only testers and admins ever see
 * those, and the chip makes sure nobody mistakes one for a real party), and
 * the vibe (task VC-B09) on the right:
 *   live   the score and its word, e.g. "8.0 Hot", the word in the same
 *          colour as on the gauge (Q5 fix #6: Quiet grey, Good darker
 *          gold, Hot gold, Fire bright gold);
 *   stale  the last score and word in grey, with "quiet" under it;
 *   early  an "Early" chip with "3 so far" under it (no number before 5
 *          ratings);
 *   none   a "No vibe yet" chip.
 * If the vibes haven't loaded (or failed to), the right side stays empty
 * rather than guessing. The "where · when" line also gets the headcount,
 * "74 here", when anyone has checked in (VC-42: a number only).
 *
 * Once the event has started (and until it ends), a small gold dot and
 * "LIVE" sit at the top of the right side (Q5 fix #6, v3's LIVE pill). It
 * only says the party is on now, which the "On now" line already says, so
 * it is decoration and isn't read out a second time.
 *
 * Before the event starts (VC-61) the card shows the details only: no vibe
 * badge, no LIVE dot and no headcount, even if a vibe was passed in. Reviews only mean
 * something once the night is on, so nothing about ratings can show early.
 *
 * The whole card is one button: tapping anywhere opens the event page.
 *
 * Press feel (VC-72, Q6; shared since VC-76): while a finger is down the
 * card shrinks to 98% over 120 ms and springs back on release, so taps feel
 * answered (src/components/PressableScale.tsx). The screen turns this off
 * (`animatePress` false) under Reduce Motion; the darker pressed background
 * still shows either way.
 *
 * Gold edge (VC-77, polish audit fix #6): a card that is live right now
 * (started, not ended) AND whose live word is Hot or Fire gets the gold
 * `goldBorder` edge instead of the plain grey one, so the hottest parties
 * stand out in the list. It is the same rule as the gauge's glow (VC-70):
 * never for Quiet or Good, a stale (quiet) score, Early, No vibe yet, or an
 * event that hasn't started or has ended. The edge is decoration only: the
 * word itself is already in the card's spoken summary.
 *
 * Speed (VC-76, spec 3d): the card is wrapped in React.memo, so when the
 * home list re-draws (e.g. the minute vibe refresh), only cards whose own
 * inputs changed are re-drawn. For that, `onPress` receives the event's id,
 * so the list can pass one shared function to every card.
 */
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/PressableScale';
import { Tag } from '@/components/Tag';
import { showsGlow, wordColour } from '@/components/VibeMeter';
import { hasStarted, isOnNow, isStaffPick, whenLine } from '@/lib/tonight';
import type { PublicEvent } from '@/lib/tonight';
import { cardVibeSpoken, formatScore, hereText } from '@/lib/vibe';
import type { Vibe } from '@/lib/vibe';
import { colors, fonts, minTapTarget, motion, radius, spacing, typography } from '@/theme';

/** What an EventCard needs. */
export interface EventCardProps {
  event: PublicEvent;
  /** The current moment, for the "Today · 10 PM" line and the has-it-started check. */
  now: Date;
  /**
   * What happens on tap (open the event page). It gets the event's id, so
   * the list can hand every card the same function (VC-76 speed fix).
   */
  onPress: (id: string) => void;
  /** The event's vibe, or undefined while it hasn't loaded. Ignored before the start. */
  vibe?: Vibe;
  /**
   * true to shrink the card a little while pressed (VC-72). The screen
   * passes false under Reduce Motion. Off by default.
   */
  animatePress?: boolean;
}

/** How small a pressed card gets (98%), and how long the change takes (VC-72). */
export const PRESS_SCALE = motion.pressScale.card;
export const PRESS_MS = motion.fast.duration;

/** The chip words for the vibe states without a number (exported for tests). */
export const EARLY_LABEL = 'Early';
export const NO_VIBE_LABEL = 'No vibe yet';
/** The chip on test events (VC-63b), exported for tests. */
export const TEST_LABEL = 'TEST';
/** The word next to the gold dot on a running event (Q5), exported for tests. */
export const LIVE_LABEL = 'LIVE';

/**
 * Whether a card gets the gold edge (VC-77).
 *
 * @param live - true when the event has started and hasn't ended.
 * @param vibe - the card's vibe (undefined when none is shown).
 * @returns true only for a live event whose live score's word is Hot or
 *   Fire (the gauge glow's rule, showsGlow): never for stale, early, none,
 *   not started or ended.
 */
export function showsGoldEdge(live: boolean, vibe: Vibe | undefined): boolean {
  if (!live || !vibe) return false;
  return showsGlow(vibe, vibe.score !== null && vibe.label !== null);
}

/**
 * The one sentence screen readers hear for an event card (shared since
 * VC-80, so the home hero and carousel cards say exactly what a list card
 * says).
 *
 * @param event - the event.
 * @param now - the current moment.
 * @param vibe - the vibe to mention, already dropped (undefined) for an
 *   event that hasn't started.
 * @returns e.g. "Saturday rooftop, Shaw, DC, Today · 10 PM, Staff pick,
 *   74 here, vibe 8.0 out of 10, Hot".
 */
export function eventSpoken(event: PublicEvent, now: Date, vibe: Vibe | undefined): string {
  const here = vibe ? hereText(vibe.here, false) : null;
  return [
    event.title,
    event.is_test ? 'Test event' : null,
    event.area_label,
    whenLine(event, now),
    isStaffPick(event) ? 'Staff pick' : null,
    event.is_21_plus ? '21 and over' : null,
    here,
    vibe ? cardVibeSpoken(vibe) : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Renders the card.
 *
 * @returns a pressable card. Screen readers hear one summary, e.g.
 *   "Saturday rooftop, Shaw, DC, Today · 10 PM, Staff pick, 74 here, vibe
 *   8.0 out of 10, Hot".
 */
function EventCardView({ event, now, onPress, vibe: given, animatePress = false }: EventCardProps) {
  const when = whenLine(event, now);
  // VC-61: before the start, act as if there were no vibe at all, so no
  // score, chip or "here" count can leak onto a not-started card.
  const started = hasStarted(event, now);
  const vibe = started ? given : undefined;
  // LIVE: started and not over yet, by the shared "On now" rule (Q8a).
  // (The list hides ended events anyway; this keeps the card honest if one
  // is ever shown.)
  const live = isOnNow(event, now);
  const staffPick = isStaffPick(event);
  // VC-77: the gold edge for a live Hot or Fire party.
  const goldEdge = showsGoldEdge(live, vibe);
  // "74 here" (VC-42). The list only shows events that haven't ended.
  const here = vibe ? hereText(vibe.here, false) : null;
  // One spoken summary, so screen-reader users don't have to swipe through
  // every small piece of the card.
  const spoken = eventSpoken(event, now, vibe);

  return (
    // The shared shrink-on-press wrapper (VC-76). It is not a button
    // itself, so screen readers still meet exactly one button per card.
    <PressableScale
      outerTestID="event-card-scale"
      scaleTo={PRESS_SCALE}
      animate={animatePress}
      onPress={() => onPress(event.id)}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the event"
      testID="event-card"
      style={({ pressed }) => [styles.card, goldEdge && styles.goldEdge, pressed && styles.pressed]}
    >
      <View style={styles.left}>
        <Text style={styles.title}>{event.title}</Text>
        <Text style={styles.meta}>
          {event.area_label} · {when}
          {here ? ` · ${here}` : ''}
        </Text>
        {staffPick || event.is_21_plus || event.is_test ? (
          <View style={styles.tags}>
            {event.is_test ? <Tag label={TEST_LABEL} tone="gold" /> : null}
            {staffPick ? <Tag label="Staff pick" tone="gold" /> : null}
            {event.is_21_plus ? <Tag label="21+" /> : null}
          </View>
        ) : null}
      </View>
      {live || vibe ? (
        <View style={styles.right}>
          {live ? (
            <View style={styles.liveRow} testID="event-card-live">
              <View style={styles.liveDot} testID="event-card-live-dot" />
              <Text style={styles.liveText}>{LIVE_LABEL}</Text>
            </View>
          ) : null}
          {vibe ? <VibeBadge vibe={vibe} /> : null}
        </View>
      ) : null}
    </PressableScale>
  );
}

/**
 * The card, re-drawn only when its own inputs change (VC-76 speed fix).
 * React.memo compares the props one by one; the home list keeps them
 * steady (one shared onPress, the same vibe object until it changes).
 */
export const EventCard = memo(EventCardView);

/**
 * The vibe on the right of a card (v3: "8.8", or "Early" over "3 so far").
 * Exported for the VC-80 home hero and carousel cards.
 *
 * @param props.vibe - the event's vibe.
 * @param props.align - 'end' (default: right-aligned, as on a list card)
 *   or 'start' (left-aligned, under the text on the VC-80 art cards).
 * @returns the badge view. It isn't read out by itself: the card's spoken
 *   summary already includes the vibe.
 */
export function VibeBadge({ vibe, align = 'end' }: { vibe: Vibe; align?: 'start' | 'end' }) {
  const badgeStyle = [styles.badge, align === 'start' && styles.badgeStart];
  if ((vibe.state === 'live' || vibe.state === 'stale') && vibe.score !== null) {
    const stale = vibe.state === 'stale';
    return (
      <View style={badgeStyle}>
        <View style={styles.scoreRow}>
          <Text style={[styles.score, stale && styles.staleText]}>{formatScore(vibe.score)}</Text>
          {/* The word takes the gauge's colour for it (Q5 fix #6); a stale
              score stays grey, as on the gauge. */}
          <Text
            testID="event-card-word"
            style={[styles.word, { color: wordColour(vibe.label) }, stale && styles.staleText]}
          >
            {vibe.label}
          </Text>
        </View>
        {stale ? <Text style={styles.note}>quiet</Text> : null}
      </View>
    );
  }
  if (vibe.state === 'early') {
    return (
      <View style={badgeStyle}>
        <Tag label={EARLY_LABEL} tone="muted" />
        <Text style={styles.note}>{vibe.raters} so far</Text>
      </View>
    );
  }
  return <Tag label={NO_VIBE_LABEL} tone="muted" />;
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  // v3 compact card: surface, 1 px border, radius 20, padding 14 18.
  card: {
    minHeight: minTapTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.gap12,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  // VC-77: the v3 gold edge (#5A4C30) on a live Hot or Fire card. Decoration only.
  goldEdge: { borderColor: colors.goldBorder },
  pressed: { backgroundColor: colors.surfaceRaised },
  // flexShrink lets long names wrap instead of pushing the chip off screen.
  left: { flex: 1, flexShrink: 1, gap: 5 },
  title: { ...typography.cardTitle, color: colors.text },
  meta: { ...typography.caption, color: colors.muted },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  // The vibe badge, right-aligned (v3: the number over a small note).
  badge: { alignItems: 'flex-end', gap: 2 },
  badgeStart: { alignItems: 'flex-start' },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  score: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 20, color: colors.text },
  // The colour is set per word in VibeBadge (the gauge's ramp).
  word: { fontFamily: fonts.displaySemi, fontSize: 15, lineHeight: 20 },
  // The right side: LIVE on top, the vibe under it, both right-aligned.
  right: { alignItems: 'flex-end', gap: spacing.xs },
  // v3 LIVE pill: a 6 px gold dot, 6 px gap, small bold caps.
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  liveText: { ...typography.label, color: colors.text },
  staleText: { color: colors.muted },
  note: { ...typography.caption, fontSize: 12, lineHeight: 16, color: colors.muted },
});
