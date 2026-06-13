import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { cleanTestDb, getTestAuth, insertTestSession } from '../setup';

// Regression guard (PR #51): when Claude is the active provider and the
// Anthropic API fails, the AI endpoints must surface HTTP 502 (AiServiceError),
// not a bare 500. The Claude failure path was previously unwrapped and fell
// through to 500. `generateAiText` reads ANTHROPIC_API_KEY at module load, so we
// stub the env and re-import the app to exercise the Claude branch.
describe('AI provider error mapping → 502', () => {
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

  it('returns 502 when the Claude API call fails', async () => {
    await insertTestSession({ id: 's1' });

    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-key');
    // Fail only the Anthropic call; anything else is unexpected in this path.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('api.anthropic.com')) {
          return new Response('upstream overloaded', { status: 529 });
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );

    vi.resetModules();
    const { default: app } = await import('@/app/lib/api-app');

    const res = await app.request('/api/decisions', { headers });

    expect(res.status).toBe(502);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toBe('AI service error');
  });
});
