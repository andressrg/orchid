import { describe, it, expect, beforeEach } from 'vitest';
import { cleanTestDb } from '../setup';
import app from '@/app/lib/api-app';

describe('POST /api/webhook/github', () => {
  beforeEach(async () => {
    await cleanTestDb();
  });

  it('skips non-pull_request events', async () => {
    const res = await app.request('/api/webhook/github', {
      method: 'POST',
      headers: { 'x-github-event': 'push', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.skipped).toBe(true);
  });

  it('skips non-opened/synchronize actions', async () => {
    const res = await app.request('/api/webhook/github', {
      method: 'POST',
      headers: { 'x-github-event': 'pull_request', 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'closed',
        pull_request: { head: { ref: 'main' } },
        repository: { full_name: 'test/repo' },
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.skipped).toBe(true);
  });

  it('skips when no GITHUB_TOKEN', async () => {
    const res = await app.request('/api/webhook/github', {
      method: 'POST',
      headers: { 'x-github-event': 'pull_request', 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'opened',
        pull_request: { head: { ref: 'feature/test' }, number: 1 },
        repository: {
          full_name: 'test/repo',
          clone_url: 'https://github.com/test/repo.git',
        },
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.reason).toBe('no token');
  });
});
