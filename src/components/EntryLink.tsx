/**
 * The "How to get in" button for host events (VC-40), with a short
 * disclaimer under it.
 *
 * The legal prep (team/projects/vibecheck/legal/vc40-host-links-2026-10-27.md)
 * sets the rules this follows:
 *   - plain text in our own font and colours, labelled "How to get in":
 *     never a site's name or logo (several sites ban their marks in links),
 *     no preview, and nothing fetched from their page;
 *   - the line "Links go to the host's page. We're not responsible for other
 *     sites." right under it;
 *   - it opens the host's page in the phone's browser (we never show their
 *     page inside our app).
 *
 * Safety: the link is checked again here with the same rule the server uses
 * (src/lib/event-form.ts, isAllowedEntryUrl). The server already refuses
 * anything else, so this is a second lock: if a bad link ever got in, the
 * app shows nothing rather than opening it.
 */
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { FormMessage } from '@/components/FormMessage';
import { isAllowedEntryUrl } from '@/lib/event-form';
import { colors, minTapTarget, motion, spacing, typography } from '@/theme';

/** The words used on screen (exported so tests use the same text). */
export const ENTRY_LINK_LABEL = 'How to get in';
export const ENTRY_DISCLAIMER =
  "Links go to the host's page. We're not responsible for other sites.";

/** What an EntryLink needs. */
export interface EntryLinkProps {
  /** The host's RSVP or invite page (https, on an allowed site). */
  url: string;
}

/**
 * Renders the button and the disclaimer.
 *
 * @returns the button, or nothing if the link fails the safety check.
 */
export function EntryLink({ url }: EntryLinkProps) {
  // Shown if the phone can't open the browser (rare: no browser installed).
  const [openError, setOpenError] = useState<string | null>(null);

  if (!isAllowedEntryUrl(url)) return null;
  // Open exactly the text that passed the check (the check ignores spaces
  // at the ends, so remove them here too).
  const safeUrl = url.trim();

  /** Opens the host's page in the phone's browser. */
  const open = () => {
    setOpenError(null);
    Linking.openURL(safeUrl).catch(() => {
      setOpenError("We couldn't open the host's page. Please try again.");
    });
  };

  return (
    <View style={styles.wrapper}>
      <Pressable
        onPress={open}
        // "link" tells screen readers this leaves the app for a web page.
        accessibilityRole="link"
        accessibilityLabel={ENTRY_LINK_LABEL}
        accessibilityHint="Opens the host's page in your browser"
        style={styles.hit}
      >
        {({ pressed }) => (
          <Text style={[styles.link, pressed && styles.linkPressed]}>{ENTRY_LINK_LABEL}</Text>
        )}
      </Pressable>
      <Text style={styles.disclaimer}>{ENTRY_DISCLAIMER}</Text>
      {openError ? <FormMessage message={openError} /> : null}
    </View>
  );
}

/** Styles built only from theme tokens (the same look as TicketLink). */
const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', gap: spacing.xs },
  // A 44 px tall tap area around the words.
  hit: { minHeight: minTapTarget, justifyContent: 'center', paddingHorizontal: spacing.md },
  // Gold and underlined, like every text link in the app.
  link: {
    ...typography.button,
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  // VC-76: every text link fades to 60% while pressed (one rule app-wide).
  linkPressed: { opacity: motion.linkPressedOpacity },
  disclaimer: { ...typography.caption, color: colors.muted, textAlign: 'center' },
});
