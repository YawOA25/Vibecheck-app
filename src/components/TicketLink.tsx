/**
 * The "Get tickets" link for staff picks (VC-29), with the line
 * "Not affiliated with Eventbrite." under it.
 *
 * The legal check (team/projects/vibecheck/legal/eventbrite-terms-2026-10-26.md)
 * sets the rules this follows:
 *   - plain text in our own font and colours: no Eventbrite logo, colours or
 *     button styling (Terms s10.4), and a neutral "Get tickets" label;
 *   - a visible "Not affiliated with Eventbrite." line, so nobody thinks we
 *     are partners;
 *   - it opens the ticket page in the phone's browser (we never show their
 *     page inside our app).
 *
 * Safety: the link is checked again here with the same rule the server uses
 * (https, eventbrite.com only). The server already refuses anything else, so
 * this is a second lock: if a bad link ever got in, the app shows nothing
 * rather than opening it.
 */
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { FormMessage } from '@/components/FormMessage';
import { isAllowedTicketUrl } from '@/lib/event-form';
import { colors, minTapTarget, spacing, typography } from '@/theme';

/** The words used on screen (exported so tests use the same text). */
export const TICKET_LINK_LABEL = 'Get tickets';
export const NOT_AFFILIATED = 'Not affiliated with Eventbrite.';

/** What a TicketLink needs. */
export interface TicketLinkProps {
  /** The event's ticket page (https, on eventbrite.com). */
  url: string;
}

/**
 * Renders the link and the "not affiliated" line.
 *
 * @returns the link, or nothing if the link fails the safety check.
 */
export function TicketLink({ url }: TicketLinkProps) {
  // Shown if the phone can't open the browser (rare: no browser installed).
  const [openError, setOpenError] = useState<string | null>(null);

  if (!isAllowedTicketUrl(url)) return null;
  // Open exactly the text that passed the check (the check ignores spaces at
  // the ends, so we remove them here too).
  const safeUrl = url.trim();

  /** Opens the ticket page in the phone's browser. */
  const open = () => {
    setOpenError(null);
    Linking.openURL(safeUrl).catch(() => {
      setOpenError("We couldn't open the ticket page. Please try again.");
    });
  };

  return (
    <View style={styles.wrapper}>
      <Pressable
        onPress={open}
        // "link" tells screen readers this leaves the app for a web page.
        accessibilityRole="link"
        accessibilityLabel={TICKET_LINK_LABEL}
        accessibilityHint="Opens the ticket page in your browser"
        style={styles.hit}
      >
        {({ pressed }) => (
          <Text style={[styles.link, pressed && styles.linkPressed]}>{TICKET_LINK_LABEL}</Text>
        )}
      </Pressable>
      <Text style={styles.disclaimer}>{NOT_AFFILIATED}</Text>
      {openError ? <FormMessage message={openError} /> : null}
    </View>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', gap: spacing.xs },
  // A 44 px tall tap area around the words (spec section 3, fix 4).
  hit: { minHeight: minTapTarget, justifyContent: 'center', paddingHorizontal: spacing.md },
  // Gold and underlined, like every text link in the app (spec section 3, fix 6).
  link: {
    ...typography.button,
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  linkPressed: { color: colors.accentPressed },
  disclaimer: { ...typography.caption, color: colors.muted, textAlign: 'center' },
});
