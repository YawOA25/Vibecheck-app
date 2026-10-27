/**
 * The "Heads-up" card on the event page (proposal VC-43, folded into task
 * VC-B08): quick tags from guests who are there, such as "Lines are long",
 * each with how many people said it, and a "+1" for checked-in guests.
 *
 * What it does:
 *   - loads the counts from the server (get_event_heads_ups) when the card
 *     appears and whenever `refreshKey` changes (the event page bumps it
 *     each time it comes back into view);
 *   - tapping a tag adds the guest's +1 (add_heads_up). The server decides
 *     whether they may (checked in within 45 minutes, inside the event
 *     window, not an admin); if not, the card says why.
 *   - the counts cover the last 3 hours only (proposal VC-46, done on the
 *     server), so a tag fades out unless people keep +1'ing it; a guest's
 *     own +1 older than that can be added again.
 *
 *   - "Report this tag" (proposal VC-58): anyone who isn't an admin
 *     (checked in or not, so hosts too) can pick one of the shown tags and
 *     report it. Reports go to the admin queue (app/admin/reports.tsx) and
 *     are reviewed within 48 hours. The server limits how many reports one
 *     person can send. Nobody else ever sees who reported. Once the founder
 *     sets VENUE_CONTACT_EMAIL (src/lib/contact.ts), venues and hosts also
 *     see an email address here.
 *
 * Why there's no free text: nothing to moderate (VC-43). Free-text comments
 * are the separate backlog item VC-44. Nobody ever sees WHO added a tag.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ChoiceChip } from '@/components/ChoiceChip';
import { Button } from '@/components/Button';
import { FormMessage } from '@/components/FormMessage';
import { VENUE_CONTACT_EMAIL } from '@/lib/contact';
import { reportHeadsUpTag } from '@/lib/moderation-api';
import type { ReportStatus } from '@/lib/moderation-api';
import { headsUpLabel } from '@/lib/rating';
import type { HeadsUpTag } from '@/lib/rating';
import { addHeadsUp, getEventHeadsUps } from '@/lib/ratings-api';
import type { HeadsUpCount } from '@/lib/ratings-api';
import { headsUpRefusalMessage } from '@/lib/rating-screens';
import { colors, radius, spacing, typography } from '@/theme';

/** The card's words (exported so tests use the same text). */
export const HEADS_UP_TITLE = 'HEADS-UP';
export const NO_HEADS_UPS = 'No heads-ups yet. Guests who are here can add one when they rate.';
export const HEADS_UP_LOAD_ERROR = "We couldn't load the heads-ups.";
export const PLUS_ONE_HINT = 'Here now? Tap a heads-up to +1 it.';
export const REPORT_LINK = 'Report this tag';
export const REPORT_PICK =
  'Which tag is wrong? Our team reviews reports within 48 hours. Nobody else sees who reported.';
export const REPORT_CANCEL = 'Never mind';

/** What the guest sees after reporting, per server answer (VC-58). */
export const REPORT_MESSAGES: Record<ReportStatus, string> = {
  reported: "Thanks. We'll review it within 48 hours.",
  already: "You already reported that tag here. We're on it.",
  too_many: "You've sent a lot of reports today. Please try again tomorrow.",
};

/**
 * The venue and host contact line, or null while no address is set.
 *
 * @param email - the address (VENUE_CONTACT_EMAIL; a parameter so tests can
 *   pass one).
 * @returns e.g. "Venue or host? Email hello@example.com", or null.
 */
export function venueContactLine(email: string): string | null {
  return email.trim() === '' ? null : `Venue or host? Email ${email.trim()}`;
}

/** What a HeadsUpCard needs. */
export interface HeadsUpCardProps {
  /** The event's id. */
  eventId: string;
  /** Changing this number reloads the counts. */
  refreshKey: number;
  /**
   * false for admins: they see the counts but can't +1 (staff rule, VC-05;
   * the server refuses them anyway). Admins also get no "Report this tag"
   * link: they hide or keep tags on the Moderate screen instead.
   */
  canVote: boolean;
  /** The contact address to show (defaults to VENUE_CONTACT_EMAIL; tests override it). */
  contactEmail?: string;
}

/** What the list part is showing. */
type ListState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; tags: HeadsUpCount[] };

/**
 * Renders the card.
 *
 * @returns the card view.
 */
export function HeadsUpCard({
  eventId,
  refreshKey,
  canVote,
  contactEmail = VENUE_CONTACT_EMAIL,
}: HeadsUpCardProps) {
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  // Bumped after a +1 so the counts reload.
  const [reload, setReload] = useState(0);
  // The tag being sent right now (its chip is disabled meanwhile).
  const [sending, setSending] = useState<HeadsUpTag | null>(null);
  // A sentence after a refused or failed +1.
  const [message, setMessage] = useState<string | null>(null);
  // VC-58: whether the "which tag?" list is open, the tag being reported,
  // and the answer to show after a report (error tone when it failed).
  const [reportOpen, setReportOpen] = useState(false);
  const [reporting, setReporting] = useState<HeadsUpTag | null>(null);
  const [reportMessage, setReportMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // Load the counts. State is only set when the answer arrives, and a late
  // answer is ignored if the card has gone or a newer load started.
  useEffect(() => {
    let active = true;
    getEventHeadsUps(eventId).then((outcome) => {
      if (!active) return;
      setList(outcome.ok ? { kind: 'ready', tags: outcome.tags } : { kind: 'error' });
    });
    return () => {
      active = false;
    };
  }, [eventId, refreshKey, reload]);

  /**
   * Sends the guest's +1 for one tag, then reloads the counts.
   *
   * @param tag - the tapped tag.
   */
  const plusOne = useCallback(
    async (tag: HeadsUpTag) => {
      setSending(tag);
      setMessage(null);
      const outcome = await addHeadsUp(eventId, tag);
      setSending(null);
      if (!outcome.ok) {
        setMessage(outcome.message);
      } else if (outcome.result.status === 'added' || outcome.result.status === 'already') {
        setReload((n) => n + 1);
      } else {
        setMessage(headsUpRefusalMessage(outcome.result));
      }
    },
    [eventId],
  );

  /**
   * Reports one tag (VC-58), then closes the list and says what happened.
   *
   * @param tag - the tag the guest says is wrong.
   */
  const report = useCallback(
    async (tag: HeadsUpTag) => {
      setReporting(tag);
      setReportMessage(null);
      const outcome = await reportHeadsUpTag(eventId, tag);
      setReporting(null);
      if (outcome.ok) {
        setReportOpen(false);
        setReportMessage({
          text: REPORT_MESSAGES[outcome.status],
          ok: outcome.status !== 'too_many',
        });
      } else {
        setReportMessage({ text: outcome.message, ok: false });
      }
    },
    [eventId],
  );

  const contactLine = venueContactLine(contactEmail);
  const shownTags = list.kind === 'ready' ? list.tags : [];

  return (
    <View style={styles.card}>
      <Text style={styles.label} accessibilityRole="header">
        {HEADS_UP_TITLE}
      </Text>

      {list.kind === 'loading' ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel="Loading heads-ups" />
      ) : null}

      {list.kind === 'error' ? <Text style={styles.muted}>{HEADS_UP_LOAD_ERROR}</Text> : null}

      {list.kind === 'ready' && list.tags.length === 0 ? (
        <Text style={styles.muted}>{NO_HEADS_UPS}</Text>
      ) : null}

      {list.kind === 'ready' && list.tags.length > 0 ? (
        <>
          <View style={styles.chips}>
            {list.tags.map((item) => {
              // parseHeadsUpList only keeps tags this app knows, so a label exists.
              const label = headsUpLabel(item.tag) ?? item.tag;
              const people = `${item.count} ${item.count === 1 ? 'person' : 'people'}`;
              return (
                <ChoiceChip
                  key={item.tag}
                  shape="pill"
                  label={`${label} · ${item.count}`}
                  // "Lines are long, 3 people, you +1'd this".
                  accessibilityLabel={`${label}, ${people}${item.mine ? ", you +1'd this" : ''}`}
                  accessibilityHint={canVote && !item.mine ? 'Tap to +1' : undefined}
                  // Highlighted (with a check mark) when the guest has +1'd it.
                  selected={item.mine}
                  // Nothing to do on your own +1 (it can't be taken back),
                  // for admins, or while this tag is being sent.
                  disabled={!canVote || item.mine || sending === item.tag}
                  onPress={() => void plusOne(item.tag)}
                />
              );
            })}
          </View>
          {canVote ? <Text style={styles.caption}>{PLUS_ONE_HINT}</Text> : null}
        </>
      ) : null}

      {message ? <FormMessage message={message} /> : null}

      {/* VC-58: report a shown tag (not for admins), and the contact line. */}
      {canVote && shownTags.length > 0 && !reportOpen ? (
        <View style={styles.reportRow}>
          <Button
            label={REPORT_LINK}
            variant="text"
            size="small"
            onPress={() => {
              setReportMessage(null);
              setReportOpen(true);
            }}
          />
        </View>
      ) : null}
      {canVote && reportOpen ? (
        <View style={styles.reportBox}>
          <Text style={styles.caption}>{REPORT_PICK}</Text>
          <View style={styles.chips}>
            {shownTags.map((item) => {
              const label = headsUpLabel(item.tag) ?? item.tag;
              return (
                <Button
                  key={item.tag}
                  label={label}
                  variant="outline"
                  size="small"
                  busy={reporting === item.tag}
                  busyLabel="Sending..."
                  disabled={reporting !== null}
                  onPress={() => void report(item.tag)}
                />
              );
            })}
          </View>
          <Button
            label={REPORT_CANCEL}
            variant="text"
            size="small"
            disabled={reporting !== null}
            onPress={() => setReportOpen(false)}
          />
        </View>
      ) : null}
      {reportMessage ? (
        <FormMessage message={reportMessage.text} tone={reportMessage.ok ? 'success' : 'error'} />
      ) : null}
      {contactLine ? <Text style={styles.caption}>{contactLine}</Text> : null}
    </View>
  );
}

/** Styles built only from theme tokens (the same card look as LiveVibeCard). */
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  label: { ...typography.label, color: colors.muted },
  muted: { ...typography.bodySm, color: colors.muted },
  caption: { ...typography.caption, color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // The report link sits at the start, only as wide as its words.
  reportRow: { flexDirection: 'row' },
  reportBox: { gap: spacing.sm },
});
