/**
 * A stand-in for the Sentry library, used automatically by every Jest test
 * (Jest picks up files in a `__mocks__` folder next to node_modules that
 * match an installed package's name). Task VC-26.
 *
 * Why: the real library starts a timer as soon as it is loaded, which keeps
 * Jest from finishing cleanly and slows the test run a lot. Tests also must
 * never send anything to Sentry. Our own code (src/lib/sentry.ts) only uses
 * `init` and `captureException`, so this fake has just those two, as Jest
 * spy functions that tests can inspect.
 */
module.exports = {
  /** Fake Sentry.init: records the options it was given, sends nothing. */
  init: jest.fn(),
  /** Fake Sentry.captureException: records the error, sends nothing. */
  captureException: jest.fn(),
};
