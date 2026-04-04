import { describe, it, expect, beforeEach } from 'vitest';
import { cleanTestDb, insertTestSession } from '../setup';
import { GET, PUT, DELETE } from '@/app/api/sessions/[id]/route';

const headers = { 'x-api-key': 'test-api-key' };

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('sessions/:id', () => {
  beforeEach(async () => {
    await cleanTestDb();
  });

  describe('GET', () => {
    it('returns 401 without api key', async () => {
      const response = await GET(
        new Request('http://localhost/api/sessions/test'),
        makeParams('test'),
      );
      expect(response.status).toBe(401);
    });

    it('returns 404 for nonexistent session', async () => {
      const response = await GET(
        new Request('http://localhost/api/sessions/nonexistent', { headers }),
        makeParams('nonexistent'),
      );
      expect(response.status).toBe(404);
    });

    it('returns session by id', async () => {
      await insertTestSession({ id: 'my-session' });

      const response = await GET(
        new Request('http://localhost/api/sessions/my-session', { headers }),
        makeParams('my-session'),
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe('my-session');
      expect(data.user_name).toBe('testuser');
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

      const response = await PUT(
        new Request('http://localhost/api/sessions/new-session', {
          method: 'PUT',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        makeParams('new-session'),
      );
      const data = await response.json();

      expect(response.status).toBe(200);
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

      const response = await PUT(
        new Request('http://localhost/api/sessions/existing', {
          method: 'PUT',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        makeParams('existing'),
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.user_name).toBe('updated-user');
      expect(data.status).toBe('done');
      expect(data.message_count).toBe(2);
    });
  });

  describe('DELETE', () => {
    it('deletes a session', async () => {
      await insertTestSession({ id: 'to-delete' });

      const response = await DELETE(
        new Request('http://localhost/api/sessions/to-delete', { method: 'DELETE', headers }),
        makeParams('to-delete'),
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.deleted).toBe('to-delete');
    });

    it('returns 404 for nonexistent session', async () => {
      const response = await DELETE(
        new Request('http://localhost/api/sessions/nope', { method: 'DELETE', headers }),
        makeParams('nope'),
      );
      expect(response.status).toBe(404);
    });
  });
});
