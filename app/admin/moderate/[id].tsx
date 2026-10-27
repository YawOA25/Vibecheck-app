/**
 * The admin "Moderate" screen for one event (proposals VC-47 and VC-58).
 * Address: /admin/moderate/<event id>, optionally with ?title=<event name>.
 *
 * What it shows, top to bottom:
 *   - TAGS: every heads-up tag at the event with its +1 count (all night),
 *     open reports and whether it's hidden. Buttons: "Hide tag", "Unhide
 *     tag", and "Keep tag" when there are open reports (reviewed: it stays);
 *   - PEOPLE: everyone who rated or +1'd here, including people who only
 *     +1'd and never rated, with their account age and check-in method
 *     (brigading signs). Buttons: "Hide rating" / "Unhide rating" and
 *     "Remove +1s" / "Restore +1s" (removal covers the person for the whole
 *     event, so +1s they add later don't count either). Screen readers hear
 *     each button with its guest or tag ("Hide rating, Ava");
 *   - DECISIONS: the newest moderation decisions here, with reasons.
 * Every button asks for a reason from the written rule first
 * (src/components/ModerationAction.tsx). Hiding or unhiding a rating
 * republishes the score on the server straight away.
 *
 * Who can open it: admins only. The app hides the address from everyone
 * else (app/_layout.tsx), and every server function refuses non-admins.
 * Who REPORTED a tag is never shown, not even here.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { FormMessage } from '@/components/FormMessage';
import { ModerationAction } from '@/components/ModerationAction';
import { Tag } from '@/components/Tag';
import { actionLabel, agoText, reasonLabel } from '@/lib/moderation';
import type { ModerationReason } from '@/lib/moderation';
import {
  getEventModeration,
  getEventTags,
  keepTag,
  setHeadsUpsHidden,
  setRatingHidden,
  setTagHidden,
} from '@/lib/moderation-api';
import type {
  ActionStatus,
  EventModeration,
  EventTagState,
  ModeratedPerson,
  ModerationFailure,
} from '@/lib/moderation-api';
import { headsUpLabel } from '@/lib/rating';
import { colors, radius, spacing, typography } from '@/theme';

/** The screen's words (exported so tests use the same text). */
export const SCREEN_TITLE = 'Moderate';
export const NO_TAGS = 'No heads-up tags here yet.';
export const NO_PEOPLE = 'Nobody has rated or +1’d here yet.';
export const NO_DECISIONS = 'No decisions yet.';

/** What the screen is showing. */
type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; tags: EventTagState[]; moderation: EventModeration; loadedAt: Date };

/** An admin action's answer. */
type ActionOutcome = { ok: true; status: ActionStatus } | ModerationFailure;

/**
 * Words for a tag key (falls back to the key for a tag this app doesn't know).
 *
 * @param tag - the tag's key.
 * @returns its label.
 */
function tagWords(tag: string): string {
  return headsUpLabel(tag) ?? tag;
}

/**
 * Renders the screen.
 *
 * @returns the screen's view. Its inputs are the `id` (and optional
 *   `title`) in the address.
 */
export default function ModerateEventScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[]; title?: string | string[] }>();
  // expo-router can hand over a list if the address repeats a value.
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const title = Array.isArray(params.title) ? params.title[0] : params.title;

  const [state, setState] = useState<PageState>({ kind: 'loading' });
  // Bumped after each action (and by "Try again") to load again.
  const [reload, setReload] = useState(0);

  // Load the tags and the people together. State is only set when both
  // answers arrive, and a late answer is ignored if a newer load started.
  useEffect(() => {
    let active = true;
    if (!id) return;
    Promise.all([getEventTags(id), getEventModeration(id)]).then(([tags, moderation]) => {
      if (!active) return;
      if (!tags.ok) setState({ kind: 'error', message: tags.message });
      else if (!moderation.ok) setState({ kind: 'error', message: moderation.message });
      else
        setState({
          kind: 'ready',
          tags: tags.tags,
          moderation: moderation.moderation,
          loadedAt: new Date(),
        });
    });
    return () => {
      active = false;
    };
  }, [id, reload]);

  /**
   * Runs one admin action, then reloads the lists when it worked.
   *
   * @param run - the call to make.
   * @returns null on success, or the sentence to show in the form.
   */
  const act = useCallback(async (run: () => Promise<ActionOutcome>) => {
    const outcome = await run();
    if (!outcome.ok) return outcome.message;
    setReload((n) => n + 1);
    return null;
  }, []);

  /** Back to wherever the admin came from (or home). Returns nothing. */
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <BackButton onPress={goBack} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          {SCREEN_TITLE}
        </Text>
        {title ? <Text style={styles.muted}>{title}</Text> : null}

        {state.kind === 'loading' ? (
          <ActivityIndicator color={colors.accent} accessibilityLabel="Loading" />
        ) : null}

        {state.kind === 'error' ? (
          <View style={styles.gap}>
            <FormMessage message={state.message} />
            <Button
              label="Try again"
              variant="outline"
              onPress={() => {
                setState({ kind: 'loading' });
                setReload((n) => n + 1);
              }}
            />
          </View>
        ) : null}

        {state.kind === 'ready' && id ? (
          <>
            <Text style={styles.kicker} accessibilityRole="header">
              TAGS
            </Text>
            {state.tags.length === 0 ? <Text style={styles.muted}>{NO_TAGS}</Text> : null}
            {state.tags.map((tag) => (
              <TagRow key={tag.tag} eventId={id} tag={tag} act={act} />
            ))}

            <Text style={styles.kicker} accessibilityRole="header">
              PEOPLE
            </Text>
            {state.moderation.people.length === 0 ? (
              <Text style={styles.muted}>{NO_PEOPLE}</Text>
            ) : null}
            {state.moderation.people.map((person) => (
              <PersonRow
                key={person.userId}
                eventId={id}
                person={person}
                now={state.loadedAt}
                act={act}
              />
            ))}

            <Text style={styles.kicker} accessibilityRole="header">
              DECISIONS
            </Text>
            {state.moderation.log.length === 0 ? (
              <Text style={styles.muted}>{NO_DECISIONS}</Text>
            ) : null}
            {state.moderation.log.map((entry, index) => (
              <Text key={`${entry.at}-${index}`} style={styles.logLine}>
                {[
                  actionLabel(entry.action),
                  entry.tag ? tagWords(entry.tag) : entry.targetName,
                  reasonLabel(entry.reason),
                  entry.adminName ? `by ${entry.adminName}` : null,
                  agoText(entry.at, state.loadedAt),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                {entry.note ? `\n“${entry.note}”` : ''}
              </Text>
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** What an action runner looks like (from the screen). */
type Act = (run: () => Promise<ActionOutcome>) => Promise<string | null>;

/**
 * One tag's card: its numbers and its buttons.
 *
 * @param props.eventId - the event.
 * @param props.tag - the tag's state.
 * @param props.act - runs an action and reloads.
 * @returns the card view.
 */
function TagRow({ eventId, tag, act }: { eventId: string; tag: EventTagState; act: Act }) {
  const label = tagWords(tag.tag);
  /**
   * Hides or unhides this tag.
   *
   * @param hidden - true to hide.
   * @returns the action's runner for ModerationAction.
   */
  const toggle = (hidden: boolean) => (reason: ModerationReason, note: string) =>
    act(() => setTagHidden({ eventId, hidden, reason, note }, tag.tag));

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.name}>{label}</Text>
        {tag.hidden ? <Tag label="Hidden" /> : null}
      </View>
      <Text style={styles.muted}>
        {`${tag.votes} ${tag.votes === 1 ? '+1' : '+1s'} tonight · ${tag.openReports} open ${
          tag.openReports === 1 ? 'report' : 'reports'
        }`}
      </Text>
      {tag.hidden ? (
        <ModerationAction
          label="Unhide tag"
          target={label}
          removing={false}
          onConfirm={toggle(false)}
        />
      ) : (
        <ModerationAction label="Hide tag" target={label} removing onConfirm={toggle(true)} />
      )}
      {tag.openReports > 0 && !tag.hidden ? (
        <ModerationAction
          label="Keep tag"
          target={label}
          removing={false}
          onConfirm={(reason, note) =>
            act(() => keepTag({ eventId, hidden: false, reason, note }, tag.tag))
          }
        />
      ) : null}
    </View>
  );
}

/**
 * One person's card: who they are, what they said, and the buttons.
 *
 * @param props.eventId - the event.
 * @param props.person - what they rated and +1'd.
 * @param props.now - the moment the list was loaded (for "joined N d ago").
 * @param props.act - runs an action and reloads.
 * @returns the card view.
 */
function PersonRow({
  eventId,
  person,
  now,
  act,
}: {
  eventId: string;
  person: ModeratedPerson;
  now: Date;
  act: Act;
}) {
  const rating = person.rating;
  // "Remove +1s" covers the person for the whole event (later +1s too), so
  // the button follows the person's flag rather than the single rows.
  const canRemove = person.headsUps.length > 0 && !person.headsUpsRemoved;
  const canRestore = person.headsUpsRemoved;

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.name}>{person.displayName}</Text>
        {rating?.hidden ? <Tag label="Rating hidden" /> : null}
      </View>
      <Text style={styles.muted}>
        {[
          person.joinedAt ? `Joined ${agoText(person.joinedAt, now)}` : null,
          person.checkInMethod ? `checked in by ${person.checkInMethod}` : 'no check-in',
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <Text style={styles.body}>
        {rating
          ? `Crowd ${rating.crowd} · Music ${rating.music} · Energy ${rating.energy} · score ${rating.score.toFixed(1)}`
          : 'No rating (only +1s)'}
      </Text>
      {person.headsUps.length > 0 ? (
        <Text style={styles.body}>
          {person.headsUps
            .map((h) => `${tagWords(h.tag)}${h.removed ? ' (removed)' : ''}`)
            .join(', ')}
        </Text>
      ) : null}

      {rating ? (
        <ModerationAction
          label={rating.hidden ? 'Unhide rating' : 'Hide rating'}
          target={person.displayName}
          removing={!rating.hidden}
          onConfirm={(reason, note) =>
            act(() =>
              setRatingHidden({ eventId, hidden: !rating.hidden, reason, note }, person.userId),
            )
          }
        />
      ) : null}
      {canRemove ? (
        <ModerationAction
          label="Remove +1s"
          target={person.displayName}
          removing
          onConfirm={(reason, note) =>
            act(() => setHeadsUpsHidden({ eventId, hidden: true, reason, note }, person.userId))
          }
        />
      ) : null}
      {canRestore ? (
        <ModerationAction
          label="Restore +1s"
          target={person.displayName}
          removing={false}
          onConfirm={(reason, note) =>
            act(() => setHeadsUpsHidden({ eventId, hidden: false, reason, note }, person.userId))
          }
        />
      ) : null}
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  content: { padding: spacing.gutter, gap: spacing.gap12 },
  gap: { gap: spacing.md },
  title: { ...typography.title, color: colors.text },
  kicker: { ...typography.label, color: colors.muted, marginTop: spacing.sm },
  muted: { ...typography.bodySm, color: colors.muted },
  body: { ...typography.bodySm, color: colors.text },
  name: { ...typography.button, color: colors.text, flexShrink: 1 },
  logLine: { ...typography.caption, color: colors.muted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
