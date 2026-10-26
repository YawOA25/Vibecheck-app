/**
 * Reads TAP ("Test Anything Protocol") output and decides whether a test file
 * passed.
 *
 * What TAP is: the plain-text format pgTAP (our database test tool) uses to
 * report results. A test file prints lines like these:
 *   1..3                  <- the "plan": 3 checks are expected
 *   ok 1 - RLS is on      <- check 1 passed
 *   not ok 2 - A can't... <- check 2 FAILED
 *   # Failed test 2 ...   <- a "diagnostic": extra detail about a failure
 *
 * Why this exists: on the cloud dev project we run the test files ourselves
 * (scripts/test-db.js) instead of through Docker, so we also have to judge
 * the results ourselves. This module is kept separate, with no database code,
 * so its logic can be unit-tested (see __tests__/tap-parser.test.js).
 */

/**
 * Pulls the TAP lines out of the rows a test file returned.
 *
 * Every `select ok(...)`, `select plan(...)` and `select * from finish()` in a
 * test file returns rows whose single value is TAP text. One value can hold
 * several lines (a failed check adds "# Failed test" lines under it). Other
 * selects in a test file (for example ones that only switch the test user)
 * return values that aren't TAP, and are ignored here.
 *
 * @param {Array<string|null>} values - The first-column value of every row
 *   returned while the file ran, in order.
 * @returns {string[]} Just the TAP lines, in order.
 */
function extractTapLines(values) {
  const lines = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    for (const line of value.split('\n')) {
      // Keep plans ("1..N"), results ("ok"/"not ok") and diagnostics ("#").
      if (/^(\d+\.\.\d+|ok\b|not ok\b|\s*#)/.test(line)) lines.push(line);
    }
  }
  return lines;
}

/**
 * Judges a test file's TAP lines.
 *
 * A file passes only when ALL of these hold:
 *   - it declared a plan ("1..N") exactly once;
 *   - N is at least 1 (a "1..0" plan means "skip this whole file");
 *   - it ran exactly N checks, numbered 1, 2, 3, ... with none missing;
 *   - none of them is "not ok", and none was skipped ("ok 3 # SKIP ...").
 * A missing or wrong plan matters because a test file that crashes halfway,
 * or silently skips checks, would otherwise look like a pass. pgTAP prints a
 * skipped check as "ok", so we look for the SKIP marker and count it as a
 * problem: our tests never skip on purpose, so a skip means a check didn't run.
 *
 * @param {string[]} lines - TAP lines from extractTapLines().
 * @returns {{planned: number|null, ran: number, passed: number,
 *   failures: string[], problems: string[], ok: boolean}}
 *   `failures` holds each "not ok" line plus the "#" lines explaining it
 *   (so it can be non-empty only when a check failed); `problems` holds plan or numbering
 *   errors in plain words; `ok` is true only if both lists are empty.
 */
function judgeTap(lines) {
  let planned = null;
  let planCount = 0;
  let ran = 0;
  let passed = 0;
  let lastFailed = false; // was the most recent check a "not ok"?
  const failures = [];
  const problems = [];

  for (const line of lines) {
    const plan = /^1\.\.(\d+)/.exec(line);
    if (plan) {
      planned = Number(plan[1]);
      planCount += 1;
      continue;
    }
    const result = /^(not ok|ok)\b\s*(\d+)?/.exec(line);
    if (!result) {
      // A diagnostic line ("# ..."). Right after a failed check it explains
      // the failure (what was expected vs. what happened), so keep it with
      // the failure for printing.
      if (lastFailed) failures.push(line);
      continue;
    }
    ran += 1;
    lastFailed = result[1] === 'not ok';
    // Checks must be numbered in order. A gap or repeat means output got lost
    // or mixed up, so the count can't be trusted.
    if (result[2] !== undefined && Number(result[2]) !== ran) {
      problems.push(`expected check number ${ran} but got: ${line}`);
    }
    // A skipped check prints as "ok N - name # SKIP reason". It proved nothing,
    // so it must not count as a pass.
    if (/#\s*skip\b/i.test(line)) {
      problems.push(`check was skipped, so it proved nothing: ${line}`);
      continue;
    }
    if (result[1] === 'ok') passed += 1;
    else failures.push(line);
  }

  if (planCount === 0) problems.push('no plan ("1..N" line): did the file call plan()?');
  if (planned === 0) problems.push('the plan is "1..0", which means the whole file was skipped');
  if (planCount > 1) problems.push(`the plan was declared ${planCount} times`);
  if (planned !== null && planned !== ran) {
    problems.push(`planned ${planned} checks but ${ran} ran`);
  }

  return {
    planned,
    ran,
    passed,
    failures,
    problems,
    ok: failures.length === 0 && problems.length === 0,
  };
}

module.exports = { extractTapLines, judgeTap };
