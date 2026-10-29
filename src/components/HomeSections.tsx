/**
 * The building blocks of the VC-84 home "Bands" (Direction A,
 * design/vc84-home-sections-spec.md):
 *
 *   - SectionHeader: a section's 21 px title, its count in grey beside it,
 *     a gold special-night tag ("HALLOWEEN") when tonight is one, and a gold
 *     "See all" link on the right where the screen gives one;
 *   - Band: a full-width colour band that holds one section. 'live' is the
 *     surface colour with a 2 px gold line on top, 'picks' the surface colour
 *     with thin edges, 'plain' the page colour;
 *   - DayHeading: one night's heading under "Coming up" ("FRIDAY, OCT 30"
 *     on the left, "2 EVENTS" on the right), gold with the night's tag on a
 *     special night. It sticks to the top while its night scrolls by, so it
 *     carries the page colour behind it (spec: no seams under sticky
 *     headings).
 *
 * Screen readers: each title is a heading that also says its count ("Live
 * now, 3 events"), and "See all" is its own button with a clear name.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Tag } from '@/components/Tag';
import { headingSpoken } from '@/lib/home-sections';
import { colors, fonts, headlineMaxScale, minTapTarget, spacing, typography } from '@/theme';

/** The link's word (exported so tests use the same word). */
export const SEE_ALL_LABEL = 'See all';

/** What a SectionHeader needs. */
export interface SectionHeaderProps {
  /** e.g. "Live now". */
  title: string;
  /** How many events the section shows, or null for no count ("Coming up"). */
  count: number | null;
  /** Tonight's special night name (e.g. "Halloween"), or null. */
  special?: string | null;
  /** What "See all" does, or undefined for no link. */
  onSeeAll?: () => void;
  /** The link's spoken name, e.g. "See all tonight's events". */
  seeAllSpoken?: string;
  /** For tests. */
  testID?: string;
}

/**
 * Renders a section's header row.
 *
 * @returns the title (a heading that says its count), and "See all" when
 *   given. The heading and the link are separate, so the link is a real
 *   button with a 44 px tap area.
 */
export function SectionHeader({
  title,
  count,
  special = null,
  onSeeAll,
  seeAllSpoken,
  testID,
}: SectionHeaderProps) {
  return (
    <View style={styles.headerRow}>
      <View
        style={styles.titleGroup}
        accessible
        accessibilityRole="header"
        accessibilityLabel={headingSpoken(title, count, special)}
        testID={testID}
      >
        <Text style={styles.title} maxFontSizeMultiplier={headlineMaxScale}>
          {title}
        </Text>
        {count !== null ? <Text style={styles.count}>{count}</Text> : null}
        {special ? <Tag label={special.toUpperCase()} tone="feature" /> : null}
      </View>
      {onSeeAll ? (
        <Pressable
          onPress={onSeeAll}
          accessibilityRole="button"
          accessibilityLabel={seeAllSpoken ?? SEE_ALL_LABEL}
          // A 44 px tall touch area around the small word.
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          style={styles.seeAll}
          testID={testID ? `${testID}-see-all` : undefined}
        >
          {({ pressed }) => (
            <Text style={[styles.seeAllText, pressed && styles.seeAllPressed]}>
              {SEE_ALL_LABEL}
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

/** What a Band needs. */
export interface BandProps {
  /**
   * 'live': surface colour with a 2 px gold line on top (Live now);
   * 'picks': surface colour with thin top and bottom edges (Staff picks);
   * 'plain': the page colour (Later tonight, Coming up).
   */
  tone: 'live' | 'picks' | 'plain';
  children: ReactNode;
  /** For tests. */
  testID?: string;
}

/**
 * Renders one full-width band. It reaches past the list's 16 px side
 * margins to the screen's edges and puts the same 16 px back inside, so
 * the cards stay lined up with the rest of the page.
 *
 * @returns the band with its section inside.
 */
export function Band({ tone, children, testID }: BandProps) {
  return (
    <View
      style={[styles.band, tone === 'live' && styles.live, tone === 'picks' && styles.picks]}
      testID={testID}
    >
      {children}
    </View>
  );
}

/** What a DayHeading needs. */
export interface DayHeadingProps {
  /** e.g. "FRIDAY, OCT 30". */
  heading: string;
  /** e.g. "2 EVENTS". */
  countText: string;
  /** What screen readers hear, e.g. "Friday, Oct 30, 2 events". */
  spoken: string;
  /** The special night's name, or null. */
  special: string | null;
}

/**
 * Renders one night's heading under "Coming up".
 *
 * @returns the date on the left (gold, with the night's tag, on a special
 *   night) and the count on the right; one heading for screen readers.
 */
export function DayHeading({ heading, countText, spoken, special }: DayHeadingProps) {
  return (
    <View
      style={styles.dayRow}
      accessible
      accessibilityRole="header"
      accessibilityLabel={spoken}
      testID={special ? 'day-heading-special' : 'day-heading'}
    >
      <View style={styles.dayLeft}>
        <Text style={[styles.dayText, special !== null && styles.daySpecial]}>{heading}</Text>
        {special ? <Tag label={special.toUpperCase()} tone="feature" /> : null}
      </View>
      <Text style={styles.dayText}>{countText}</Text>
    </View>
  );
}

/** Styles built only from theme tokens (sizes from the VC-84 spec and mock). */
const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    // The space between a section's header and its first card.
    paddingBottom: spacing.gap12,
  },
  titleGroup: {
    flexShrink: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  title: { ...typography.section, color: colors.text },
  count: { fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 18, color: colors.muted },
  seeAll: { minHeight: minTapTarget - 24, justifyContent: 'center' },
  seeAllText: { fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 18, color: colors.accent },
  seeAllPressed: { color: colors.accentPressed },
  // Spec rhythm: 22 px above a band's header, 24 px below its last card.
  band: {
    marginHorizontal: -spacing.gutter,
    paddingHorizontal: spacing.gutter,
    paddingTop: 22,
    paddingBottom: spacing.lg,
    backgroundColor: colors.bg,
  },
  live: {
    backgroundColor: colors.surface,
    borderTopWidth: 2,
    borderTopColor: colors.accent,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  picks: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  // A new night gets 20 px above its heading (more than the 14 px between
  // cards, so the break reads as a new night). It sticks, so it carries the
  // page colour.
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingTop: 20,
    paddingBottom: spacing.gap10,
    backgroundColor: colors.bg,
  },
  dayLeft: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dayText: { ...typography.label, color: colors.muted },
  daySpecial: { color: colors.accent },
});
