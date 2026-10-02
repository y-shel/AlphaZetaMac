import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.recovery.test.ts'],
    // Recovery and calibration tests simulate hundreds of users.
    testTimeout: 120_000,
  },
});
