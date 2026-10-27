/**
 * Runs in every Jest test file, before its tests (see `setupFilesAfterEnv`
 * in jest.config.js).
 *
 * What it does: gives React Native Testing Library's waiting helpers
 * (`findBy...` queries and `waitFor`) 5 seconds instead of their default
 * 1 second.
 *
 * Why: the cto saw a run where 3 screen tests failed once and then passed.
 * The likely cause is a cold start: on a first run with an empty cache, or
 * when many test files start at once on a busy PC, the first screen to
 * render in a file can take more than 1 second, so a `findBy...` gave up
 * before the screen appeared. 5 seconds removes that race; a truly missing
 * element still fails (just a little later), and Jest's own 30-second test
 * limit (jest.config.js) still catches a stuck test.
 *
 * @returns nothing.
 */
const { configure } = require('@testing-library/react-native');

configure({ asyncUtilTimeout: 5000 });
