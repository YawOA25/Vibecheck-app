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
 *     (checked in or not, so hosts too) can pick one of the shown tags,
 *     then a short reason ("Not true", "Spam or fake", "Targets a person",
 *     "Offensive" or "Other", VC-65), and report it. Tapping the reason
 *     sends the report. Reports go to the admin queue (app/admin/reports.tsx) and
 *     are reviewed within 48 hours. The server limits how many reports one
 *     person can send. Nobody else ever sees who reported. Once the founder
 *     sets VENUE_CONTACT_EMAIL (src/lib/contact.ts), venues and hosts also
 *     see an email address here.
 *
 *   - which tags appear is decided on the server (VC-67, VC-56, VC-59): no
 *     tag at all until 5 or more guests have rated the event tonight; then
 *     a tag shows once 2 or more guests picked it, and "Felt unsafe" only
 *     at 3+ guests and 10% of tonight's raters, counting tonight only.
 *     Lower counts never reach the app, so this card just shows what it
 *     gets, and the empty text explains both bars.
 *   - "Felt unsafe" (VC-60) is worded as guests' view for that night
 *     ("💬 Felt unsafe · 3 guests tonight", a neutral icon, not a warning
 *     sign). "What are these?" opens a line saying tags are guests'
 *     impressions, not checked or endorsed by us. A guest who +1s "Felt
 *     unsafe" is told where real help is (911 or venue staff).
 *
 * Smoothness (VC-76, design/vc76-motion-spec.md 2c): while the counts load,
 * the card shows one row of three chip-shaped blocks instead of a spinner,
 * and it is never shorter than its one-row ready height, so neither the
 * loaded chips nor "No heads-ups yet" make the page jump. The loaded part
 * fades in once (src/components/FadeIn.tsx); later reloads swap the counts
 * in place.
 *
 * Why there's no free text: nothing to moderate (VC-43). Free-text comments
 * are the separate backlog item VC-44. Nobody ever sees WHO added a tag.
 */
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ChoiceChip } from '@/components/ChoiceChip';
import { Button } from '@/components/Button';
import { FadeIn } from '@/components/FadeIn';
import { HEADS_UP_CARD_HEIGHT, SkeletonBlock, SkeletonGroup } from '@/components/Skeleton';
import { FormMessage } from '@/components/FormMessage';
import { VENUE_CONTACT_EMAIL } from '@/lib/contact';
import { REPORT_REASONS } from '@/lib/moderation';
import type { ReportReason } from '@/lib/moderation';
import { reportHeadsUpTag } from '@/lib/moderation-api';
import type { ReportStatus } from '@/lib/moderation-api';
import {
  FELT_UNSAFE,
  FELT_UNSAFE_HELP,
  HEADS_UP_INFO,
  headsUpChipA11y,
  headsUpChipText,
  headsUpLabel,
} from '@/lib/rating';
import type { HeadsUpTag } from '@/lib/rating';
import { addHeadsUp, getEventHeadsUps } from '@/lib/ratings-api';
import type { HeadsUpCount } from '@/lib/ratings-api';
import { headsUpRefusalMessage } from '@/lib/rating-screens';
import { colors, minTapTarget, radius, spacing, typography } from '@/theme';

/**
 * The card's words (exported so tests use the same text).
 * NO_HEADS_UPS names both server bars (VC-67: 5 raters tonight; VC-56: 2
 * guests per tag), so a guest at a small event knows why the card is empty.
 */
export const HEADS_UP_TITLE = 'HEADS-UP';
export const NO_HEADS_UPS =
  'No heads-ups yet. Tags show here once 5 or more guests have rated tonight and 2 or more of them pick the same tag.';
export const HEADS_UP_LOAD_ERROR = "We couldn't load the heads-ups.";
export const PLUS_ONE_HINT = 'Here now? Tap a heads-up to +1 it.';
export const REPORT_LINK = 'Report this tag';
export const REPORT_PICK =
  'Which tag is wrong? Our team reviews reports within 48 hours. Nobody else sees who reported.';
export const REPORT_CANCEL = 'Never mind';
/** The info tap that explains what tags are (VC-60). */
export const INFO_LINK = 'What are these?';
export const INFO_CLOSE = 'Hide info';

/**
 * The question above the reasons, once a tag is picked (VC-65).
 *
 * @param label - the picked tag's words, e.g. "Overpriced".
 * @returns e.g. 'Why report "Overpriced"? Tap a reason to send.'
 */
export function reportWhy(label: string): string {
  return `Why report "${label}"? Tap a reason to send.`;
}

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
  // VC-58: whether the "which tag?" list is open, the tag picked to report
  // (then the reasons show, VC-65), the reason being sent right now, and
  // the answer to show after a report (error tone when it failed).
  const [reportOpen, setReportOpen] = useState(false);
  const [reportTag, setReportTag] = useState<HeadsUpTag | null>(null);
  const [reporting, setReporting] = useState<ReportReason | null>(null);
  const [reportMessage, setReportMessage] = useState<{ text: string; ok: boolean } | null>(null);
  // VC-60: whether the "what are these?" line is open, and whether to show
  // the 911 line (after this guest +1'd "Felt unsafe").
  const [infoOpen, setInfoOpen] = useState(false);
  const [showSafetyHelp, setShowSafetyHelp] = useState(false);

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
        // VC-60: picking "Felt unsafe" alerts nobody, so point to real help.
        if (tag === FELT_UNSAFE) setShowSafetyHelp(true);
        setReload((n) => n + 1);
      } else {
        setMessage(headsUpRefusalMessage(outcome.result));
      }
    },
    [eventId],
  );

  /**
   * Reports one tag with a reason (VC-58, VC-65), then closes the list and
   * says what happened. On a failure the reasons stay open to try again.
   *
   * @param tag - the tag the guest says is wrong.
   * @param reason - the reason they tapped.
   */
  const report = useCallback(
    async (tag: HeadsUpTag, reason: ReportReason) => {
      setReporting(reason);
      setReportMessage(null);
      const outcome = await reportHeadsUpTag(eventId, tag, reason);
      setReporting(null);
      if (outcome.ok) {
        setReportOpen(false);
        setReportTag(null);
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
    <View style={styles.card} testID="heads-up-card">
      <Text style={styles.label} accessibilityRole="header">
        {HEADS_UP_TITLE}
      </Text>

      {/* VC-76: one row of chip-shaped blocks while loading (no spinner).
          Screen readers hear "Loading heads-ups" once. */}
      {list.kind === 'loading' ? (
        <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading heads-ups">
          <SkeletonGroup style={styles.chips} testID="heads-up-skeleton">
            {SKELETON_CHIP_WIDTHS.map((width) => (
              <SkeletonBlock key={width} height={minTapTarget} width={width} corner={radius.pill} />
            ))}
          </SkeletonGroup>
        </View>
      ) : null}

      {list.kind === 'error' ? <Text style={styles.muted}>{HEADS_UP_LOAD_ERROR}</Text> : null}

      {list.kind === 'ready' && list.tags.length === 0 ? (
        <FadeIn>
          <Text style={styles.muted}>{NO_HEADS_UPS}</Text>
        </FadeIn>
      ) : null}

      {list.kind === 'ready' && list.tags.length > 0 ? (
        <FadeIn style={styles.readyPart} testID="heads-up-ready">
          <View style={styles.chips}>
            {list.tags.map((item) => {
              return (
                <ChoiceChip
                  key={item.tag}
                  shape="pill"
                  // "⏳ Long line · 3", or "💬 Felt unsafe · 3 guests tonight".
                  label={headsUpChipText(item.tag, item.count)}
                  // "Long line, 3 people, you +1'd this" (no emoji).
                  accessibilityLabel={headsUpChipA11y(item.tag, item.count, item.mine)}
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
          {/* VC-60: the info tap. Tags are guests' impressions, not ours. */}
          <View style={styles.reportRow}>
            <Button
              label={infoOpen ? INFO_CLOSE : INFO_LINK}
              variant="text"
              size="small"
              onPress={() => setInfoOpen((open) => !open)}
            />
          </View>
          {infoOpen ? <Text style={styles.caption}>{HEADS_UP_INFO}</Text> : null}
        </FadeIn>
      ) : null}

      {showSafetyHelp ? (
        <Text
          style={styles.safetyHelp}
          // "alert" so VoiceOver (iOS) reads it out; the live region does the same on Android.
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {FELT_UNSAFE_HELP}
        </Text>
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
              setReportTag(null);
              setReportOpen(true);
            }}
          />
        </View>
      ) : null}
      {canVote && reportOpen ? (
        <View style={styles.reportBox}>
          {reportTag === null ? (
            <>
              {/* Step 1: which tag. Picking one shows the reasons. */}
              <Text style={styles.caption}>{REPORT_PICK}</Text>
              <View style={styles.chips}>
                {shownTags.map((item) => (
                  <Button
                    key={item.tag}
                    label={headsUpLabel(item.tag) ?? item.tag}
                    variant="outline"
                    size="small"
                    onPress={() => setReportTag(item.tag)}
                  />
                ))}
              </View>
            </>
          ) : (
            <>
              {/* Step 2 (VC-65): why. Tapping a reason sends the report. */}
              <Text style={styles.caption}>{reportWhy(headsUpLabel(reportTag) ?? reportTag)}</Text>
              <View style={styles.chips}>
                {REPORT_REASONS.map((reason) => (
                  <Button
                    key={reason.key}
                    label={reason.label}
                    variant="outline"
                    size="small"
                    busy={reporting === reason.key}
                    busyLabel="Sending..."
                    disabled={reporting !== null}
                    onPress={() => void report(reportTag, reason.key)}
                  />
                ))}
              </View>
            </>
          )}
          <Button
            label={REPORT_CANCEL}
            variant="text"
            size="small"
            disabled={reporting !== null}
            onPress={() => {
              setReportOpen(false);
              setReportTag(null);
            }}
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

/** Widths of the three loading chip blocks (roughly real tag lengths). */
const SKELETON_CHIP_WIDTHS = [112, 136, 96];

/** Styles built only from theme tokens (the same card look as LiveVibeCard). */
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    // VC-76: never shorter than the one-row ready card, so loading and
    // "No heads-ups yet" take the same space as a row of tags.
    minHeight: HEADS_UP_CARD_HEIGHT,
  },
  // The loaded chips, hint and info link keep the card's 8 px gap.
  readyPart: { gap: spacing.sm },
  label: { ...typography.label, color: colors.muted },
  muted: { ...typography.bodySm, color: colors.muted },
  caption: { ...typography.caption, color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // The report link sits at the start, only as wide as its words.
  reportRow: { flexDirection: 'row' },
  reportBox: { gap: spacing.sm },
  // Full-strength text (not muted) so the 911 line is easy to read.
  safetyHelp: { ...typography.bodySm, color: colors.text },
});
