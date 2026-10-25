/**
 * Expo app configuration for VibeCheck.
 *
 * What it does: tells Expo the app's name, icon, colors and which built-in
 * plugins to turn on. Expo reads this file when you run `npx expo start` and
 * when we build the app for the stores later.
 *
 * Why a .ts file and not app.json: a TypeScript file can contain comments and,
 * later, read values from environment variables (for example, a Supabase URL
 * from `.env`). app.json can do neither.
 *
 * Returns: an `ExpoConfig` object (Expo's type for this settings object).
 */
import type { ExpoConfig } from 'expo/config';

// The app background color, copied from the theme token `bg` in src/theme.ts.
// It's repeated here because this file is read by Expo's build tools, which run
// before the app code exists, so it can't import from the app.
const BACKGROUND = '#0F0B1A';

const config: ExpoConfig = {
  name: 'VibeCheck',
  slug: 'vibecheck',
  version: '0.0.1',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  // The URL scheme lets links like vibecheck://event/123 open the app.
  // expo-router needs a scheme to handle deep links.
  scheme: 'vibecheck',
  // The design is dark-only (wireframes v1), so we force dark mode. This keeps
  // system UI such as the status bar text light on our dark background.
  userInterfaceStyle: 'dark',
  backgroundColor: BACKGROUND,
  ios: {
    supportsTablet: false,
  },
  android: {
    adaptiveIcon: {
      backgroundColor: BACKGROUND,
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: BACKGROUND,
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
  ],
  experiments: {
    // Typed routes make TypeScript warn us if we link to a screen that doesn't exist.
    typedRoutes: true,
  },
};

export default config;
