/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.spec.ts'
  ],
  testPathIgnorePatterns: [
    // Relay tests run under bun (`bun test`), not jest: they import bun:test and
    // drive a real Bun.serve instance.
    '/tests/unit/socket-queue.test.ts',
    '/tests/unit/socket-webflow-routing.test.ts',
    // Loads the extension's plain-JS command table with a fake `webflow` global.
    '/tests/unit/webflow-extension.test.ts'
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true }],
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts'
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // `uuid` is ESM-only and ts-jest cannot parse it, which made any test that
    // reached utils/websocket.ts fail on an import rather than on its subject.
    '^uuid$': '<rootDir>/tests/mocks/uuid.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 10000,
  verbose: true,
  extensionsToTreatAsEsm: ['.ts']
};