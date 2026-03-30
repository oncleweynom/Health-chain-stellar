/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  projects: [
    // ── Unit tests ────────────────────────────────────────────────────────────
    {
      displayName: 'unit',
      moduleFileExtensions: ['js', 'json', 'ts'],
      rootDir: 'src',
      testRegex: '(?<!integration)\\.spec\\.ts$',
      transform: { '^.+\\.(t|j)s$': 'ts-jest' },
      testEnvironment: 'node',
      collectCoverageFrom: [
        '**/*.(t|j)s',
        '!**/*.module.ts',
        '!**/main.ts',
        '!**/*.entity.ts',
        '!**/*.dto.ts',
        '!**/*.enum.ts',
        '!**/*.types.ts',
        '!**/migrations/**',
      ],
      coverageDirectory: '../coverage/unit',
      moduleNameMapper: {
        '^@test/(.*)$': '<rootDir>/../test/helpers/$1',
      },
    },
    // ── Integration tests ─────────────────────────────────────────────────────
    {
      displayName: 'integration',
      moduleFileExtensions: ['js', 'json', 'ts'],
      rootDir: 'src',
      testRegex: '\\.integration\\.spec\\.ts$',
      transform: { '^.+\\.(t|j)s$': 'ts-jest' },
      testEnvironment: 'node',
      coverageDirectory: '../coverage/integration',
      moduleNameMapper: {
        '^@test/(.*)$': '<rootDir>/../test/helpers/$1',
      },
    },
    // ── E2E tests ─────────────────────────────────────────────────────────────
    {
      displayName: 'e2e',
      moduleFileExtensions: ['js', 'json', 'ts'],
      rootDir: 'test',
      testRegex: '\\.e2e-spec\\.ts$',
      transform: { '^.+\\.(t|j)s$': 'ts-jest' },
      testEnvironment: 'node',
      moduleNameMapper: {
        '^@test/(.*)$': '<rootDir>/helpers/$1',
      },
    },
  ],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.(t|j)s'],
};
