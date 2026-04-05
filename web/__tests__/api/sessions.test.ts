import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { cleanTestDb, getTestAuth, insertTestSession } from '../setup';
import app from '@/app/lib/api-app';

describe('GET /api/sessions', () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    headers = (await getTestAuth()).headers;
  });

  beforeEach(async () => {
    await cleanTestDb();
  });

  it('returns 401 without api key', async () => {
    const res = await app.request('/api/sessions');
    expect(res.status).toBe(401);
  });

  it('returns empty array when no sessions', async () => {
    const res = await app.request('/api/sessions', { headers });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual([]);
  });

  it('returns sessions', async () => {
    await insertTestSession({ id: 'session-1', user_name: 'alice' });
    await insertTestSession({ id: 'session-2', user_name: 'bob' });

    const res = await app.request('/api/sessions', { headers });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveLength(2);
    expect(data[0].transcript).toBeUndefined();
  });

  it('searches sessions by transcript content', async () => {
    await insertTestSession({ id: 'session-1', transcript: 'discussing websockets' });
    await insertTestSession({ id: 'session-2', transcript: 'talking about databases' });

    const res = await app.request('/api/sessions?q=websockets', { headers });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('session-1');
  });
});
