import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanTestDb,
  getTestTeamAuth,
  insertTestSubscription,
} from '../setup';

const importApiApp = async () => {
  vi.resetModules();
  const apiAppModule = await import('@/app/lib/api-app');
  return apiAppModule.default;
};

const enableBillingEnforcement = () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_orchid');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_orchid');
  vi.stubEnv('STRIPE_TEAM_PRICE_ID', 'price_orchid_team');
  vi.stubEnv('STRIPE_BILLING_ENFORCEMENT', 'true');
};

const sessionPayload = {
  user_name: 'Billing Tester',
  user_email: 'billing@example.com',
  working_dir: '/tmp/orchid',
  git_remotes: ['https://github.com/andressrg/orchid.git'],
  branch: 'billing',
  tool: 'codex',
  transcript: '{"role":"user","content":"hello"}',
  status: 'active',
};

describe('billing API', () => {
  beforeEach(async () => {
    await cleanTestDb();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports billing as allowed when Stripe is not configured', async () => {
    const app = await importApiApp();
    const { headers } = await getTestTeamAuth();

    const res = await app.request('/api/billing/status', { headers });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.configured).toBe(false);
    expect(data.allowed).toBe(true);
    expect(data.reason).toBe('not_configured');
  });

  it('blocks session ingestion when enforcement is on and the team has no subscription', async () => {
    enableBillingEnforcement();
    const app = await importApiApp();
    const { headers } = await getTestTeamAuth();

    const res = await app.request('/api/sessions/billing-blocked', {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(sessionPayload),
    });
    const data = await res.json();

    expect(res.status).toBe(402);
    expect(data.code).toBe('subscription_required');
    expect(data.feature).toBe('session_ingest');
  });

  it('allows session ingestion when enforcement is on and the team has an active subscription', async () => {
    enableBillingEnforcement();
    const app = await importApiApp();
    const { headers, teamId } = await getTestTeamAuth();
    await insertTestSubscription({ teamId });

    const res = await app.request('/api/sessions/billing-allowed', {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(sessionPayload),
    });

    expect(res.status).toBe(200);
  });
});
