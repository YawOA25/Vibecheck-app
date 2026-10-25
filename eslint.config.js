/**
 * ESLint settings: ESLint reads our code and flags likely bugs and bad habits
 * (for example, an unused variable or a React hook used the wrong way).
 *
 * - `eslint-config-expo` is Expo's recommended rule set for React Native apps.
 * - `eslint-config-prettier` switches off ESLint's formatting rules, because
 *   Prettier handles formatting. Without it the two tools would argue about
 *   things like quote style. It must come last so it wins.
 * - `ignores` lists folders that are generated or installed, not written by us.
 *
 * Run it with `npm run lint`.
 */
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    ignores: ['node_modules/*', '.expo/*', 'dist/*', 'coverage/*', 'expo-env.d.ts'],
  },
]);
