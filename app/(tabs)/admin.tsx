/**
 * The Admin hub (Q4 "launch look", spec section 2.5): the Admin tab's
 * screen, admins only. It replaces the "New event" and "Reports" pills that
 * used to crowd the Tonight header.
 *
 * It shows two big rows:
 *   - New event: opens /admin/new-event. After saving, the form goes back
 *     here, and Tonight reloads with the new event when the admin next
 *     opens it (VC-63b, unchanged);
 *   - Reports: opens /admin/reports (the heads-up report queue), which leads
 *     to Moderate as before.
 *
 * Who can open it: the tabs layout only creates this screen for admins
 * (Tabs.Protected), so a normal guest has no Admin tab and the "/admin"
 * address sends them to Tonight. Both forms are guarded again in the root
 * layout, and the server refuses every admin action from non-admins.
 *
 * Nothing loads here, so there is no loading or empty state.
 */
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import type { IconName } from '@/components/Icon';
import { colors, iconSize, motion, radius, spacing, typography } from '@/theme';

/** The hub's title (exported so tests use the same words). */
export const ADMIN_TITLE = 'Run the night';

/** One row on the hub: its words, icon and where it goes. */
interface HubRowInfo {
  label: string;
  sub: string;
  icon: IconName;
  href: Href;
}

/** The hub's rows, top to bottom (spec 2.5). */
export const HUB_ROWS: HubRowInfo[] = [
  {
    label: 'New event',
    sub: 'Add an event to the list',
    icon: 'plus-circle',
    href: '/admin/new-event',
  },
  { label: 'Reports', sub: 'Review reported heads-ups', icon: 'flag', href: '/admin/reports' },
];

/**
 * Renders the Admin hub.
 *
 * @returns the screen.
 */
export default function AdminHubScreen() {
  const router = useRouter();
  // Space for the phone's clock and notch at the top (spec: inset + 20).
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}
    >
      <View style={styles.header}>
        <Text style={styles.kicker}>ADMIN</Text>
        <Text style={styles.title} accessibilityRole="header">
          {ADMIN_TITLE}
        </Text>
      </View>
      <View style={styles.rows}>
        {HUB_ROWS.map((row) => (
          <HubRow key={row.label} row={row} onPress={() => router.push(row.href)} />
        ))}
      </View>
    </ScrollView>
  );
}

/**
 * One row card: icon, title and a short line, with an arrow on the right.
 * The whole card is one button, read as e.g. "New event. Add an event to
 * the list."
 *
 * @param props.row - the row's words, icon and address.
 * @param props.onPress - opens the row's screen.
 * @returns the row.
 */
function HubRow({ row, onPress }: { row: HubRowInfo; onPress: () => void }) {
  return (
    // VC-76: shrinks to 0.97 while pressed (not under Reduce Motion).
    <PressableScale
      scaleTo={motion.pressScale.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${row.label}. ${row.sub}.`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Icon name={row.icon} size={iconSize.md} color={colors.accent} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{row.label}</Text>
        <Text style={styles.rowSub}>{row.sub}</Text>
      </View>
      <Icon name="chevron-right" size={iconSize.md} color={colors.muted} />
    </PressableScale>
  );
}

/** Styles built only from theme tokens (sizes from the Q4 spec, 2.5). */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.lg, gap: spacing.lg },
  header: { gap: spacing.xs },
  kicker: { ...typography.label, color: colors.muted },
  title: { ...typography.title, color: colors.text },
  rows: { gap: spacing.gap12 },
  // Surface card, 1 px edge, radius 20, padding 16/18, at least 64 tall.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gap12,
    minHeight: 64,
    paddingVertical: spacing.md,
    paddingHorizontal: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...typography.button, color: colors.text },
  rowSub: { ...typography.bodySm, color: colors.muted },
  pressed: { backgroundColor: colors.surfaceRaised },
});
