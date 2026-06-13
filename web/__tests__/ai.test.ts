import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { askClaude, streamClaude, DEFAULT_CLAUDE_MODEL } from '@/app/lib/ai';

// ---------------------------------------------------------------------------
// Helpers for fabricating Anthropic-shaped responses without real network I/O.
// ---------------------------------------------------------------------------

interface CapturedCall {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

const jsonResponse = (payload: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }) as unknown as Response;

const errorResponse = (status: number, body: string): Response =>
  ({
    ok: false,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  }) as unknown as Response;

// Build a ReadableStream that emits the given SSE chunks as UTF-8 bytes.
const sseResponse = (chunks: readonly string[]): Response => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream } as unknown as Response;
};

const captureCall = (input: RequestInfo | URL, init?: RequestInit): CapturedCall => ({
  url: String(input),
  headers: (init?.headers ?? {}) as Record<string, string>,
  body: JSON.parse(String(init?.body)) as Record<string, unknown>,
});

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

describe('askClaude', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it('targets the Anthropic Messages endpoint with the required headers', async () => {
    const captured: CapturedCall[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        captured.push(captureCall(input, init));
        return Promise.resolve(jsonResponse({ content: [{ type: 'text', text: 'hi' }] }));
      }),
    );

    await askClaude({ messages: [{ role: 'user', content: 'hello' }] });

    expect(captured).toHaveLength(1);
    const call = captured[0];
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.headers['x-api-key']).toBe('test-anthropic-key');
    expect(call.headers['anthropic-version']).toBe('2023-06-01');
    expect(call.headers['content-type']).toBe('application/json');
  });

  it('sends system as a top-level field (NOT a message) and preserves message roles', async () => {
    const captured: CapturedCall[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        captured.push(captureCall(input, init));
        return Promise.resolve(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }));
      }),
    );

    await askClaude({
      system: 'You are a careful assistant.',
      messages: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'second question' },
      ],
      maxTokens: 321,
    });

    const body = captured[0].body;
    // system is a top-level string, never present in messages.
    expect(body.system).toBe('You are a careful assistant.');
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages.some((m) => m.role === 'system')).toBe(false);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[2].content).toBe('second question');
    // max_tokens is required and forwarded.
    expect(body.max_tokens).toBe(321);
  });

  it('applies the default model when none is given, and respects an override', async () => {
    const captured: CapturedCall[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        captured.push(captureCall(input, init));
        return Promise.resolve(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }));
      }),
    );

    await askClaude({ messages: [{ role: 'user', content: 'a' }] });
    await askClaude({ messages: [{ role: 'user', content: 'b' }], model: 'claude-sonnet-4-6' });

    expect(DEFAULT_CLAUDE_MODEL).toBe('claude-opus-4-8');
    expect(captured[0].body.model).toBe('claude-opus-4-8');
    expect(captured[1].body.model).toBe('claude-sonnet-4-6');
  });

  it('assembles text from multiple content blocks, skipping non-text blocks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            content: [
              { type: 'text', text: 'Hello' },
              { type: 'tool_use', id: 'toolu_1', name: 'x', input: {} },
              { type: 'text', text: ', world' },
            ],
          }),
        ),
      ),
    );

    const result = await askClaude({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result).toBe('Hello, world');
  });

  it('does not forward temperature unless explicitly provided', async () => {
    const captured: CapturedCall[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        captured.push(captureCall(input, init));
        return Promise.resolve(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }));
      }),
    );

    await askClaude({ messages: [{ role: 'user', content: 'a' }] });
    expect('temperature' in captured[0].body).toBe(false);

    await askClaude({ messages: [{ role: 'user', content: 'a' }], temperature: 0.3 });
    expect(captured[1].body.temperature).toBe(0.3);
  });

  it('throws a descriptive error including the HTTP status and body on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          errorResponse(
            400,
            '{"type":"error","error":{"type":"invalid_request_error","message":"bad"}}',
          ),
        ),
      ),
    );

    await expect(askClaude({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      /Anthropic API error 400/,
    );
  });

  it('never leaks the API key in a thrown error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(errorResponse(401, '{"error":"nope"}'))),
    );

    const error = await askClaude({ messages: [{ role: 'user', content: 'x' }] }).catch((e) => e);
    expect(String(error)).not.toContain('test-anthropic-key');
  });

  it('throws when no API key is configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.stubGlobal('fetch', vi.fn());
    await expect(askClaude({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });
});

describe('streamClaude', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it('sets stream:true in the request body', async () => {
    const captured: CapturedCall[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        captured.push(captureCall(input, init));
        return Promise.resolve(
          sseResponse(['event: message_stop\ndata: {"type":"message_stop"}\n\n']),
        );
      }),
    );

    // Drain the iterator.
    const collected: string[] = [];
    for await (const delta of streamClaude({ messages: [{ role: 'user', content: 'hi' }] })) {
      collected.push(delta);
    }

    expect(captured[0].body.stream).toBe(true);
  });

  it('assembles text deltas from SSE content_block_delta events', async () => {
    // Split deltas across chunk boundaries to exercise the line buffering.
    const chunks = [
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}\n\n',
      // A non-text delta that must be ignored.
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"!"}}\n\n',
      'data: [DONE]\n\n',
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sseResponse(chunks))),
    );

    const collected: string[] = [];
    for await (const delta of streamClaude({ messages: [{ role: 'user', content: 'hi' }] })) {
      collected.push(delta);
    }

    expect(collected.join('')).toBe('Hello!');
  });

  it('throws a descriptive error on a non-2xx streaming response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(errorResponse(529, '{"error":"overloaded"}'))),
    );

    const run = async (): Promise<void> => {
      for await (const _delta of streamClaude({ messages: [{ role: 'user', content: 'x' }] })) {
        void _delta;
      }
    };
    await expect(run()).rejects.toThrow(/Anthropic API error 529/);
  });
});
