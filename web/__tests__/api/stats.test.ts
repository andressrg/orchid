import { describe, it, expect, beforeEach } from 'vitest';
import { cleanTestDb, insertTestSession } from '../setup';
import { GET } from '@/app/api/stats/route';

const headers = { 'x-api-key': 'test-api-key' };

describe('GET /api/stats', () => {
  beforeEach(async () => {
    await cleanTestDb();
  });

  it('returns 401 without api key', async () => {
    const response = await GET(new Request('http://localhost/api/stats'));
    expect(response.status).toBe(401);
  });

  it('returns stats with zero sessions', async () => {
    const response = await GET(new Request('http://localhost/api/stats', { headers }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.total_sessions).toBe('0');
    expect(data.active_sessions).toBe('0');
    expect(data.unique_users).toBe('0');
  });

  it('returns correct stats', async () => {
    await insertTestSession({ id: 's1', user_name: 'alice', status: 'active' });
    await insertTestSession({ id: 's2', user_name: 'bob', status: 'done' });
    await insertTestSession({ id: 's3', user_name: 'alice', status: 'active' });

    const response = await GET(new Request('http://localhost/api/stats', { headers }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.total_sessions).toBe('3');
    expect(data.active_sessions).toBe('2');
    expect(data.unique_users).toBe('2');
  });
});
