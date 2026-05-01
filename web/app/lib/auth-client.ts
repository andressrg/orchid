'use client';

import { createAuthClient } from 'better-auth/react';
import { organizationClient } from 'better-auth/client/plugins';
import { stripeClient } from '@better-auth/stripe/client';

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : '',
  basePath: '/api/auth',
  plugins: [organizationClient(), stripeClient({ subscription: true })],
});
