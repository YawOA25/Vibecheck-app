/**
 * Runs once before all Jest tests (see `globalSetup` in jest.config.js).
 *
 * What it does: pretends the test machine is in Tokyo, far from New York.
 * Why: the app must show New York days and times (VibeCheck is a DC-area
 * app; src/lib/tonight.ts and src/lib/age.ts) whatever zone a phone is set
 * to. Running every test in a non-New-York zone catches any code that
 * quietly uses the phone's own clock. It has to be set here, before the
 * test workers start: on Windows, changing TZ inside a running test file
 * has no effect.
 *
 * @returns nothing.
 */
module.exports = async function globalSetup() {
  process.env.TZ = 'Asia/Tokyo';
};
