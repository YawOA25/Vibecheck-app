/**
 * Jest settings: Jest runs our automated tests (files ending in .test.ts or
 * .test.tsx). Run them with `npm test`.
 *
 * - `preset: 'jest-expo'` sets Jest up to understand React Native and Expo
 *   code, and fakes the phone-only parts so tests can run on a PC.
 * - `moduleNameMapper` teaches Jest the same '@/' shortcut that tsconfig.json
 *   defines, so `import ... from '@/theme'` works in tests too.
 */
module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // How long one test may take before Jest calls it stuck (default 5 s).
  // On a first run (nothing cached yet), the first screen test in a file has
  // to translate React Native's text boxes and scroll views for Jest, which
  // took over 5 s on this PC. 30 s still catches a truly stuck test. (VC-B03)
  testTimeout: 30000,
  // Run every test with the machine's time zone set to Tokyo, so code that
  // uses the phone's clock instead of New York's fails (VC-B05 cto review).
  globalSetup: '<rootDir>/jest.global-setup.js',
};
