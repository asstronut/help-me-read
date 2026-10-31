import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/api/**/*.test.ts'],
    globalSetup: ['tests/helpers/server.ts'],
    testTimeout: 30_000,
    hookTimeout: 150_000,
    fileParallelism: false,
  },
});
