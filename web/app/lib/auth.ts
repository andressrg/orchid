import { betterAuth } from 'better-auth';
import { organization } from 'better-auth/plugins';
import { Pool } from 'pg';

export const auth = betterAuth({
  database: new Pool({
    connectionString: process.env.DATABASE_URL,
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000',
  basePath: '/api/auth',
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: 'owner',
    }),
  ],
});
