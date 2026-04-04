import { describe, it, expect } from 'vitest';
import app from '@/app/lib/api-app';

describe('auth middleware', () => {
  it('returns 401 when no api key provided', async () => {
    const res = await app.request('/api/sessions');
    expect(res.status).toBe(401);
  });

  it('returns 401 when wrong api key provided', async () => {
    const res = await app.request('/api/sessions', {
      headers: { 'x-api-key': 'wrong-key' },
    });
    expect(res.status).toBe(401);
  });

  it('allows request with correct api key', async () => {
    const res = await app.request('/api/sessions', {
      headers: { 'x-api-key': 'test-api-key' },
    });
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
