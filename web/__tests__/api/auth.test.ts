import { describe, it, expect } from 'vitest';
import { getTestAuth } from '../setup';
import app from '@/app/lib/api-app';

describe('auth middleware', () => {
  it('returns 401 when no auth provided', async () => {
    const res = await app.request('/api/sessions');
    expect(res.status).toBe(401);
  });

  it('returns 401 when invalid PAT provided', async () => {
    const res = await app.request('/api/sessions', {
      headers: { authorization: 'Bearer orc_invalid_token' },
    });
    expect(res.status).toBe(401);
  });

  it('allows request with valid PAT', async () => {
    const { headers } = await getTestAuth();
    const res = await app.request('/api/sessions', { headers });
    expect(res.status).toBe(200);
  });

  it('skips auth for health endpoint', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
  });

  it('skips auth for webhook endpoint', async () => {
    const res = await app.request('/api/webhook/github', {
      method: 'POST',
      headers: { 'x-github-event': 'push', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });
});
