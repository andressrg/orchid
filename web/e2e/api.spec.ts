import { test, expect } from '@playwright/test';

test.describe('API endpoints', () => {
  test('health endpoint works without auth', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  test('sessions endpoint requires auth', async ({ request }) => {
    const res = await request.get('/api/sessions');
    expect(res.status()).toBe(401);
  });

  test('rejects invalid PAT', async ({ request }) => {
    const res = await request.get('/api/sessions', {
      headers: { Authorization: 'Bearer orc_invalid' },
    });
    expect(res.status()).toBe(401);
  });

  test('webhook skips non-PR events', async ({ request }) => {
    const res = await request.post('/api/webhook/github', {
      headers: { 'X-GitHub-Event': 'push', 'Content-Type': 'application/json' },
      data: {},
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.skipped).toBe(true);
  });
});
