/**
 * Proves server calls that carry a date of birth go out as POST, with the
 * date in the request body and never in the web address (batch Q1 debt:
 * "a GET request to /rpc in logs could include a birthdate").
 *
 * Why it matters: web addresses (URLs) are written to server and proxy logs;
 * request bodies are not. supabase-js's `rpc()` sends a POST unless it is
 * given a third `{ get: true }` or `{ head: true }` option, which would put
 * the inputs into the address.
 *
 * What it checks, in plain words:
 *   1. The app's own Supabase client (src/lib/supabase.ts, with its real
 *      settings) sends complete_profile as a POST to /rest/v1/rpc/complete_profile;
 *      the address has no query part, and the date is in the body only.
 *   2. Every rpc call in the app's code has two inputs at most, checked by
 *      running the project's own ESLint rule over app/ and src/; and that
 *      rule really does catch `{ get: true }` and `{ head: true }`.
 *   3. The only server function the app sends a birthdate to is
 *      complete_profile (so check 1 covers them all).
 *
 * The network is a fake `fetch`; nothing leaves the PC.
 *
 * Plain JavaScript (not TypeScript) on purpose: it uses Node's file and
 * path tools, and the app's TypeScript settings don't include Node's types.
 */
const fs = require('node:fs');
const path = require('node:path');

// The secure store and AsyncStorage only work on a phone; in-memory fakes
// let the real Supabase client load. (Names start with "mock" because Jest
// only lets those be used inside jest.mock.)
const mockSecure = new Map();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 5,
  getItemAsync: jest.fn(async (k) => mockSecure.get(k) ?? null),
  setItemAsync: jest.fn(async (k, v) => {
    mockSecure.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k) => {
    mockSecure.delete(k);
  }),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const APP_ROOT = path.join(__dirname, '..');

/** Lists every .ts / .tsx file under a folder (the app's own code). */
function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('complete_profile goes out as POST (birthdate in the body only)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('sends POST, no query string, and the date only in the body', async () => {
    const calls = [];
    // A fake network: remember each request and answer "created".
    global.fetch = jest.fn(async (input, init) => {
      calls.push({
        url: String(input instanceof Request ? input.url : input),
        method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
        body: typeof init?.body === 'string' ? init.body : '',
      });
      return new Response(JSON.stringify('created'), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const { supabase } = require('@/lib/supabase');
    // Exactly how app/(auth)/age-gate.tsx calls it.
    const { data, error } = await supabase.rpc('complete_profile', {
      p_display_name: 'Ama',
      p_birthdate: '1990-05-17',
    });

    expect(error).toBeNull();
    expect(data).toBe('created');
    const rpcCalls = calls.filter((c) => c.url.includes('/rpc/'));
    expect(rpcCalls).toHaveLength(1);
    const [call] = rpcCalls;
    expect(call.method).toBe('POST');
    const url = new URL(call.url);
    expect(url.pathname).toBe('/rest/v1/rpc/complete_profile');
    expect(url.search).toBe('');
    expect(call.url).not.toContain('1990');
    expect(JSON.parse(call.body)).toEqual({ p_display_name: 'Ama', p_birthdate: '1990-05-17' });
  });
});

describe('the lint guard: no rpc call may pass GET or HEAD options', () => {
  // Loading ESLint and Expo's rule set takes a few seconds.
  jest.setTimeout(60000);

  /**
   * Runs the project's own ESLint settings (eslint.config.js, loaded once)
   * over some text as if it were the given file.
   * Why ESLint's `Linter` and not its `ESLint` class: the `ESLint` class
   * loads its settings with a dynamic import, which Jest can't run.
   * Inputs: the code, and the file name to pretend it is.
   * Returns: only the messages from our rpc rule.
   */
  let linter;
  let config;
  function lint(code, file = 'src/lib/example.ts') {
    if (!linter || !config) {
      const { Linter } = require('eslint');
      linter = new Linter({ cwd: APP_ROOT, configType: 'flat' });
      config = require('../eslint.config.js');
    }
    return linter
      .verify(code, config, path.join(APP_ROOT, file))
      .filter((m) => m.ruleId === 'no-restricted-syntax');
  }

  it('catches { get: true } and { head: true }', () => {
    const get = lint(
      "declare const supabase: any;\nexport const a = supabase.rpc('complete_profile', { p_birthdate: 'x' }, { get: true });\n",
    );
    const head = lint(
      "declare const supabase: any;\nexport const b = supabase.rpc('get_event_vibe', {}, { head: true });\n",
    );
    expect(get).toHaveLength(1);
    expect(get[0].message).toMatch(/two inputs only/);
    expect(head).toHaveLength(1);
  });

  // Q8a: the ways around the input count ("rpc lint rule misses aliasing").
  it('catches the bracket form with a third input', () => {
    const hits = lint(
      "declare const supabase: any;\nexport const a = supabase['rpc']('complete_profile', {}, { get: true });\n",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toMatch(/two inputs only/);
  });

  it('catches rpc.bind, rpc.call and rpc.apply (dot or bracket form)', () => {
    for (const code of [
      'export const r = supabase.rpc.bind(supabase);',
      "export const r = supabase.rpc.call(supabase, 'x', {});",
      "export const r = supabase.rpc.apply(supabase, ['x', {}, { get: true }]);",
      'export const r = supabase["rpc"].bind(supabase);',
    ]) {
      expect(lint(`declare const supabase: any;\n${code}\n`)).toHaveLength(1);
    }
  });

  it('catches spread inputs, in either form', () => {
    for (const code of [
      'export const r = supabase.rpc(...inputs);',
      "export const r = supabase.rpc('x', ...rest);",
      "export const r = supabase['rpc']('x', ...rest);",
    ]) {
      expect(
        lint(
          `declare const supabase: any;\ndeclare const inputs: any;\ndeclare const rest: any;\n${code}\n`,
        ),
      ).toHaveLength(1);
    }
  });

  it('still allows a spread INSIDE the args object, and the bracket form with two inputs', () => {
    expect(
      lint(
        "declare const supabase: any;\ndeclare const input: any;\nexport const a = supabase.rpc('create_event', { ...input });\nexport const b = supabase['rpc']('x', {});\n",
      ),
    ).toHaveLength(0);
  });

  it('lets a normal two-input call through', () => {
    expect(
      lint(
        "declare const supabase: any;\nexport const c = supabase.rpc('complete_profile', { p_birthdate: 'x' });\n",
      ),
    ).toHaveLength(0);
  });

  it('finds no rpc call with a third input anywhere in app/ or src/', () => {
    const files = [
      ...sourceFiles(path.join(APP_ROOT, 'app')),
      ...sourceFiles(path.join(APP_ROOT, 'src')),
    ];
    const hits = files.flatMap((f) =>
      lint(fs.readFileSync(f, 'utf8'), path.relative(APP_ROOT, f)).map(
        (m) => `${path.relative(APP_ROOT, f)}:${m.line}`,
      ),
    );
    // Make sure the scan really looked at the rpc callers.
    expect(files.some((f) => f.endsWith('age-gate.tsx'))).toBe(true);
    expect(hits).toEqual([]);
  });
});

describe('which server calls carry a birthdate', () => {
  it('only complete_profile is sent a birthdate', () => {
    const files = [
      ...sourceFiles(path.join(APP_ROOT, 'app')),
      ...sourceFiles(path.join(APP_ROOT, 'src')),
    ];
    // Every file that sends a birth date input to the server: a line that
    // starts with a "p_birth..." key (comments that merely mention the name,
    // like the log cleaner in src/lib/sentry.ts, don't count).
    const senders = files.filter((f) => /^\s*p_birth\w*\s*:/im.test(fs.readFileSync(f, 'utf8')));
    expect(senders.map((f) => path.relative(APP_ROOT, f).replace(/\\/g, '/'))).toEqual([
      'app/(auth)/age-gate.tsx',
    ]);
    // ...and that file's only rpc call is complete_profile.
    const ageGate = fs.readFileSync(senders[0], 'utf8');
    expect(ageGate.match(/\.rpc\('([a-z_]+)'/g)).toEqual([".rpc('complete_profile'"]);
  });
});
