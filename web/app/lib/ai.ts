// Typed Claude (Anthropic Messages API) provider.
//
// Raw fetch — deliberately no new npm dependency, mirroring the existing
// OpenAI raw-fetch style in api-app.ts. This keeps pnpm-lock.yaml unchanged so
// CI's --frozen-lockfile install stays green.
//
// Verified against the official docs (platform.claude.com, 2026-06-13):
//   - Endpoint: POST https://api.anthropic.com/v1/messages
//   - Headers: x-api-key, anthropic-version: 2023-06-01, content-type
//   - Body: { model, max_tokens (REQUIRED), system? (top-level string),
//            messages: [{ role, content }], stream? }
//   - Non-streaming response: { content: [{ type:'text', text }, ...] }
//   - Streaming (SSE): content_block_delta events whose delta.type==='text_delta'
//     carry delta.text.
//   - claude-opus-4-8 confirmed as the current, most capable Opus-tier model ID.
//
// PROMPT-INJECTION BOUNDARY: Anthropic's `system` is a separate top-level field,
// never a message. Untrusted transcript / user content is ALWAYS placed in
// `messages` with role 'user'; it must NEVER be routed into `system`.

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// The best available Opus-tier model per project goals.
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-8';

export type ClaudeRole = 'user' | 'assistant';

export interface ClaudeMessage {
  readonly role: ClaudeRole;
  readonly content: string;
}

export interface AskClaudeParams {
  readonly system?: string;
  readonly messages: readonly ClaudeMessage[];
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly apiKey?: string;
}

// Minimal typed views of the Anthropic wire shapes we consume. A content block
// always carries a `type`; text blocks additionally carry `text`.
interface AnthropicContentBlock {
  readonly type: string;
  readonly text?: string;
}

interface AnthropicTextBlock extends AnthropicContentBlock {
  readonly type: 'text';
  readonly text: string;
}

interface AnthropicMessageResponse {
  readonly content?: readonly AnthropicContentBlock[];
}

interface AnthropicStreamDelta {
  readonly type?: string;
  readonly text?: string;
}

interface AnthropicStreamEvent {
  readonly type?: string;
  readonly delta?: AnthropicStreamDelta;
}

const isTextBlock = (block: AnthropicContentBlock): block is AnthropicTextBlock =>
  block.type === 'text' && typeof block.text === 'string';

const resolveApiKey = (explicit?: string): string => {
  const key = explicit ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error('askClaude: ANTHROPIC_API_KEY is not configured');
  }
  return key;
};

// Build the request body. `system` is a top-level string (never a message);
// `temperature` is only included when explicitly provided (Opus-tier models
// reject sampling params, so callers omit it).
const buildRequestBody = (params: AskClaudeParams, stream: boolean): string =>
  JSON.stringify({
    model: params.model ?? DEFAULT_CLAUDE_MODEL,
    max_tokens: params.maxTokens ?? 1024,
    ...(params.system !== undefined ? { system: params.system } : {}),
    messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(stream ? { stream: true } : {}),
  });

const requestHeaders = (apiKey: string): Record<string, string> => ({
  'x-api-key': apiKey,
  'anthropic-version': ANTHROPIC_VERSION,
  'content-type': 'application/json',
});

// Throws a descriptive, typed Error that includes the HTTP status and the
// Anthropic error body — never the API key.
const throwForResponse = async (response: Response): Promise<never> => {
  const body = await response.text().catch(() => '');
  throw new Error(`Anthropic API error ${response.status}: ${body}`);
};

// Non-streaming call. Returns the assembled text — every content block whose
// type === 'text', concatenated in order.
export async function askClaude(params: AskClaudeParams): Promise<string> {
  const apiKey = resolveApiKey(params.apiKey);

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: requestHeaders(apiKey),
    body: buildRequestBody(params, false),
  });

  if (!response.ok) return throwForResponse(response);

  const data = (await response.json()) as AnthropicMessageResponse;
  return (data.content ?? [])
    .filter(isTextBlock)
    .map((block) => block.text)
    .join('');
}

// Splits a streamed text buffer into complete lines, returning the parsed lines
// plus the trailing remainder that has not yet terminated in a newline.
const splitLines = (
  buffer: string,
): { readonly lines: readonly string[]; readonly rest: string } => {
  const parts = buffer.split('\n');
  return { lines: parts.slice(0, -1), rest: parts[parts.length - 1] };
};

// Parse one SSE 'data:' line into a text delta, or null when it carries none.
const textDeltaFromLine = (line: string): string | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice('data:'.length).trim();
  if (payload === '' || payload === '[DONE]') return null;
  try {
    const event = JSON.parse(payload) as AnthropicStreamEvent;
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      return event.delta.text ?? '';
    }
  } catch {
    // Ignore non-JSON keepalive / comment lines.
  }
  return null;
};

// Yield text deltas from a batch of newly-available lines.
function* deltasFromLines(lines: readonly string[]): Generator<string, void, void> {
  const deltas = lines.map(textDeltaFromLine).filter((t): t is string => t !== null);
  yield* deltas;
}

// Streaming call. Yields text deltas as they arrive over Server-Sent Events.
// Provided for future streaming use; the P0-2 endpoints remain non-streaming.
export async function* streamClaude(params: AskClaudeParams): AsyncIterable<string> {
  const apiKey = resolveApiKey(params.apiKey);

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: requestHeaders(apiKey),
    body: buildRequestBody(params, true),
  });

  if (!response.ok) {
    await throwForResponse(response);
    return;
  }
  if (!response.body) {
    throw new Error('Anthropic API error: streaming response had no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  // Recursive (no-mutation) drain: each step carries the leftover partial line
  // forward as an argument rather than reassigning a buffer variable.
  const drain = async function* (carry: string): AsyncGenerator<string, void, void> {
    const { value, done } = await reader.read();
    const chunk = value ? decoder.decode(value, { stream: true }) : '';
    const { lines, rest } = splitLines(carry + chunk);
    yield* deltasFromLines(lines);
    if (done) {
      if (rest.trim() !== '') yield* deltasFromLines([rest]);
      return;
    }
    yield* drain(rest);
  };

  yield* drain('');
}
