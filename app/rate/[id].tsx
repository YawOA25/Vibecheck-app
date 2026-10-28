/**
 * Rating screen (task VC-B08), in the v3 look (design/v3/Rate.dc.html,
 * wireframe S5), with the heads-up tags folded in (proposal VC-43; final
 * nine tags with emoji in VC-45 + VC-57). Picking "Felt unsafe" shows a
 * line pointing to real help (911 or venue staff, VC-60), because the tag
 * itself alerts nobody.
 *
 * Address: /rate/<event id>. Opened by "Rate the night" after a successful
 * check-in, or on the event page once the guest is checked in.
 *
 * What happens, step by step:
 *   1. Load the event's name and the guest's OWN check-in and rating
 *      (src/lib/ratings-api.ts). Then show one of:
 *        - "Check in first" when there's no check-in here;
 *        - "Already rated, update in N minutes" when they saved less than
 *          an hour ago;
 *        - "Admins can't rate" for admins (staff rule, VC-05);
 *        - otherwise the form.
 *   2. The form: three rows (Crowd, Music, Energy), each three chips. The
 *      button switches on after one tap in each row ("Done after 3 taps").
 *      A reaction (pick one) and heads-up tags (pick any) are optional.
 *   3. On "Drop my rating": for a GPS or party-code check-in, quietly take
 *      one location reading, but ONLY if location is already allowed (the
 *      phone's permission question is never shown here), and send it to
 *      check_in to keep "here now" true. If that says "too far" (or
 *      "gps_locked", which is what 5 earlier "too far" answers become),
 *      stop and say so. Any other answer (or no reading: permission not given, no
 *      fix) goes on: the server's 45-minute rule decides.
 *      Party-code guests get the check too since proposal VC-48 (approved
 *      2026-10-27): otherwise anyone who learned the code could rate from
 *      home. A guest who never allowed location is not asked and rates as
 *      before. Tester check-ins still skip it (a tester at home would
 *      always be "too far").
 *   4. Send the rating (submit_rating) and show the result: the payoff
 *      ("You and 4 others have rated ..., your vibe, update after ..."),
 *      or why not (too soon, check in again, outside the window).
 *   5. After a saved rating, offer the next-morning recap note (VC-B12):
 *      this is the moment the phone asks for notification permission. The
 *      payoff then says when the recap arrives, or, if notifications are
 *      off, that it will be under Me. A "no" changes nothing else.
 *
 * Privacy: the quiet reading goes straight from the reader to check_in. It
 * is never put in screen state, shown, or logged (VC-20).
 *
 * Not here on purpose: "What's playing?" genre chips from the v3 mockup
 * (VC-31, not approved yet); "Add a 15s clip" (clips are out of the MVP);
 * the animated meter on the payoff (the live score is task VC-B09).
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { ChoiceChip } from '@/components/ChoiceChip';
import { FormMessage } from '@/components/FormMessage';
import { Headline } from '@/components/Headline';
import { useAuth } from '@/lib/auth-context';
import { submitCheckIn } from '@/lib/check-in-api';
import { readLocationQuietly } from '@/lib/check-in-location';
import { getEvent } from '@/lib/events-read';
import {
  EMPTY_DRAFT,
  FELT_UNSAFE,
  FELT_UNSAFE_HELP,
  HEADS_UP_TAGS,
  RATING_ROWS,
  REACTIONS,
  UPDATE_WAIT_MINUTES,
  isComplete,
  minutesUntilUpdate,
  toggleTag,
} from '@/lib/rating';
import type { RatingDraft, RowValue } from '@/lib/rating';
import { getMyRatingStatus, submitRating } from '@/lib/ratings-api';
import type { MyRatingStatus } from '@/lib/ratings-api';
import { rateResultScreen, tooSoonScreen } from '@/lib/rating-screens';
import type { RateAction, RateScreen } from '@/lib/rating-screens';
import { offerRecapReminder } from '@/lib/recap-notifications';
import type { RecapReminderResult } from '@/lib/recap-notifications';
import type { PublicEvent } from '@/lib/tonight';
import { colors, spacing, typography } from '@/theme';

/** The words on this screen (exported so tests use the same text). */
export const SUBMIT_LABEL = 'Drop my rating';
export const SAVING_LABEL = 'Saving...';
export const PROMPT = "How's it feeling right now?";
export const ONE_PER_EVENT_NOTE =
  'One rating per event. Heading somewhere else tonight? Check in and rate that one too.';
export const NOT_FOUND_TITLE = 'Event not found';

/** What the screen is showing. */
type Phase =
  | { kind: 'loading' }
  | { kind: 'loadError'; message: string }
  | { kind: 'notFound' }
  /** The form. `saving` while the re-check and the save run. */
  | {
      kind: 'form';
      event: PublicEvent;
      method: NonNullable<MyRatingStatus['checkIn']>['method'];
      saving: boolean;
      error: string | null;
    }
  /** A result (payoff or a reason why not). */
  | {
      kind: 'result';
      event: PublicEvent;
      screen: RateScreen;
      /** After a save: what happened with the 11 AM recap note (VC-B12). */
      reminder?: RecapReminderResult;
    };

/**
 * The line under the payoff about the next-morning recap (VC-B12). No
 * score here either; it just says where the recap will be.
 */
const RECAP_REMINDER_TEXT: Record<RecapReminderResult, string> = {
  scheduled: "We'll let you know at 11 AM when your night's recap is ready.",
  denied: 'Notifications are off, so no reminder. Your recap is under Me any time.',
  unavailable: 'Your recap is under Me any time.',
};

/**
 * Renders the rating screen.
 *
 * Returns: the screen's view. Its input is the `id` in the address.
 */
export default function RateScreenRoute() {
  const router = useRouter();
  // Admins can't rate (VC-05). This only picks the message to show; the
  // server refuses admins whatever the app does.
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  // The taps so far. Kept apart from `phase` so a failed save keeps them.
  const [draft, setDraft] = useState<RatingDraft>(EMPTY_DRAFT);
  // Bumped by "Try again" after a load error, to load once more.
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Load the event and the guest's own check-in and rating. State is set
  // only when both answers arrive, and ignored if the screen has closed.
  useEffect(() => {
    let active = true;
    if (!id) {
      Promise.resolve().then(() => active && setPhase({ kind: 'notFound' }));
      return () => {
        active = false;
      };
    }
    Promise.all([getEvent(id), getMyRatingStatus(id)]).then(([eventOutcome, mine]) => {
      if (!active) return;
      if (!eventOutcome.ok) return setPhase({ kind: 'loadError', message: eventOutcome.message });
      const event = eventOutcome.event;
      if (!event) return setPhase({ kind: 'notFound' });
      if (isAdmin) {
        return setPhase({
          kind: 'result',
          event,
          screen: rateResultScreen({ source: 'staff' }, event.title),
        });
      }
      if (!mine.ok) return setPhase({ kind: 'loadError', message: mine.message });
      const { checkIn, ratedAt } = mine.status;
      if (!checkIn) {
        return setPhase({
          kind: 'result',
          event,
          screen: rateResultScreen(
            { source: 'server', result: { status: 'not_checked_in' } },
            event.title,
          ),
        });
      }
      // Rated less than an hour ago: say when they can update, up front.
      const minutesLeft = ratedAt ? minutesUntilUpdate(ratedAt, new Date()) : 0;
      if (ratedAt && minutesLeft > 0) {
        const nextAt = new Date(
          new Date(ratedAt).getTime() + UPDATE_WAIT_MINUTES * 60_000,
        ).toISOString();
        return setPhase({
          kind: 'result',
          event,
          screen: tooSoonScreen(minutesLeft, nextAt, event.title),
        });
      }
      setPhase({ kind: 'form', event, method: checkIn.method, saving: false, error: null });
    });
    return () => {
      active = false;
    };
  }, [id, isAdmin, loadAttempt]);

  /** Back to the event page, or home if there's no history. */
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  /**
   * "Drop my rating": the quiet re-check (GPS and party-code check-ins,
   * only when location is already allowed), then the save.
   *
   * @param form - the form phase being submitted (event and check-in method).
   */
  const submit = useCallback(
    async (form: Extract<Phase, { kind: 'form' }>) => {
      if (!isComplete(draft)) return;
      const { event } = form;
      setPhase({ ...form, saving: true, error: null });

      // GPS and party-code check-ins (VC-48); never tester check-ins.
      if (form.method !== 'tester') {
        const reading = await readLocationQuietly();
        if (reading) {
          // The reading goes straight into the request and is then forgotten.
          const recheck = await submitCheckIn(event.id, reading);
          // 'gps_locked' counts as too far too: each too_far here adds to the
          // server's 5-strike cap, so after 5 the answer turns into
          // gps_locked. Letting that through would let a guest at home rate
          // on the 6th try (cto review of VC-48).
          if (
            recheck.ok &&
            (recheck.result.status === 'too_far' || recheck.result.status === 'gps_locked')
          ) {
            setPhase({
              kind: 'result',
              event,
              screen: rateResultScreen({ source: 'tooFar' }, event.title),
            });
            return;
          }
          // Anything else (passed, weak signal, an hourly limit, a network
          // error): carry on. The server's 45-minute rule decides.
        }
      }

      const outcome = await submitRating(event.id, draft);
      if (outcome.ok) {
        setPhase({
          kind: 'result',
          event,
          screen: rateResultScreen({ source: 'server', result: outcome.result }, event.title),
        });
        // Saved: now (and only now) offer the next-morning recap note. The
        // payoff is already on screen; the answer adds one line under it.
        if (outcome.result.status === 'saved') {
          void offerRecapReminder(event).then((reminder) =>
            setPhase((current) =>
              current.kind === 'result' && current.event.id === event.id
                ? { ...current, reminder }
                : current,
            ),
          );
        }
      } else if (outcome.kind === 'notFound') {
        setPhase({ kind: 'notFound' });
      } else if (outcome.kind === 'staff') {
        setPhase({
          kind: 'result',
          event,
          screen: rateResultScreen({ source: 'staff' }, event.title),
        });
      } else {
        // Keep the taps, show the message under the form, let them retry.
        setPhase({ ...form, saving: false, error: outcome.message });
      }
    },
    [draft],
  );

  /**
   * Carries out a result button.
   *
   * @param action - which button was tapped.
   * @param event - the event on screen.
   */
  const onAction = useCallback(
    (action: RateAction, event: PublicEvent) => {
      if (action === 'checkIn') {
        // Replace this screen, so Back from check-in returns to the event.
        router.replace({ pathname: '/check-in/[id]', params: { id: event.id } });
      } else {
        goBack();
      }
    },
    [goBack, router],
  );

  const saving = phase.kind === 'form' && phase.saving;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <BackButton onPress={goBack} disabled={saving} />
      </View>

      {phase.kind === 'loading' ? (
        <View style={styles.centre} accessible accessibilityLabel="Loading">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : null}

      {phase.kind === 'loadError' ? (
        <View style={styles.centre}>
          <FormMessage message={phase.message} />
          <Button
            label="Try again"
            variant="outline"
            onPress={() => {
              setPhase({ kind: 'loading' });
              setLoadAttempt((n) => n + 1);
            }}
          />
        </View>
      ) : null}

      {phase.kind === 'notFound' ? (
        <View style={styles.centre}>
          <Text style={styles.notFoundTitle} accessibilityRole="header">
            {NOT_FOUND_TITLE}
          </Text>
          <Text style={styles.muted}>It may have been removed, or the link is wrong.</Text>
        </View>
      ) : null}

      {phase.kind === 'form' ? (
        <RatingForm
          phase={phase}
          draft={draft}
          onChange={setDraft}
          onSubmit={() => void submit(phase)}
        />
      ) : null}

      {phase.kind === 'result' ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.label, phase.screen.success && styles.successLabel]}>
            {phase.screen.success ? 'RATED' : phase.event.title.toUpperCase()}
          </Text>
          <Headline lead={phase.screen.lead} highlight={phase.screen.highlight} />
          {/* Read aloud when it appears, so screen-reader users hear the result. */}
          <Text style={styles.body} accessibilityLiveRegion="polite">
            {phase.screen.body}
          </Text>
          {phase.reminder ? (
            <Text style={styles.reminder} accessibilityLiveRegion="polite">
              {RECAP_REMINDER_TEXT[phase.reminder]}
            </Text>
          ) : null}
          {phase.screen.actions.map((button, index) => (
            <Button
              key={button.action}
              label={button.label}
              variant={index === 0 ? 'primary' : 'text'}
              onPress={() => onAction(button.action, phase.event)}
            />
          ))}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

/**
 * The rating form: three rows, the reactions, the heads-up tags and the
 * button.
 *
 * @param props.phase - the form phase (event, saving, error).
 * @param props.draft - the taps so far.
 * @param props.onChange - called with the new draft after a tap.
 * @param props.onSubmit - called by "Drop my rating".
 * @returns a scrolling form.
 */
function RatingForm({
  phase,
  draft,
  onChange,
  onSubmit,
}: {
  phase: Extract<Phase, { kind: 'form' }>;
  draft: RatingDraft;
  onChange: (draft: RatingDraft) => void;
  onSubmit: () => void;
}) {
  const { event, saving, error } = phase;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.checkedInRow}>
        {/* The small gold dot is decoration; the words carry the meaning. */}
        <View style={styles.dot} />
        <Text style={styles.label}>{`${event.title.toUpperCase()} · CHECKED IN`}</Text>
      </View>
      <Headline lead="Spill the" highlight="vibe." />
      <Text style={styles.muted}>{PROMPT}</Text>

      {RATING_ROWS.map((row) => (
        <Group key={row.key} label={row.label}>
          {/* A pick-one row: read as one radio group, e.g. "Crowd, radio
              group", then "Packed, radio button, 3 of 3" (VC-49). */}
          <View
            style={styles.chipRow}
            accessibilityRole="radiogroup"
            accessibilityLabel={row.label.toLowerCase()}
          >
            {row.options.map((option, index) => {
              const value = (index + 1) as RowValue;
              return (
                <ChoiceChip
                  key={option}
                  role="radio"
                  label={option}
                  // e.g. "Crowd: Packed", so the row is clear when heard alone.
                  accessibilityLabel={`${row.label.toLowerCase()}: ${option}`}
                  selected={draft[row.key] === value}
                  disabled={saving}
                  onPress={() => onChange({ ...draft, [row.key]: value })}
                />
              );
            })}
          </View>
        </Group>
      ))}

      <Group label="REACTION" hint="Optional, pick one">
        <View style={styles.wrapRow}>
          {REACTIONS.map((reaction) => (
            <ChoiceChip
              key={reaction.key}
              shape="pill"
              label={`${reaction.emoji} ${reaction.label}`}
              accessibilityLabel={`Reaction: ${reaction.label}`}
              selected={draft.reaction === reaction.key}
              disabled={saving}
              // Tapping the picked reaction again clears it (it's optional).
              onPress={() =>
                onChange({
                  ...draft,
                  reaction: draft.reaction === reaction.key ? null : reaction.key,
                })
              }
            />
          ))}
        </View>
      </Group>

      <Group label="HEADS-UP" hint="Optional, pick any">
        <View style={styles.wrapRow}>
          {HEADS_UP_TAGS.map((tag) => (
            <ChoiceChip
              key={tag.key}
              shape="pill"
              // Emoji then words, e.g. "⏳ Long line" (VC-45); screen readers
              // get the words only.
              label={`${tag.emoji} ${tag.label}`}
              accessibilityLabel={`Heads-up: ${tag.label}`}
              selected={draft.tags.includes(tag.key)}
              disabled={saving}
              onPress={() => onChange({ ...draft, tags: toggleTag(draft.tags, tag.key) })}
            />
          ))}
        </View>
        {/* VC-60: the tag doesn't call for help, so say where help is.
            Read out as soon as it appears. */}
        {draft.tags.includes(FELT_UNSAFE) ? (
          <Text
            style={styles.safetyHelp}
            // "alert" so VoiceOver (iOS) reads it out; the live region does the same on Android.
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {FELT_UNSAFE_HELP}
          </Text>
        ) : null}
      </Group>

      {error ? <FormMessage message={error} /> : null}

      <Button
        label={SUBMIT_LABEL}
        busy={saving}
        busyLabel={SAVING_LABEL}
        disabled={!isComplete(draft)}
        onPress={onSubmit}
      />
      <Text style={styles.note}>{ONE_PER_EVENT_NOTE}</Text>
    </ScrollView>
  );
}

/**
 * A labelled group of chips (e.g. "CROWD" and its three choices).
 *
 * @param props.label - the caps label.
 * @param props.hint - optional small words on the right ("Optional, pick one").
 * @param props.children - the chips.
 * @returns the group view.
 */
function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <Text style={styles.label} accessibilityRole="header">
          {label}
        </Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** Styles built from theme tokens (plus the v3 Rate screen's 20 px sides). */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  content: { paddingHorizontal: 20, paddingVertical: spacing.md, gap: 18 },
  centre: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.authGutter,
  },
  notFoundTitle: { ...typography.h1, color: colors.text, textAlign: 'center' },
  muted: { ...typography.bodySm, color: colors.muted },
  body: { ...typography.body, color: colors.muted },
  // The recap note line under the payoff (VC-B12).
  reminder: { ...typography.bodySm, color: colors.muted },
  checkedInRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  label: { ...typography.label, color: colors.muted, flexShrink: 1 },
  successLabel: { color: colors.success },
  group: { gap: spacing.sm },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  hint: { ...typography.caption, color: colors.muted },
  chipRow: { flexDirection: 'row', gap: spacing.sm },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  note: { ...typography.caption, color: colors.muted, textAlign: 'center' },
  // Full-strength text (not muted) so the 911 line is easy to read.
  safetyHelp: { ...typography.bodySm, color: colors.text },
});
