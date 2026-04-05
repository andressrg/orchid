import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './app/lib/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Only manage our tables — Better Auth manages its own
  tablesFilter: ['orchid_sessions', 'api_keys'],
});
