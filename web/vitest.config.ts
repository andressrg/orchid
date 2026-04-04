import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false,
    globalSetup: './__tests__/globalSetup.ts',
    env: {
      DATABASE_URL: 'postgresql://orchid:orchid@localhost:5432/orchid_test',
      ORCHID_API_KEY: 'test-api-key',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
