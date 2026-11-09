import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          globalSetup: ['tests/helpers/server.ts'],
          testTimeout: 30_000,
          hookTimeout: 150_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
