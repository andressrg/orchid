import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { cleanTestDb, getTestAuth, testDb } from '../setup';
import { orchidSession } from '@/app/lib/schema';

// P3-1: a session's summary is generated + persisted on session end, so the
// viewer renders it instantly. This guards the cache-read path of the
// GET /api/sessions/:id/summary endpoint: when a row already carries a stored
// `summary`, the endpoint returns it directly — WITHOUT calling Claude — so it
// works even when AI is unconfigured. (generateAiText reads ANTHROPIC_API_KEY
// at module load; we leave it unset and assert no model fetch is made.)
describe('GET /api/sessions/:id/summary — persisted-summary cache hit', () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    headers = (await getTestAuth()).headers;
  });

  beforeEach(async () => {
    await cleanTestDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('returns the stored summary without an AI call', async () => {
    const { userId } = await getTestAuth();
    const STORED_SUMMARY = 'Added a logout button to the navbar and shipped it.';

    await testDb.insert(orchidSession).values({
      id: 's-cached-summary',
      userName: 'testuser',
      userEmail: 'test@example.com',
      transcript: '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi there"}',
      status: 'done',
      summary: STORED_SUMMARY,
      userId,
    });

    // AI is configured here, but a cache hit must NOT reach the model. Any fetch
    // to the provider would throw and fail the test.
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        throw new Error(`unexpected AI fetch to ${url}`);
      }),
    );

    vi.resetModules();
    const { default: app } = await import('@/app/lib/api-app');

    const res = await app.request('/api/sessions/s-cached-summary/summary', { headers });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { summary?: string };
    expect(data.summary).toBe(STORED_SUMMARY);
  });
});
