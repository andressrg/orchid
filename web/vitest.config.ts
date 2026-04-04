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
      ORCHID_API_KEY: 'test-api-key',
      BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
      BETTER_AUTH_URL: 'http://localhost:3000',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
