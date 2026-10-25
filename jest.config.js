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
};
