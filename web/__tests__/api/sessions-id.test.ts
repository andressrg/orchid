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

    it('returns the session by id using the public snake_case API shape', async () => {
      const { userId } = await getTestAuth();
      await insertTestSession({
        id: 'my-session',
        user_name: 'detail-user',
        user_email: 'detail@example.com',
        working_dir: '/home/detail/project',
        git_remotes: ['https://github.com/detail/repo.git'],
        branch: 'feature/detail',
        tool: 'claude-code',
        transcript: '{"role":"user","content":"detail"}',
        status: 'done',
        message_count: 1,
        user_id: userId,
      });

      const res = await app.request('/api/sessions/my-session', { headers });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toMatchObject({
        id: 'my-session',
        user_name: 'detail-user',
        user_email: 'detail@example.com',
        working_dir: '/home/detail/project',
        git_remotes: ['https://github.com/detail/repo.git'],
        branch: 'feature/detail',
        tool: 'claude-code',
        transcript: '{"role":"user","content":"detail"}',
        status: 'done',
        message_count: 1,
        user_id: userId,
        team_id: null,
      });
      expect(data.started_at).toBeTruthy();
      expect(data.updated_at).toBeTruthy();
      expect(data).not.toHaveProperty('userName');
      expect(data).not.toHaveProperty('userEmail');
      expect(data).not.toHaveProperty('workingDir');
      expect(data).not.toHaveProperty('gitRemotes');
      expect(data).not.toHaveProperty('startedAt');
      expect(data).not.toHaveProperty('updatedAt');
      expect(data).not.toHaveProperty('messageCount');
      expect(data).not.toHaveProperty('userId');
      expect(data).not.toHaveProperty('teamId');
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
