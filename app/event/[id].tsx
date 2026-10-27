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
 *   - the "Heads-up" card (VC-43, with VC-B08): quick tags from guests
 *     who are there, with counts and a "+1" (src/components/HeadsUpCard.tsx);
 *   - the "I'm here" button, which opens GPS check-in
 *     (app/check-in/[id].tsx, task VC-B06);
 *   - once the guest is checked in here, "Rate the night" above it, which
 *     opens the rating screen (app/rate/[id].tsx, task VC-B08). Admins
 *     never see it (staff can't rate, VC-05);
 *   - for staff picks with a ticket link: a plain "Get tickets" text link
 *     and "Not affiliated with Eventbrite." (VC-29 and the legal check);
 *   - for host events with a "How to get in" link (VC-40): a plain "How to
 *     get in" text link to the host's RSVP page, with "Links go to the
 *     host's page. We're not responsible for other sites." under it;
 *   - a "Share" button (VC-41) that opens the phone's share sheet with the
 *     event's name, area and time. Never the party code or the pin;
 *   - for admins only, an "Admin" box: "Edit event" (opens
 *     app/admin/edit-event/[id].tsx, VC-34) and "Show party code", which
 *     asks the server for the current code and shows it after the tap
 *     (VC-35). Guests never see this box, and the server refuses both to
 *     non-admins anyway.
 *
 * The page reloads the event each time it comes back into view (for
 * example after "Save changes" on Edit event), so it never shows old
 * details.
 *
 * Not here on purpose (VC-31): photos, "Now playing", clips, the Live /
 * Last 24h switch.
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { EntryLink } from '@/components/EntryLink';
import { FormMessage } from '@/components/FormMessage';
import { HeadsUpCard } from '@/components/HeadsUpCard';
import { LiveVibeCard } from '@/components/LiveVibeCard';
import { PartyCodeCard } from '@/components/PartyCodeCard';
import { Tag } from '@/components/Tag';
import { TicketLink } from '@/components/TicketLink';
import { useAuth } from '@/lib/auth-context';
import { getEventCode } from '@/lib/events-api';
import { getEvent } from '@/lib/events-read';
import { getMyRatingStatus } from '@/lib/ratings-api';
import { buildShareMessage } from '@/lib/share';
import { isStaffPick, timeRange } from '@/lib/tonight';
import type { PublicEvent } from '@/lib/tonight';
import { colors, radius, spacing, typography } from '@/theme';

/** The words of the "not found" state (exported so tests use the same text). */
export const NOT_FOUND_TITLE = 'Event not found';
export const NOT_FOUND_BODY = 'It may have been removed, or the link is wrong.';
export const EDIT_EVENT = 'Edit event';
export const SHOW_CODE = 'Show party code';
export const HIDE_CODE = 'Hide party code';
export const SHARE_LABEL = 'Share';
export const RATE_LABEL = 'Rate the night';

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
  // Admins also get the Admin box (VC-34, VC-35). This only decides what to
  // draw; the server refuses non-admins whatever the app shows.
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  // The id from the address /event/<id>. expo-router can hand over a list
  // if the address repeats it, so take the first one.
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [state, setState] = useState<PageState>({ kind: 'loading' });
  // Whether the guest has a check-in here (VC-B08), which shows "Rate the
  // night". Re-read each time the page comes into view (e.g. after
  // checking in). If the read fails, the button just stays hidden; the
  // rating screen itself would explain anything anyway.
  const [checkedIn, setCheckedIn] = useState(false);
  // Bumped by "Try again" to load once more.
  const [attempt, setAttempt] = useState(0);

  // Load the event when the page comes into view: when it opens, after
  // "Try again", and when the admin comes back from Edit event. State is only
  // set when the answer arrives, and a late answer is ignored if the page has
  // closed, lost focus, or the id changed. If a RE-load fails while the
  // page already shows the event, the page keeps showing it rather than
  // swapping it for an error.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const now = new Date();
      const load = id ? getEvent(id) : Promise.resolve({ ok: true as const, event: null });
      load.then((outcome) => {
        if (!active) return;
        setState((current) => {
          if (!outcome.ok) {
            return current.kind === 'ready' ? current : { kind: 'error', message: outcome.message };
          }
          if (!outcome.event) return { kind: 'notFound' };
          return { kind: 'ready', event: outcome.event, loadedAt: now };
        });
      });
      // The guest's own check-in, read alongside the event.
      if (id) {
        getMyRatingStatus(id).then((mine) => {
          if (active) setCheckedIn(mine.ok && mine.status.checkIn !== null);
        });
      }
      return () => {
        active = false;
      };
      // `attempt` isn't read inside, but it must be listed: "Try again" bumps
      // it, which makes a new callback, which runs the load once more.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, attempt]),
  );

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
          onRate={
            checkedIn && !isAdmin
              ? () => router.push({ pathname: '/rate/[id]', params: { id: state.event.id } })
              : null
          }
          headsUp={
            <HeadsUpCard
              eventId={state.event.id}
              // A new load time (each time the page comes into view) reloads the counts.
              refreshKey={state.loadedAt.getTime()}
              canVote={!isAdmin}
            />
          }
          admin={
            isAdmin ? (
              <AdminTools
                // A fresh box per event, so a code shown for one event is
                // never left on screen for another.
                key={state.event.id}
                eventId={state.event.id}
                onEdit={() =>
                  router.push({
                    pathname: '/admin/edit-event/[id]',
                    params: { id: state.event.id },
                  })
                }
              />
            ) : null
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
 * @param props.onRate - what "Rate the night" does, or null to hide it
 *   (not checked in here, or an admin).
 * @param props.headsUp - the Heads-up card.
 * @param props.admin - the Admin box, or null for everyone but admins.
 * @returns a scrolling view with the details and the buttons at the bottom.
 */
function EventDetails({
  event,
  now,
  onImHere,
  onRate,
  headsUp,
  admin,
}: {
  event: PublicEvent;
  now: Date;
  onImHere: () => void;
  onRate: (() => void) | null;
  headsUp: ReactNode;
  admin: ReactNode;
}) {
  const staffPick = isStaffPick(event);
  // The ticket link is only for staff picks (VC-29 overrides the plan's "no
  // tickets" for those alone). A host party with a link shows none.
  const ticketUrl = staffPick ? event.ticket_url : null;
  // The "How to get in" link is only for host events (VC-40); the server
  // refuses one on a staff pick, and this keeps the app consistent too.
  const entryUrl = staffPick ? null : (event.entry_url ?? null);

  /**
   * Opens the phone's share sheet with the event's public facts (VC-41).
   * buildShareMessage only copies the name, area, state and times, so the
   * party code and the pin can never be shared. If the sheet fails to open
   * (rare), nothing else happens: there is nothing for the guest to fix.
   */
  function share() {
    Share.share({ message: buildShareMessage(event) }).catch(() => {});
  }

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

        <View style={styles.shareRow}>
          <Button label={SHARE_LABEL} variant="outline" size="small" onPress={share} />
        </View>

        {staffPick || event.is_21_plus ? (
          <View style={styles.tags}>
            {staffPick ? <Tag label="Staff pick" tone="gold" /> : null}
            {event.is_21_plus ? <Tag label="21+" /> : null}
          </View>
        ) : null}

        {event.summary ? <Text style={styles.summary}>{event.summary}</Text> : null}

        <LiveVibeCard />

        {headsUp}

        {admin}
      </ScrollView>

      {/* Bottom bar: the main action, plus the ticket link for staff picks
          or the "How to get in" link for host events. */}
      <View style={styles.bottomBar}>
        {/* Checked in: rating is the main action, and "I'm here" stays as an
            outline button for checking in again later. */}
        {onRate ? <Button label={RATE_LABEL} onPress={onRate} /> : null}
        <Button label="I'm here" variant={onRate ? 'outline' : 'primary'} onPress={onImHere} />
        {ticketUrl ? <TicketLink url={ticketUrl} /> : null}
        {entryUrl ? <EntryLink url={entryUrl} /> : null}
      </View>
    </>
  );
}

/** What the Admin box's party-code part is showing. */
type CodeState =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'shown'; code: string }
  | { kind: 'error'; message: string };

/**
 * The Admin box on the event page (admins only): "Edit event" and
 * "Show party code".
 *
 * @param props.eventId - the event's id.
 * @param props.onEdit - opens the Edit event screen.
 * @returns the box view.
 * Why the code is behind a tap: it shouldn't sit on screen where a guest
 * looking over the host's shoulder could read it. It's fetched fresh from
 * the server on every tap (so it's the newest code after a rotation), kept
 * only in this box's memory, and never logged.
 */
function AdminTools({ eventId, onEdit }: { eventId: string; onEdit: () => void }) {
  const [codeState, setCodeState] = useState<CodeState>({ kind: 'hidden' });

  /** Asks the server for the current code and shows it. Returns nothing. */
  async function showCode() {
    setCodeState({ kind: 'loading' });
    const outcome = await getEventCode(eventId);
    setCodeState(
      outcome.ok
        ? { kind: 'shown', code: outcome.code }
        : { kind: 'error', message: outcome.message },
    );
  }

  return (
    <View style={styles.adminBox}>
      <Text style={styles.kicker}>ADMIN</Text>
      <Button label={EDIT_EVENT} variant="outline" size="small" onPress={onEdit} />
      {codeState.kind === 'shown' ? (
        <>
          <PartyCodeCard code={codeState.code} />
          <Button
            label={HIDE_CODE}
            variant="text"
            size="small"
            onPress={() => setCodeState({ kind: 'hidden' })}
          />
        </>
      ) : (
        <Button
          label={SHOW_CODE}
          variant="text"
          size="small"
          busy={codeState.kind === 'loading'}
          busyLabel="Getting the code..."
          onPress={showCode}
        />
      )}
      {codeState.kind === 'error' ? <FormMessage message={codeState.message} /> : null}
    </View>
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
  // Share sits on its own line, at the start, only as wide as its words.
  shareRow: { flexDirection: 'row' },
  summary: { ...typography.body, color: colors.text },
  adminBox: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
  },
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
