import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.recovery.test.ts'],
  },
});
