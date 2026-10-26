/**
 * Tests for scripts/lib/tap.js, the code that decides whether a database test
 * file passed when we run pgTAP against the cloud dev project.
 *
 * Why these matter: if this judge is too lenient, a broken database rule could
 * show up as "passed". So most tests below feed it BAD output (a failure, a
 * missing check, no plan) and make sure it says "not ok".
 */
const { extractTapLines, judgeTap } = require('../scripts/lib/tap');

describe('extractTapLines', () => {
  it('keeps TAP lines, splits multi-line values and drops non-TAP values', () => {
    const values = [
      '1..2',
      'ok 1 - first',
      null, // e.g. a `select set_config(...)` that returned nothing useful
      '{"sub": "abc"}', // e.g. a non-TAP select result
      'not ok 2 - second\n# Failed test 2: "second"\n#         have: 1',
    ];
    expect(extractTapLines(values)).toEqual([
      '1..2',
      'ok 1 - first',
      'not ok 2 - second',
      '# Failed test 2: "second"',
      '#         have: 1',
    ]);
  });
});

describe('judgeTap', () => {
  it('passes when every planned check ran and passed', () => {
    const verdict = judgeTap(['1..2', 'ok 1 - a', 'ok 2 - b']);
    expect(verdict).toMatchObject({ ok: true, planned: 2, ran: 2, passed: 2 });
  });

  it('fails on any "not ok"', () => {
    const verdict = judgeTap(['1..2', 'ok 1 - a', 'not ok 2 - b']);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toEqual(['not ok 2 - b']);
  });

  it('fails when fewer checks ran than planned (file stopped early)', () => {
    const verdict = judgeTap(['1..3', 'ok 1 - a', 'ok 2 - b']);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toContain('planned 3 checks but 2 ran');
  });

  it('fails when there is no plan at all', () => {
    const verdict = judgeTap(['ok 1 - a']);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems[0]).toMatch(/no plan/);
  });

  it('fails when check numbers skip or repeat', () => {
    const verdict = judgeTap(['1..2', 'ok 1 - a', 'ok 3 - b']);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems[0]).toMatch(/expected check number 2/);
  });

  it('ignores diagnostic lines when counting', () => {
    const verdict = judgeTap(['1..1', '# a note', 'ok 1 - a']);
    expect(verdict).toMatchObject({ ok: true, ran: 1 });
  });

  it('keeps the explanation lines under a failed check, not under a passed one', () => {
    const verdict = judgeTap(['1..2', 'not ok 1 - a', '# have: 1', 'ok 2 - b', '# a note']);
    expect(verdict.failures).toEqual(['not ok 1 - a', '# have: 1']);
  });

  it('fails when a check was skipped (pgTAP prints skips as "ok")', () => {
    const verdict = judgeTap(['1..2', 'ok 1 - a', 'ok 2 # SKIP no data']);
    expect(verdict.ok).toBe(false);
    expect(verdict.passed).toBe(1);
    expect(verdict.problems[0]).toMatch(/skipped/);
  });

  it('fails on a "1..0" plan (the whole file was skipped)', () => {
    const verdict = judgeTap(['1..0 # Skipped: no database']);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems[0]).toMatch(/1\.\.0/);
  });
});
