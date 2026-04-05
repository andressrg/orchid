import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { cleanTestDb, getTestAuth, insertTestSession } from '../setup';
import app from '@/app/lib/api-app';

describe('GET /api/decisions', () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    headers = (await getTestAuth()).headers;
  });

  beforeEach(async () => {
    await cleanTestDb();
  });

  it('returns 401 without api key', async () => {
    const res = await app.request('/api/decisions');
    expect(res.status).toBe(401);
  });

  it('returns empty when no sessions', async () => {
    const res = await app.request('/api/decisions', { headers });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.decisions).toEqual([]);
    expect(data.sessions_analyzed).toBe(0);
  });

  it('returns mock decisions when no OPENAI_API_KEY', async () => {
    await insertTestSession({ id: 's1' });

    const res = await app.request('/api/decisions', { headers });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.decisions.length).toBeGreaterThan(0);
    expect(data.decisions[0].title).toBeDefined();
    expect(data.decisions[0].session_id).toBe('s1');
    expect(data.sessions_analyzed).toBe(1);
  });

  it('filters by repo', async () => {
    await insertTestSession({
      id: 's1',
      git_remotes: JSON.stringify(['https://github.com/test/repo-a.git']),
    });
    await insertTestSession({
      id: 's2',
      git_remotes: JSON.stringify(['https://github.com/test/repo-b.git']),
    });

    const res = await app.request('/api/decisions?repo=repo-a', { headers });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sessions_analyzed).toBe(1);
  });
});
