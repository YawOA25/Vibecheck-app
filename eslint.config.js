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
 *   Q8a: the rule also closes the ways around that check, where ESLint
 *   could not count the inputs: `supabase['rpc'](...)` (bracket form),
 *   `supabase.rpc.bind/call/apply(...)` (a copy of rpc called later), and
 *   a spread `supabase.rpc(...inputs)` (any number of inputs). The app uses
 *   none of these; write `supabase.rpc(name, args)` instead.
 *
 * Run it with `npm run lint`.
 */
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

/** The one message every rpc rule below shows (so they read the same). */
const RPC_MESSAGE =
  'Call supabase.rpc(name, args) with two inputs only. A third options input can turn on GET or HEAD, which puts the inputs (e.g. a birthdate) in the URL and server logs. See eslint.config.js.';

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
          message: RPC_MESSAGE,
        },
        {
          // Q8a: the bracket form, `supabase['rpc'](...)`, with 3 or more inputs.
          selector:
            "CallExpression[callee.computed=true][callee.property.value='rpc'][arguments.length>2]",
          message: RPC_MESSAGE,
        },
        {
          // Q8a: `supabase.rpc.bind(...)`, `.call(...)` or `.apply(...)`
          // (dot or bracket form): the copy can be called later with any
          // inputs, so it is refused outright.
          selector:
            "MemberExpression[property.name=/^(bind|call|apply)$/][object.property.name='rpc'], MemberExpression[property.name=/^(bind|call|apply)$/][object.property.value='rpc']",
          message: RPC_MESSAGE,
        },
        {
          // Q8a: a spread input, `supabase.rpc(...inputs)` or
          // `supabase['rpc']('name', ...rest)`: it could hold any number of
          // inputs. (A spread INSIDE the args object, `{ ...input }`, is
          // fine: it is still one input.)
          selector:
            "CallExpression[callee.property.name='rpc'] > SpreadElement, CallExpression[callee.property.value='rpc'] > SpreadElement",
          message: RPC_MESSAGE,
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
