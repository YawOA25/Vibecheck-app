/**
 * ESLint settings: ESLint reads our code and flags likely bugs and bad habits
 * (for example, an unused variable or a React hook used the wrong way).
 *
 * - `eslint-config-expo` is Expo's recommended rule set for React Native apps.
 * - `eslint-config-prettier` switches off ESLint's formatting rules, because
 *   Prettier handles formatting. Without it the two tools would argue about
 *   things like quote style. It must come last so it wins.
 * - `ignores` lists folders that are generated or installed, not written by us.
 * - The `no-restricted-syntax` rule below (batch Q1, privacy) refuses any
 *   `supabase.rpc(name, args, options)` call with a third "options" input.
 *   That input is where supabase-js takes `{ get: true }` or `{ head: true }`,
 *   which send the function's inputs in the web ADDRESS (a GET request)
 *   instead of the request body. Addresses are kept in server logs, so a
 *   date of birth sent to complete_profile would end up there. With only
 *   two inputs, supabase-js always sends a POST (proved in
 *   __tests__/rpc-post-only.test.js). The app never needs the third input.
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
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Any `.rpc(...)` call with 3 or more inputs.
          selector: "CallExpression[callee.property.name='rpc'][arguments.length>2]",
          message:
            'Call supabase.rpc(name, args) with two inputs only. A third options input can turn on GET or HEAD, which puts the inputs (e.g. a birthdate) in the URL and server logs. See eslint.config.js.',
        },
      ],
    },
  },
  {
    // supabase/functions/*/index.ts: Edge Function entry files (Deno, with
    // "npm:" imports ESLint can't resolve). Their logic is in handler.ts,
    // which is linted (VC-B13).
    ignores: [
      'node_modules/*',
      '.expo/*',
      'dist/*',
      'coverage/*',
      'expo-env.d.ts',
      'supabase/functions/*/index.ts',
    ],
  },
]);
