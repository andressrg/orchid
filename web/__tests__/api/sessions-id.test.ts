import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { cleanTestDb, getTestAuth, insertTestSession } from '../setup';
import app from '@/app/lib/api-app';

describe('sessions/:id', () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    headers = (await getTestAuth()).headers;
  });

  beforeEach(async () => {
    await cleanTestDb();
  });

  describe('GET', () => {
    it('returns 404 for nonexistent session', async () => {
      const res = await app.request('/api/sessions/nonexistent', { headers });
      expect(res.status).toBe(404);
    });

    it('returns session by id', async () => {
      await insertTestSession({ id: 'my-session' });

      const res = await app.request('/api/sessions/my-session', { headers });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.id).toBe('my-session');
      expect(data.userName ?? data.user_name).toBe('testuser');
      expect(data.transcript).toBeDefined();
    });
  });

  describe('PUT', () => {
    it('creates a new session', async () => {
      const body = {
        user_name: 'alice',
        user_email: 'alice@example.com',
        working_dir: '/home/alice',
        git_remotes: ['https://github.com/alice/repo.git'],
        branch: 'feature/test',
        tool: 'claude',
        transcript: '{"role":"user","content":"test"}',
        status: 'active',
      };

      const res = await app.request('/api/sessions/new-session', {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.id).toBe('new-session');
      expect(data.user_name).toBe('alice');
      expect(data.message_count).toBe(1);
    });

    it('upserts an existing session', async () => {
      await insertTestSession({ id: 'existing' });

      const body = {
        user_name: 'updated-user',
        user_email: 'updated@example.com',
        working_dir: '/updated',
        git_remotes: [],
        branch: 'main',
        tool: 'claude',
        transcript: '{"role":"user","content":"line1"}\n{"role":"assistant","content":"line2"}',
        status: 'done',
      };

      const res = await app.request('/api/sessions/existing', {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.user_name).toBe('updated-user');
      expect(data.status).toBe('done');
      expect(data.message_count).toBe(2);
    });
  });

  describe('DELETE', () => {
    it('deletes a session', async () => {
      await insertTestSession({ id: 'to-delete' });

      const res = await app.request('/api/sessions/to-delete', {
        method: 'DELETE',
        headers,
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.deleted).toBe('to-delete');
    });

    it('returns 404 for nonexistent session', async () => {
      const res = await app.request('/api/sessions/nope', {
        method: 'DELETE',
        headers,
      });
      expect(res.status).toBe(404);
    });
  });
});
