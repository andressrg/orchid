import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
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

// The Stop hook sends status:'done' on every stop, and `orchid sync` re-sends
// 'done' on each run, so the PUT /sessions/:id handler receives many redundant
// 'done' calls for one finished session. The auto-summary after() task must be
// idempotent: once a summary is stored, a later 'done' PUT must NOT fire a fresh
// Claude call (recurring cost) and must NOT overwrite the stored text (the
// temperature-0.3 re-roll would silently change the dashboard summary).
describe('PUT /api/sessions/:id — auto-summary does not re-roll once stored', () => {
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

  it('skips the AI call and preserves the stored summary on a redundant done PUT', async () => {
    const { userId } = await getTestAuth();
    const STORED_SUMMARY = 'Implemented the auto-summary feature and added cache-hit tests.';

    await testDb.insert(orchidSession).values({
      id: 's-redundant-done',
      userName: 'testuser',
      userEmail: 'test@example.com',
      transcript: '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi there"}',
      status: 'done',
      summary: STORED_SUMMARY,
      userId,
    });

    // AI is configured. The after() task runs inline in tests (no Next request
    // context), so we can observe whether it tried to call the provider. The
    // gate must short-circuit before any fetch — the after() error path swallows
    // throws, so asserting the mock was never called is what actually catches a
    // regression (a thrown fetch alone would not fail the request).
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-key');
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      throw new Error(`unexpected AI fetch to ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    vi.resetModules();
    const { default: app } = await import('@/app/lib/api-app');

    const res = await app.request('/api/sessions/s-redundant-done', {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        user_name: 'testuser',
        user_email: 'test@example.com',
        working_dir: '/home/test',
        git_remotes: [],
        branch: 'main',
        tool: 'claude',
        transcript: '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi there"}',
        status: 'done',
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { summary?: string };
    expect(data.summary).toBe(STORED_SUMMARY);

    // No provider call was attempted (no recurring cost on redundant 'done').
    expect(mockFetch).not.toHaveBeenCalled();

    // The persisted row still carries the original summary, untouched.
    const [row] = await testDb
      .select({ summary: orchidSession.summary })
      .from(orchidSession)
      .where(eq(orchidSession.id, 's-redundant-done'));
    expect(row.summary).toBe(STORED_SUMMARY);
  });
});
