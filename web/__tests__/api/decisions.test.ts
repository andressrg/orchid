import { describe, it, expect, beforeEach } from 'vitest';
import { cleanTestDb, insertTestSession } from '../setup';
import { GET } from '@/app/api/decisions/route';

const headers = { 'x-api-key': 'test-api-key' };

describe('GET /api/decisions', () => {
  beforeEach(async () => {
    await cleanTestDb();
  });

  it('returns 401 without api key', async () => {
    const response = await GET(new Request('http://localhost/api/decisions'));
    expect(response.status).toBe(401);
  });

  it('returns empty when no sessions', async () => {
    const response = await GET(new Request('http://localhost/api/decisions', { headers }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.decisions).toEqual([]);
    expect(data.sessions_analyzed).toBe(0);
  });

  it('returns mock decisions when no OPENAI_API_KEY', async () => {
    await insertTestSession({ id: 's1' });

    const response = await GET(new Request('http://localhost/api/decisions', { headers }));
    const data = await response.json();

    expect(response.status).toBe(200);
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

    const response = await GET(
      new Request('http://localhost/api/decisions?repo=repo-a', { headers }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sessions_analyzed).toBe(1);
  });
});
