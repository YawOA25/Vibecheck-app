/**
 * Checks a pgTAP test file BEFORE it runs on the shared cloud dev project, to
 * make sure it can't save test data there for good.
 *
 * Why this exists: scripts/test-db.js opens a transaction, runs the file, then
 * rolls everything back. That only works if the file itself never ends the
 * transaction early. A COMMIT (or its synonym END) would save the test data;
 * a ROLLBACK in the middle would end our transaction, so every statement after
 * it would run on its own and be saved. So we refuse both, before running
 * anything. A ROLLBACK as the very last statement is fine (that's how every
 * test file ends).
 *
 * Limits, on purpose: this is a simple text check, not a full SQL parser. It
 * errs on the side of refusing. For example, a DO block or function body in a
 * test file contains `end;` and will be refused: put such code in a migration
 * instead. A refusal is loud (the file shows as FAIL), so it can't hide a
 * problem; it can only ask you to rewrite the file.
 */

// Finds a transaction-ending command at the START of a statement: at the very
// start of the file or right after a `;`, skipping spaces, blank lines and
// whole `--` comment lines in between. `rollback to <savepoint>` doesn't end
// the transaction, so it is left alone.
const TRANSACTION_END =
  /(?:^|;)(?:\s|--[^\n]*(?:\n|$))*(commit|end|abort|rollback|prepare\s+transaction)\b(?!\s+to\b)/gi;

/**
 * Looks for anything in a test file that would end the test transaction early.
 *
 * @param {string} sql - The full text of the test file.
 * @returns {string|null} A plain-language reason to refuse the file, or null
 *   when the file is safe to run inside our transaction.
 */
function transactionControlProblem(sql) {
  for (const match of sql.matchAll(TRANSACTION_END)) {
    const word = match[1].toUpperCase().replace(/\s+/g, ' ');
    if (word !== 'ROLLBACK' && word !== 'ABORT') {
      return `contains ${word}, which would save test data for good; test files must end with ROLLBACK`;
    }
    // A ROLLBACK is allowed only as the last statement: after its `;` there
    // may be nothing but spaces and `--` comments.
    const semicolon = sql.indexOf(';', match.index + match[0].length);
    const rest = semicolon === -1 ? '' : sql.slice(semicolon + 1);
    if (rest.replace(/--[^\n]*/g, '').trim() !== '') {
      return `has statements after ${word}, which would run outside the test transaction and be saved for good`;
    }
  }
  return null;
}

module.exports = { transactionControlProblem };
