import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false,
    include: ['__tests__/**/*.test.ts'],
    exclude: ['e2e/**'],
    globalSetup: './__tests__/globalSetup.ts',
    env: {
      DATABASE_URL: 'postgresql://orchid:orchid@localhost:5432/orchid_test',
      BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
      BETTER_AUTH_URL: 'http://localhost:3000',
      // Shorten the build-time migrator's lock budget so migrate.test.ts's
      // lock-contention scenarios resolve in ~3s instead of the 90s prod budget.
      MIGRATE_LOCK_BUDGET_MS: '3000',
      MIGRATE_LOCK_RETRY_MS: '400',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
