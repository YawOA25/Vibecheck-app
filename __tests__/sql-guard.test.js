/**
 * Tests for scripts/lib/sql-guard.js, the check that stops a database test
 * file from saving test data on the shared cloud dev project.
 *
 * Why these matter: if the guard misses a COMMIT, test users and events would
 * be left in the dev project for good. So most tests feed it UNSAFE files and
 * make sure it refuses them.
 */
const { transactionControlProblem } = require('../scripts/lib/sql-guard');

describe('transactionControlProblem', () => {
  it('accepts a normal test file that ends with ROLLBACK', () => {
    const sql = '-- header\nbegin;\nselect plan(1);\nselect ok(true);\nrollback;\n-- done\n';
    expect(transactionControlProblem(sql)).toBeNull();
  });

  it('refuses COMMIT, on its own line or after another statement', () => {
    expect(transactionControlProblem('begin;\ncommit;\n')).toMatch(/COMMIT/);
    expect(transactionControlProblem('begin; select 1; commit;')).toMatch(/COMMIT/);
  });

  it('refuses END, which is another way to write COMMIT', () => {
    expect(transactionControlProblem('begin;\nselect 1;\nend;\n')).toMatch(/END/);
  });

  it('refuses statements after a ROLLBACK (they would be saved)', () => {
    const sql = 'begin;\nrollback;\ninsert into t values (1);\n';
    expect(transactionControlProblem(sql)).toMatch(/after ROLLBACK/);
  });

  it('allows ROLLBACK TO a savepoint, which keeps the transaction open', () => {
    const sql = 'begin;\nsavepoint a;\nrollback to a;\nselect 1;\nrollback;\n';
    expect(transactionControlProblem(sql)).toBeNull();
  });

  it('ignores the word commit inside a comment line', () => {
    const sql = 'begin;\n-- commit is never used here\nselect 1;\nrollback;\n';
    expect(transactionControlProblem(sql)).toBeNull();
  });
});
