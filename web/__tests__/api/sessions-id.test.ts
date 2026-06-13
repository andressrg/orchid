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

    it('persists input/output token totals sent by the CLI', async () => {
      const body = {
        user_name: 'alice',
        user_email: 'alice@example.com',
        working_dir: '/home/alice',
        git_remotes: [],
        branch: 'main',
        tool: 'claude',
        transcript: '{"role":"user","content":"test"}',
        status: 'done',
        input_tokens: 12345,
        output_tokens: 6789,
      };

      const res = await app.request('/api/sessions/with-tokens', {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.input_tokens).toBe(12345);
      expect(data.output_tokens).toBe(6789);

      // Readable back via GET and the list endpoint (queryable for the metric).
      // GET /:id returns the row via Drizzle's default select (camelCase keys).
      const getRes = await app.request('/api/sessions/with-tokens', { headers });
      const getData = await getRes.json();
      expect(getData.inputTokens ?? getData.input_tokens).toBe(12345);
      expect(getData.outputTokens ?? getData.output_tokens).toBe(6789);

      const listRes = await app.request('/api/sessions', { headers });
      const listData = await listRes.json();
      const listed = listData.find((s: { id: string }) => s.id === 'with-tokens');
      expect(listed.input_tokens).toBe(12345);
      expect(listed.output_tokens).toBe(6789);
    });

    it('derives token totals from the transcript when not sent (backfill path)', async () => {
      const transcript = [
        '{"type":"user","content":"hi"}',
        '{"type":"assistant","usage":{"input_tokens":100,"output_tokens":40,"cache_read_input_tokens":10}}',
        '{"type":"assistant","message":{"usage":{"input_tokens":5,"output_tokens":2}}}',
      ].join('\n');

      const res = await app.request('/api/sessions/derived-tokens', {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          user_name: 'bob',
          user_email: 'bob@example.com',
          working_dir: '/home/bob',
          git_remotes: [],
          branch: 'main',
          tool: 'claude',
          transcript,
          status: 'done',
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      // input_tokens folds cache: 100 + 10 + 5 = 115; output: 40 + 2 = 42
      expect(data.input_tokens).toBe(115);
      expect(data.output_tokens).toBe(42);
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
