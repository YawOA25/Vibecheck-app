/**
 * Event page (task VC-B05), in the v3 look (design/v3/Detail.dc.html).
 *
 * Address: /event/<id>. Opened by tapping a card on the Tonight list.
 *
 * What it shows:
 *   - when (e.g. "TODAY · 9 PM – 2 AM"), the event name and its neighbourhood
 *     label. Never the exact address or a map pin: the app can't even read
 *     them (they live in `event_private`, VC-20);
 *   - chips: "Staff pick" for venue events the team picked (VC-29/VC-14) and
 *     "21+" when set (VC-10);
 *   - our own short summary, if there is one;
 *   - the "Live vibe" card, in its "Early reading" state until scores exist
 *     (task VC-B09);
 *   - the "I'm here" button, which leads to check-in. Check-in is task
 *     VC-B06, so for now it opens a "Check-in coming soon" screen;
 *   - for staff picks with a ticket link: a plain "Get tickets" text link
 *     and "Not affiliated with Eventbrite." (VC-29 and the legal check).
 *
 * Not here on purpose (VC-31): photos, share, "Now playing", clips, the
 * Live / Last 24h switch.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { FormMessage } from '@/components/FormMessage';
import { LiveVibeCard } from '@/components/LiveVibeCard';
import { Tag } from '@/components/Tag';
import { TicketLink } from '@/components/TicketLink';
import { getEvent } from '@/lib/events-read';
import { isStaffPick, timeRange } from '@/lib/tonight';
import type { PublicEvent } from '@/lib/tonight';
import { colors, spacing, typography } from '@/theme';

/** The words of the "not found" state (exported so tests use the same text). */
export const NOT_FOUND_TITLE = 'Event not found';
export const NOT_FOUND_BODY = 'It may have been removed, or the link is wrong.';

/** What the page is showing: loading, a load error, not found, or the event. */
type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'notFound' }
  | { kind: 'ready'; event: PublicEvent; loadedAt: Date };

/**
 * Renders the event page.
 *
 * Returns: the screen's view. Its input is the `id` in the address.
 */
export default function EventScreen() {
  const router = useRouter();
  // The id from the address /event/<id>. expo-router can hand over a list
  // if the address repeats it, so take the first one.
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [state, setState] = useState<PageState>({ kind: 'loading' });
  // Bumped by "Try again" to load once more.
  const [attempt, setAttempt] = useState(0);

  // Load the event when the page opens (and after "Try again"). State is
  // only set when the answer arrives, and a late answer is ignored if the
  // page has closed or the id changed.
  useEffect(() => {
    let active = true;
    const now = new Date();
    const load = id ? getEvent(id) : Promise.resolve({ ok: true as const, event: null });
    load.then((outcome) => {
      if (!active) return;
      if (!outcome.ok) setState({ kind: 'error', message: outcome.message });
      else if (!outcome.event) setState({ kind: 'notFound' });
      else setState({ kind: 'ready', event: outcome.event, loadedAt: now });
    });
    return () => {
      active = false;
    };
  }, [id, attempt]);

  /** "Try again": back to the spinner, then reload. */
  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  /** Back to the list. If the page was opened directly (no history), go home. */
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <BackButton onPress={goBack} />
      </View>

      {state.kind === 'loading' ? (
        <View style={styles.centre} accessible accessibilityLabel="Loading the event">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : null}

      {state.kind === 'error' ? (
        <View style={styles.centre}>
          <FormMessage message={state.message} />
          <Button label="Try again" variant="outline" onPress={retry} />
        </View>
      ) : null}

      {state.kind === 'notFound' ? (
        <View style={styles.centre}>
          <Text style={styles.notFoundTitle} accessibilityRole="header">
            {NOT_FOUND_TITLE}
          </Text>
          <Text style={styles.muted}>{NOT_FOUND_BODY}</Text>
        </View>
      ) : null}

      {state.kind === 'ready' ? (
        <EventDetails
          event={state.event}
          now={state.loadedAt}
          onImHere={() =>
            router.push({ pathname: '/check-in/[id]', params: { id: state.event.id } })
          }
        />
      ) : null}
    </SafeAreaView>
  );
}

/**
 * The page body once the event has loaded.
 *
 * @param props.event - the event's public facts.
 * @param props.now - the moment used for "Today" / "On now".
 * @param props.onImHere - what "I'm here" does (opens check-in).
 * @returns a scrolling view with the details and the buttons at the bottom.
 */
function EventDetails({
  event,
  now,
  onImHere,
}: {
  event: PublicEvent;
  now: Date;
  onImHere: () => void;
}) {
  const staffPick = isStaffPick(event);
  // The ticket link is only for staff picks (VC-29 overrides the plan's "no
  // tickets" for those alone). A host party with a link shows none.
  const ticketUrl = staffPick ? event.ticket_url : null;

  return (
    <>
      {/* ScrollView: everything still fits when the phone's text is large. */}
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text style={styles.kicker}>{timeRange(event, now).toUpperCase()}</Text>
          <Text style={styles.title} accessibilityRole="header">
            {event.title}
          </Text>
          <Text style={styles.area}>{event.area_label}</Text>
        </View>

        {staffPick || event.is_21_plus ? (
          <View style={styles.tags}>
            {staffPick ? <Tag label="Staff pick" tone="gold" /> : null}
            {event.is_21_plus ? <Tag label="21+" /> : null}
          </View>
        ) : null}

        {event.summary ? <Text style={styles.summary}>{event.summary}</Text> : null}

        <LiveVibeCard />
      </ScrollView>

      {/* Bottom bar: the main action, plus the ticket link for staff picks. */}
      <View style={styles.bottomBar}>
        <Button label="I'm here" onPress={onImHere} />
        {ticketUrl ? <TicketLink url={ticketUrl} /> : null}
      </View>
    </>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  content: { padding: spacing.gutter, gap: spacing.gap12 },
  heading: { gap: spacing.xs },
  kicker: { ...typography.label, color: colors.muted },
  title: { ...typography.title, color: colors.text },
  area: { ...typography.bodySm, color: colors.muted },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  summary: { ...typography.body, color: colors.text },
  bottomBar: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.gap12,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  centre: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  notFoundTitle: { ...typography.cardTitle, color: colors.text, textAlign: 'center' },
  muted: { ...typography.bodySm, color: colors.muted, textAlign: 'center' },
});
