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

  test('sessions endpoint works with legacy API key', async ({ request }) => {
    const res = await request.get('/api/sessions', {
      headers: { 'X-API-Key': 'test-api-key' },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('can create and retrieve a session with legacy API key', async ({ request }) => {
    const sessionId = `e2e-test-${Date.now()}`;
    const headers = { 'X-API-Key': 'test-api-key', 'Content-Type': 'application/json' };

    // Create
    const putRes = await request.put(`/api/sessions/${sessionId}`, {
      headers,
      data: {
        user_name: 'e2e-user',
        user_email: 'e2e@test.com',
        working_dir: '/tmp/e2e',
        git_remotes: [],
        branch: 'main',
        tool: 'claude',
        transcript: '{"role":"user","content":"e2e test"}',
        status: 'done',
      },
    });
    expect(putRes.status()).toBe(200);

    // Retrieve
    const getRes = await request.get(`/api/sessions/${sessionId}`, { headers });
    expect(getRes.status()).toBe(200);
    const session = await getRes.json();
    expect(session.user_name).toBe('e2e-user');
    expect(session.status).toBe('done');

    // Delete
    const delRes = await request.delete(`/api/sessions/${sessionId}`, { headers });
    expect(delRes.status()).toBe(200);
  });

  test('stats endpoint works with legacy API key', async ({ request }) => {
    const res = await request.get('/api/stats', {
      headers: { 'X-API-Key': 'test-api-key' },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.total_sessions).toBeDefined();
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
