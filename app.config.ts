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
 * Builds on Expo's servers (EAS Build, task VC-B10) read this file too, plus
 * `eas.json` next to it, which holds the build profiles. The README section
 * "Android test builds with EAS" explains both.
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
    // The app's unique ID on Android (task VC-B10). PROVISIONAL: it is a
    // placeholder until the founder picks the final app name. Once an app is
    // published to Google Play this ID can never change, so pick the real one
    // before the first Play Store upload (internal APKs are fine meanwhile).
    package: 'com.yawoa25.vibecheck',
    // Android permissions Expo's template adds that VibeCheck never uses, so
    // we block them: drawing over other apps (SYSTEM_ALERT_WINDOW) and reading
    // or writing shared files (the two EXTERNAL_STORAGE ones). Fewer
    // permissions means fewer scary install warnings and less to explain to
    // Google Play. The app keeps internet, vibration and location.
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
    adaptiveIcon: {
      backgroundColor: BACKGROUND,
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
  },
  plugins: [
    'expo-router',
    // "Use my current location" on the admin New event screen (VC-B04), and
    // GPS check-in later (VC-B06). Foreground ("while using the app") only:
    // we never track location in the background. The sentence is what
    // iPhone shows in its permission pop-up. (Expo Go uses its own wording;
    // this matters for our own builds from VC-B10.)
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'VibeCheck uses your location to check you in at events and to set where an event is.',
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: BACKGROUND,
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
    // The login is kept in the phone's secure keychain / keystore (batch Q1,
    // src/lib/secure-session-storage.ts). The plugin's default
    // `configureAndroidBackup: true` keeps those encrypted values out of
    // Android's cloud backup: restored on a new phone they couldn't be
    // decrypted anyway (the key never leaves the old phone), so the guest
    // simply signs in again there.
    'expo-secure-store',
  ],
  // EAS (Expo Application Services) builds the app on Expo's servers (task
  // VC-B10). `owner` is the founder's Expo account and `projectId` is the ID
  // Expo gave this app when we ran `eas project:init`. Neither is a secret;
  // they only tell EAS which project a build belongs to.
  owner: 'yawoa25',
  extra: {
    eas: {
      projectId: '27eaa3e9-516c-4a12-91ea-e38cabbed194',
    },
  },
  experiments: {
    // Typed routes make TypeScript warn us if we link to a screen that doesn't exist.
    typedRoutes: true,
  },
};

export default config;
