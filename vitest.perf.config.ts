import { defineConfig } from 'vitest/config';

// Engine speed budgets (spec 17.5), run by bun run test:perf.
export default defineConfig({
  test: {
    include: ['src/**/*.perf.test.ts'],
    testTimeout: 60_000,
  },
});
