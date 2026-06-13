import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { cleanTestDb, getTestAuth, insertTestSession } from '../setup';

// Regression guard: Claude Code transcripts nest each turn under `obj.message`
// ({ role, content }) where content may be an array of content blocks. The
// /summary parser used to read `obj.content` (always undefined for that shape),
// collected ZERO turns, and sent an EMPTY user message to Claude — which
// Anthropic rejects with 400 ("messages must have non-empty content") → 502.
// This test asserts the parser now extracts real text and sends non-empty
// content to the model. (generateAiText reads ANTHROPIC_API_KEY at module load,
// so stub the env + re-import the app.)
const CLAUDE_CODE_TRANSCRIPT = [
  JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'Add a logout button to the navbar.' }],
    },
  }),
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Done — added it to Navbar.tsx.' }],
    },
  }),
].join('\n');

describe('GET /api/sessions/:id/summary — Claude Code transcript parsing', () => {
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

  it('sends non-empty content to Claude and returns a summary', async () => {
    await insertTestSession({ id: 's-summary', transcript: CLAUDE_CODE_TRANSCRIPT });

    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-key');

    const captured: { body: unknown } = { body: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('api.anthropic.com')) {
          captured.body = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({ content: [{ type: 'text', text: 'A concise summary.' }] }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          );
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );

    vi.resetModules();
    const { default: app } = await import('@/app/lib/api-app');

    const res = await app.request('/api/sessions/s-summary/summary', { headers });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { summary?: string };
    expect(data.summary).toBe('A concise summary.');

    // The crux of the regression: the user message Orchid sent to Claude must
    // carry the transcript text, never empty content.
    const sent = captured.body as { messages?: Array<{ role: string; content: string }> };
    expect(sent.messages?.length).toBeGreaterThan(0);
    const userMessage = sent.messages?.[0];
    expect(userMessage?.content.trim()).not.toBe('');
    expect(userMessage?.content).toContain('Add a logout button to the navbar.');
    expect(userMessage?.content).toContain('Done — added it to Navbar.tsx.');
  });
});
