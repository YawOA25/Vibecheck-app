/**
 * One legal document on screen: the Terms or the Privacy Policy (proposal
 * VC-32b). The words come from src/copy/legal.ts; this only draws them.
 *
 * Layout (v3 look): a Back button, the title, the "Last updated" line, a
 * "Draft" note while the text is still placeholder, then each section's
 * heading and paragraphs in a scrolling page.
 *
 * Reachable signed in (Settings) AND signed out (the sign-in screen), so
 * "Back" falls back to the start screen when there is nothing to go back to
 * (for example after opening the page from a link).
 */
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import type { LegalDocument } from '@/copy/legal';
import { colors, radius, spacing, typography } from '@/theme';

/**
 * Renders a legal document as a full screen.
 *
 * @param props.doc - the document (TERMS or PRIVACY from src/copy/legal.ts).
 * @returns the screen.
 */
export function LegalDocumentView({ doc }: { doc: LegalDocument }) {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <BackButton
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/');
          }}
        />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          {doc.title}
        </Text>
        {doc.updated ? <Text style={styles.muted}>Last updated {doc.updated}</Text> : null}
        {doc.isDraft ? (
          <View style={styles.draft}>
            <Text style={styles.draftLabel}>DRAFT</Text>
            <Text style={styles.body}>
              This is placeholder text. The final version is being written and will replace it
              before launch.
            </Text>
          </View>
        ) : null}
        {doc.sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={styles.heading} accessibilityRole="header">
              {section.heading}
            </Text>
            {section.paragraphs.map((paragraph, i) => (
              <Text key={i} style={styles.body}>
                {paragraph}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Styles built only from theme tokens. */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  content: { padding: spacing.gutter, gap: 18, paddingBottom: spacing.xl },
  title: { ...typography.title, color: colors.text },
  section: { gap: spacing.sm },
  heading: { ...typography.button, color: colors.text },
  body: { ...typography.bodySm, color: colors.text },
  muted: { ...typography.caption, color: colors.muted },
  draft: {
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    borderRadius: radius.card,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  draftLabel: { ...typography.label, color: colors.accent },
});
