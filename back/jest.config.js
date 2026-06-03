export default {
  preset: 'ts-jest/presets/default-esm', // Support ESM in TS
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1', // Handle .js extensions in imports
  },
  extensionsToTreatAsEsm: ['.ts'],
  testMatch: [
    '**/tests/**/*.test.js',
    '**/*.spec.ts'
  ],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
};
