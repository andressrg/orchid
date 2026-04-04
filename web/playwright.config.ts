import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 30000,
    env: {
      DATABASE_URL: 'postgresql://orchid:orchid@localhost:5432/orchid_test',
      ORCHID_API_KEY: 'test-api-key',
      BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
