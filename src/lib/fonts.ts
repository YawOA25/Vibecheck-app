/**
 * Loads the app's two typefaces (v3 design): Bricolage Grotesque for
 * headlines and Manrope for everything else.
 *
 * Why this file exists: custom fonts are not built into the phone. They ship
 * as files inside the app and must be loaded before text can use them. The
 * root layout calls `useAppFonts()` and keeps the splash screen up until it
 * reports "done".
 *
 * Works in Expo Go: `useFonts` (from expo-font) loads the font files at run
 * time, so no native rebuild is needed.
 *
 * We import each weight from its own sub-folder (for example
 * '@expo-google-fonts/manrope/400Regular') instead of the package's main
 * file. The main file would pull in all 7 weights of each font and make the
 * app bigger; this way only the 6 weights we use are bundled.
 */
import { BricolageGrotesque_600SemiBold } from '@expo-google-fonts/bricolage-grotesque/600SemiBold';
import { BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque/800ExtraBold';
import { Manrope_400Regular } from '@expo-google-fonts/manrope/400Regular';
import { Manrope_500Medium } from '@expo-google-fonts/manrope/500Medium';
import { Manrope_600SemiBold } from '@expo-google-fonts/manrope/600SemiBold';
import { Manrope_700Bold } from '@expo-google-fonts/manrope/700Bold';
import { useFonts } from 'expo-font';

import { fonts } from '@/theme';

/**
 * The font files, keyed by the names the text styles use (see `fonts` in
 * src/theme.ts). The keys must match those names exactly, or text silently
 * falls back to the phone's own font.
 */
export const fontFiles = {
  [fonts.display]: BricolageGrotesque_800ExtraBold,
  [fonts.displaySemi]: BricolageGrotesque_600SemiBold,
  [fonts.body]: Manrope_400Regular,
  [fonts.bodyMedium]: Manrope_500Medium,
  [fonts.bodySemi]: Manrope_600SemiBold,
  [fonts.bodyBold]: Manrope_700Bold,
};

/**
 * Starts loading the fonts and says when the app may draw its screens.
 *
 * @returns true once the fonts have loaded, OR once loading has failed. On a
 *   failure we still go ahead: text then uses the phone's own font, which
 *   looks plainer but works. Better than leaving someone stuck on the splash.
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(fontFiles);
  return loaded || error !== null;
}
