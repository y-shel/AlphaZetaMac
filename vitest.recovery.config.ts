import { defineConfig } from 'vitest/config';

// Plan 1 has no estimators, so this suite is empty and passes. Plan 2 fills it.
export default defineConfig({
  test: {
    include: ['src/**/*.recovery.test.ts'],
    passWithNoTests: true,
  },
});
