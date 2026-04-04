import { describe, it, expect, beforeEach } from 'vitest';
import { cleanTestDb, insertTestSession } from '../setup';
import { GET } from '@/app/api/sessions/route';

const headers = { 'x-api-key': 'test-api-key' };

function req(url = 'http://localhost/api/sessions') {
  return new Request(url, { headers });
}

describe('GET /api/sessions', () => {
  beforeEach(async () => {
    await cleanTestDb();
  });

  it('returns 401 without api key', async () => {
    const response = await GET(new Request('http://localhost/api/sessions'));
    expect(response.status).toBe(401);
  });

  it('returns empty array when no sessions', async () => {
    const response = await GET(req());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([]);
  });

  it('returns sessions ordered by started_at desc', async () => {
    await insertTestSession({ id: 'session-1', user_name: 'alice' });
    await insertTestSession({ id: 'session-2', user_name: 'bob' });

    const response = await GET(req());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveLength(2);
    expect(data[0].transcript).toBeUndefined();
  });

  it('searches sessions by transcript content', async () => {
    await insertTestSession({ id: 'session-1', transcript: 'discussing websockets' });
    await insertTestSession({ id: 'session-2', transcript: 'talking about databases' });

    const response = await GET(req('http://localhost/api/sessions?q=websockets'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('session-1');
  });
});
