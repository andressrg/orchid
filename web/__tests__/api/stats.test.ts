import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { cleanTestDb, getTestAuth, insertTestSession } from '../setup';
import app from '@/app/lib/api-app';

describe('GET /api/stats', () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    headers = (await getTestAuth()).headers;
  });

  beforeEach(async () => {
    await cleanTestDb();
  });

  it('returns 401 without api key', async () => {
    const res = await app.request('/api/stats');
    expect(res.status).toBe(401);
  });

  it('returns stats with zero sessions', async () => {
    const res = await app.request('/api/stats', { headers });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total_sessions).toBe('0');
    expect(data.active_sessions).toBe('0');
    expect(data.unique_users).toBe('0');
  });

  it('returns correct stats', async () => {
    await insertTestSession({ id: 's1', user_name: 'alice', status: 'active' });
    await insertTestSession({ id: 's2', user_name: 'bob', status: 'done' });
    await insertTestSession({ id: 's3', user_name: 'alice', status: 'active' });

    const res = await app.request('/api/stats', { headers });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total_sessions).toBe('3');
    expect(data.active_sessions).toBe('2');
    expect(data.unique_users).toBe('2');
  });
});
