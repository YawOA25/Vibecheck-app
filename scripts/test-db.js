/**
 * Runs the database tests (pgTAP, in `supabase/tests/database/`) if a database
 * is available, and skips them with a clear message if not.
 *
 * Why this exists: `npm run check` must run the database tests (mvp-plan.md),
 * but they need a real Postgres database to run against. There are two ways
 * to have one:
 *   - MAIN WAY (founder's choice, 2026-10-26): a free Supabase "dev" project
 *     in the cloud, connected once with `npx supabase login` and
 *     `npx supabase link`;
 *   - ALTERNATIVE: a LOCAL database in Docker Desktop, started with
 *     `npx supabase start`. If one is running it is used first, because it is
 *     faster and doesn't touch the shared dev project.
 * This script picks whichever one is available, and otherwise prints what to do.
 *
 * Why the cloud path doesn't use `supabase test db --linked`: that command
 * still needs Docker on the PC (it starts a container to run the test tool,
 * pg_prove), and this PC has no Docker. So for the cloud project this script
 * connects straight to the database with the `pg` package and runs each test
 * file itself, then judges the results (scripts/lib/tap.js).
 *
 * Inputs: none on the command line. Environment variables:
 *   SUPABASE_DB_PASSWORD    -> the dev project's database password. Read from
 *                              the environment first, then from `.env`. Never
 *                              printed.
 *   VIBECHECK_REQUIRE_DB=1  -> treat "no database" as a FAILURE instead of a
 *                              skip (use it for the final review before merge,
 *                              so a skip can't be mistaken for a pass).
 * Returns: exits with code 0 when tests pass or are skipped, and a non-zero
 * code when tests fail (or when skipped while VIBECHECK_REQUIRE_DB=1).
 *
 * Run it with `npm run test:db` (on its own) or as the last step of
 * `npm run check`.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { extractTapLines, judgeTap } = require('./lib/tap');
const { transactionControlProblem } = require('./lib/sql-guard');

// The app folder (one level up from scripts/), where the supabase/ folder lives.
const appDir = path.resolve(__dirname, '..');

// `supabase link` saves the chosen cloud project's id in this file, and the
// address of its "pooler" (Supabase's connection gateway) in pooler-url. Both
// are in supabase/.gitignore, so they never get committed.
const tempDir = path.join(appDir, 'supabase', '.temp');
const linkedProjectFile = path.join(tempDir, 'project-ref');
const poolerUrlFile = path.join(tempDir, 'pooler-url');

// The pgTAP test files, run in name order (001_, 002_, ...).
const testsDir = path.join(appDir, 'supabase', 'tests', 'database');

// Supabase's public root certificate ("Supabase Root 2021 CA"). Supabase's
// database servers present certificates signed by it, but it isn't in the
// normal list of trusted certificates, so without it we would have to switch
// certificate checks off. With it, we can check we're really talking to
// Supabase before sending the password. It's public, not a secret.
// Source: Supabase dashboard > Database settings > SSL certificate (the same
// file is at supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt).
const supabaseCaFile = path.join(appDir, 'supabase', 'certs', 'supabase-root-2021-ca.crt');

/**
 * Runs the Supabase command-line tool (installed in node_modules) with the
 * given arguments.
 *
 * @param {string} args - The arguments, as one string (for example 'status').
 *   They are fixed text written in this file, never user input.
 * @param {boolean} quiet - true hides the tool's output (used for the
 *   "is the local database running?" probe), false shows it.
 * @returns {number} The tool's exit code: 0 means success.
 */
function supabase(args, quiet) {
  // `shell: true` lets Windows find `npx` (it is really `npx.cmd`). We pass a
  // single command string so Node doesn't warn about mixing shell and args.
  // `--no-install` stops npx from downloading anything if the package is missing.
  const result = spawnSync(`npx --no-install supabase ${args}`, {
    cwd: appDir,
    shell: true,
    stdio: quiet ? 'ignore' : 'inherit',
  });
  // `status` is null if the process couldn't start at all; treat that as failure.
  return result.status ?? 1;
}

/**
 * Prints why the database tests were skipped and how to enable them, then
 * exits (0 normally, 1 when VIBECHECK_REQUIRE_DB=1).
 *
 * @param {string} [reason] - Optional extra line saying what exactly is missing.
 * @returns {never} It always ends the program.
 */
function skip(reason) {
  const lines = [
    '',
    '=== Database tests (pgTAP): SKIPPED, no database available ===',
    ...(reason ? [reason] : []),
    'Lint, format, types and app tests above still ran. To run the database',
    'tests too, set up ONE of these (see "Database tests" in README.md):',
    '  Main way: a free Supabase dev project: npx supabase login, then',
    '      npx supabase link --project-ref <your-project-id>',
    '      npx supabase db push',
    '      and put SUPABASE_DB_PASSWORD=<its database password> in .env',
    '  Alternative: Docker Desktop running, then: npx supabase start',
    '',
  ];
  console.log(lines.join('\n'));
  if (process.env.VIBECHECK_REQUIRE_DB === '1') {
    console.error('VIBECHECK_REQUIRE_DB=1 is set, so a skip counts as a failure.');
    process.exit(1);
  }
  process.exit(0);
}

/**
 * Finds the dev project's database password: first in the environment, then
 * in the app's `.env` file (a simple KEY=value reader; quotes are removed).
 *
 * @returns {string|undefined} The password, or undefined if it isn't set.
 *   The caller must never print it.
 */
function readDbPassword() {
  if (process.env.SUPABASE_DB_PASSWORD) return process.env.SUPABASE_DB_PASSWORD;
  const envFile = path.join(appDir, '.env');
  if (!fs.existsSync(envFile)) return undefined;
  const match = /^\s*SUPABASE_DB_PASSWORD\s*=\s*(.*?)\s*$/m.exec(fs.readFileSync(envFile, 'utf8'));
  if (!match || match[1] === '') return undefined;
  // Strip one pair of surrounding quotes, in case the value was written "like this".
  return match[1].replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * Works out where to connect for the linked cloud project.
 *
 * It prefers the pooler address that `supabase link` saved (pooler-url),
 * because Supabase's direct database address (db.<id>.supabase.co) only
 * works over IPv6 on the free plan, and many home and office networks are
 * IPv4 only. Port 5432 on the pooler is "session mode", which behaves like a
 * normal connection, so `set local role` and multi-statement scripts work.
 *
 * @param {string} projectRef - The project id from supabase/.temp/project-ref.
 * @returns {{host: string, port: number, user: string, database: string}}
 */
function connectionTarget(projectRef) {
  if (fs.existsSync(poolerUrlFile)) {
    const url = new URL(fs.readFileSync(poolerUrlFile, 'utf8').trim());
    return {
      host: url.hostname,
      port: Number(url.port || 5432),
      // Pooler usernames are "postgres.<project id>", so the pooler knows
      // which project to route to.
      user: decodeURIComponent(url.username) || `postgres.${projectRef}`,
      database: url.pathname.replace(/^\//, '') || 'postgres',
    };
  }
  // Fallback: the direct address (needs IPv6 on the free plan).
  return {
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    user: 'postgres',
    database: 'postgres',
  };
}

/**
 * Turns a character position in a test file into a line number, so an SQL
 * error can point at the right line.
 *
 * @param {string} text - The full SQL sent to the database.
 * @param {number} position - 1-based character position Postgres reported.
 * @returns {number} The 1-based line number.
 */
function lineAt(text, position) {
  return text.slice(0, Math.max(0, position - 1)).split('\n').length;
}

/**
 * Runs ONE pgTAP test file against the database, inside a transaction that is
 * always rolled back, and judges its output.
 *
 * Why each file gets its own connection: a test file switches roles and
 * settings (`set local role authenticated`, the fake signed-in user). These
 * end with the transaction, but a fresh connection guarantees nothing from one
 * file can leak into the next, even if a file forgets `local`.
 *
 * How "always rolled back" is guaranteed: we open a transaction before the
 * file runs (the file's own `begin;` then just adds a harmless warning), and
 * send `rollback` afterwards whatever happened. Files must not contain
 * `commit` (or a `rollback` before their last line), which would make their
 * test data permanent, so we refuse those before running anything
 * (scripts/lib/sql-guard.js).
 *
 * @param {import('pg').Client} client - A connected database client.
 * @param {string} file - Full path to the .test.sql file.
 * @returns {Promise<{name: string, verdict: ReturnType<typeof judgeTap>|null,
 *   error: string|null}>} `error` is set when the file couldn't run at all
 *   (an SQL error or a forbidden `commit`).
 */
async function runTestFile(client, file) {
  const name = path.basename(file);
  const sql = fs.readFileSync(file, 'utf8');

  // A COMMIT/END, or a ROLLBACK before the end of the file, would save test
  // data for good. Refuse rather than risk dirtying the shared dev project.
  const unsafe = transactionControlProblem(sql);
  if (unsafe) {
    return { name, verdict: null, error: unsafe };
  }

  try {
    await client.query('begin');
    // With no parameters, `pg` sends the whole file as one "simple query", so
    // Postgres runs it statement by statement, and we get back one result per
    // statement. If any statement fails, Postgres stops there and we land in
    // `catch` below.
    const results = await client.query(sql);
    const list = Array.isArray(results) ? results : [results];
    // Each pgTAP select returns rows with one column holding TAP text.
    const values = list.flatMap((r) => r.rows.map((row) => Object.values(row)[0]));
    return { name, verdict: judgeTap(extractTapLines(values)), error: null };
  } catch (err) {
    const where = err.position ? ` (line ${lineAt(sql, Number(err.position))})` : '';
    return { name, verdict: null, error: `SQL error${where}: ${err.message}` };
  } finally {
    // Always undo everything. If the file already rolled back, Postgres just
    // warns "no transaction in progress", which is fine.
    await client.query('rollback').catch(() => {});
  }
}

/**
 * Runs every test file against the linked cloud dev project and prints the
 * results. Called only when `supabase link` has been done.
 *
 * @param {string} projectRef - The linked project's id.
 * @returns {Promise<number>} Exit code: 0 if every file passed, 1 otherwise.
 */
async function runLinkedTests(projectRef) {
  const password = readDbPassword();
  if (!password) {
    skip(`The project is linked (${projectRef}), but SUPABASE_DB_PASSWORD isn't set in .env.`);
  }

  // Loaded here, not at the top, so the skip path still works on a PC where
  // `npm install` hasn't been run since `pg` was added.
  const { Client } = require('pg');
  const target = connectionTarget(projectRef);
  const files = fs
    .readdirSync(testsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(testsDir, f));

  console.log(
    `Running ${files.length} database test files against the LINKED Supabase dev project ` +
      `${projectRef} (${target.host})...`,
  );

  let allOk = true;
  let totalPassed = 0;
  let totalPlanned = 0;
  for (const file of files) {
    const client = new Client({
      ...target,
      password,
      // Encrypted connection, and check the server's certificate against
      // Supabase's root certificate so the password only goes to Supabase.
      ssl: { ca: fs.readFileSync(supabaseCaFile, 'utf8'), rejectUnauthorized: true },
      connectionTimeoutMillis: 20000,
      // Stop any single statement that hangs for over a minute.
      statement_timeout: 60000,
    });
    // Postgres "notices" (like the harmless "already a transaction in
    // progress" warning) would otherwise be printed by nobody; ignore them.
    client.on('notice', () => {});

    let outcome;
    try {
      await client.connect();
      outcome = await runTestFile(client, file);
    } catch (err) {
      // Connecting failed (wrong password, network, ...). The message never
      // contains the password itself.
      outcome = {
        name: path.basename(file),
        verdict: null,
        error: `Could not connect: ${err.message}`,
      };
    } finally {
      await client.end().catch(() => {});
    }

    printOutcome(outcome);
    if (outcome.verdict) {
      totalPassed += outcome.verdict.passed;
      totalPlanned += outcome.verdict.planned ?? outcome.verdict.ran;
    }
    if (outcome.error || !outcome.verdict.ok) allOk = false;
  }

  // No test files at all (wrong folder, files renamed) proves nothing, so it
  // must not look like a pass.
  if (files.length === 0) {
    console.log(`  FAIL  no .sql test files found in ${testsDir}`);
    allOk = false;
  }

  console.log(
    `\n=== Database tests (pgTAP): ${allOk ? 'PASSED' : 'FAILED'}, ` +
      `${totalPassed}/${totalPlanned} checks passed across ${files.length} files ===`,
  );
  return allOk ? 0 : 1;
}

/**
 * Prints one test file's result: a one-line summary, then the details of
 * anything that went wrong (failed checks with pgTAP's explanation, plan
 * problems, or the SQL error).
 *
 * @param {{name: string, verdict: ReturnType<typeof judgeTap>|null, error: string|null}} outcome
 * @returns {void}
 */
function printOutcome({ name, verdict, error }) {
  if (error) {
    console.log(`  FAIL  ${name}: ${error}`);
    return;
  }
  const count = `${verdict.passed}/${verdict.planned ?? '?'} passed`;
  console.log(`  ${verdict.ok ? 'ok  ' : 'FAIL'}  ${name}: ${count}`);
  for (const line of verdict.failures) console.log(`        ${line}`);
  for (const problem of verdict.problems) console.log(`        problem: ${problem}`);
}

/**
 * Picks where to run the tests: local Docker database first, then the linked
 * cloud project, otherwise skip.
 *
 * @returns {Promise<void>} Ends the program with the right exit code.
 */
async function main() {
  // 1. Prefer a local database: `supabase status` succeeds only when Docker is
  //    running AND the local Supabase stack has been started. That path is
  //    unchanged: the Supabase tool runs the tests in Docker.
  if (supabase('status', true) === 0) {
    console.log('Running database tests against the LOCAL database (Docker)...');
    process.exit(supabase('test db --local', false));
  }

  // 2. Otherwise use the linked cloud dev project, if one was linked.
  if (fs.existsSync(linkedProjectFile)) {
    const projectRef = fs.readFileSync(linkedProjectFile, 'utf8').trim();
    process.exit(await runLinkedTests(projectRef));
  }

  // 3. Neither is available: explain and skip (or fail if required).
  skip();
}

main().catch((err) => {
  console.error(`Database test runner crashed: ${err.message}`);
  process.exit(1);
});
