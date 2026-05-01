export type SourceTool = 'claude-code' | 'codex-cli';

export type TranscriptFormat = 'claude-jsonl' | 'codex-rollout-jsonl';

export type TranscriptRole = 'user' | 'assistant' | 'tool' | 'system';

export interface TranscriptTurn {
  readonly role: TranscriptRole;
  readonly text: string;
  readonly timestamp: string | null;
  readonly sourceTool: SourceTool;
  readonly rawType: string;
  readonly rawRole: string | null;
  readonly callId: string | null;
}

export interface TranscriptMetadata {
  readonly id: string | null;
  readonly cwd: string | null;
  readonly branch: string | null;
  readonly timestamp: string | null;
  readonly model: string | null;
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
type JsonRecord = { readonly [key: string]: JsonValue };

const asRecord = (value: JsonValue | undefined): JsonRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const asArray = (value: JsonValue | undefined): readonly JsonValue[] =>
  Array.isArray(value) ? value : [];

const asString = (value: JsonValue | undefined): string | null =>
  typeof value === 'string' ? value : null;

const parseJsonLine = (line: string): JsonRecord | null => {
  try {
    return asRecord(JSON.parse(line) as JsonValue);
  } catch {
    return null;
  }
};

const compactWhitespace = (text: string): string =>
  text.replace(/\s+/g, ' ').trim();

const extractTextContent = (content: JsonValue | undefined): string => {
  const direct = asString(content);
  if (direct !== null) return direct;

  return asArray(content)
    .map((block) => {
      const directBlock = asString(block);
      const record = asRecord(block);
      const text = record ? asString(record.text) : null;
      return directBlock ?? text ?? '';
    })
    .filter((text) => text.length > 0)
    .join('\n');
};

const truncateToolText = (text: string): string =>
  text.length > 2000 ? `${text.slice(0, 2000)}\n[truncated]` : text;

const parseArguments = (argumentsText: string | null): JsonRecord | null => {
  if (argumentsText === null) return null;
  try {
    return asRecord(JSON.parse(argumentsText) as JsonValue);
  } catch {
    return null;
  }
};

const renderFunctionCall = (payload: JsonRecord): string => {
  const name = asString(payload.name) ?? 'tool';
  const args = parseArguments(asString(payload.arguments));
  const command = args ? asString(args.cmd) : null;
  return command
    ? `$ ${command}`
    : compactWhitespace(`${name} ${asString(payload.arguments) ?? ''}`);
};

const responseItemPayload = (entry: JsonRecord): JsonRecord | null =>
  entry.type === 'response_item' ? asRecord(entry.payload) : null;

const eventPayload = (entry: JsonRecord): JsonRecord | null =>
  entry.type === 'event_msg' ? asRecord(entry.payload) : null;

const parseCodexTurn = (entry: JsonRecord): TranscriptTurn | null => {
  const timestamp = asString(entry.timestamp);
  const event = eventPayload(entry);
  const eventType = event ? asString(event.type) : null;

  if (eventType === 'user_message') {
    const text =
      asString(event?.message) ??
      asArray(event?.text_elements)
        .map((item) => asString(item) ?? '')
        .filter(Boolean)
        .join('\n');
    return text
      ? {
          role: 'user',
          text,
          timestamp,
          sourceTool: 'codex-cli',
          rawType: 'event_msg.user_message',
          rawRole: 'user',
          callId: null,
        }
      : null;
  }

  if (eventType === 'agent_message') {
    const text = asString(event?.message);
    return text
      ? {
          role: 'assistant',
          text,
          timestamp,
          sourceTool: 'codex-cli',
          rawType: 'event_msg.agent_message',
          rawRole: 'assistant',
          callId: null,
        }
      : null;
  }

  const payload = responseItemPayload(entry);
  const payloadType = payload ? asString(payload.type) : null;
  const payloadRole = payload ? asString(payload.role) : null;

  if (payload && payloadType === 'function_call') {
    const text = renderFunctionCall(payload);
    return text
      ? {
          role: 'tool',
          text,
          timestamp,
          sourceTool: 'codex-cli',
          rawType: 'response_item.function_call',
          rawRole: null,
          callId: asString(payload.call_id),
        }
      : null;
  }

  if (payload && payloadType === 'function_call_output') {
    const text = truncateToolText(extractTextContent(payload.output));
    return text
      ? {
          role: 'tool',
          text,
          timestamp,
          sourceTool: 'codex-cli',
          rawType: 'response_item.function_call_output',
          rawRole: null,
          callId: asString(payload.call_id),
        }
      : null;
  }

  if (
    payload &&
    payloadType === 'message' &&
    (payloadRole === 'assistant' || payloadRole === 'user')
  ) {
    const text = extractTextContent(payload.content);
    return text
      ? {
          role: payloadRole,
          text,
          timestamp,
          sourceTool: 'codex-cli',
          rawType: 'response_item.message',
          rawRole: payloadRole,
          callId: null,
        }
      : null;
  }

  return null;
};

const parseClaudeTurn = (entry: JsonRecord): TranscriptTurn | null => {
  const message = asRecord(entry.message);
  const rawRole =
    asString(entry.role) ?? asString(message?.role) ?? asString(entry.type);
  const role =
    entry.type === 'human' || rawRole === 'human' || rawRole === 'user'
      ? 'user'
      : entry.type === 'assistant' || rawRole === 'assistant'
        ? 'assistant'
        : null;

  if (role === null) return null;

  const text = extractTextContent(entry.content ?? message?.content);
  return text
    ? {
        role,
        text,
        timestamp: asString(entry.timestamp),
        sourceTool: 'claude-code',
        rawType: asString(entry.type) ?? 'message',
        rawRole,
        callId: null,
      }
    : null;
};

const meaningfulTurnKey = (turn: TranscriptTurn): string =>
  `${turn.role}:${compactWhitespace(turn.text).slice(0, 500)}`;

const shouldPreferCodexTurn = (turn: TranscriptTurn): boolean =>
  turn.rawType === 'event_msg.user_message' ||
  turn.rawType === 'event_msg.agent_message' ||
  turn.role === 'tool';

const dedupeCodexTurns = (
  turns: readonly TranscriptTurn[],
): readonly TranscriptTurn[] =>
  turns.reduce<readonly TranscriptTurn[]>((acc, turn) => {
    const key = meaningfulTurnKey(turn);
    const existingIndex = acc.findIndex(
      (existing) => meaningfulTurnKey(existing) === key,
    );
    if (existingIndex === -1) return [...acc, turn];
    if (!shouldPreferCodexTurn(turn)) return acc;
    return acc.map((existing, index) =>
      index === existingIndex ? turn : existing,
    );
  }, []);

const detectTranscriptFormat = (
  entries: readonly JsonRecord[],
): TranscriptFormat =>
  entries.some(
    (entry) =>
      entry.type === 'session_meta' ||
      entry.type === 'event_msg' ||
      entry.type === 'response_item',
  )
    ? 'codex-rollout-jsonl'
    : 'claude-jsonl';

export const parseTranscriptTurns = (params: {
  readonly transcript: string;
  readonly format?: TranscriptFormat;
}): readonly TranscriptTurn[] => {
  const entries = params.transcript
    .split('\n')
    .filter((line) => line.trim())
    .map(parseJsonLine)
    .filter((entry): entry is JsonRecord => entry !== null);
  const format = params.format ?? detectTranscriptFormat(entries);
  const turns = entries
    .map(format === 'codex-rollout-jsonl' ? parseCodexTurn : parseClaudeTurn)
    .filter((turn): turn is TranscriptTurn => turn !== null);
  return format === 'codex-rollout-jsonl' ? dedupeCodexTurns(turns) : turns;
};

export const summarizeTranscriptMetadata = (params: {
  readonly transcript: string;
  readonly format?: TranscriptFormat;
}): TranscriptMetadata => {
  const entries = params.transcript
    .split('\n')
    .filter((line) => line.trim())
    .map(parseJsonLine)
    .filter((entry): entry is JsonRecord => entry !== null);
  const sessionMeta = entries
    .map((entry) =>
      entry.type === 'session_meta' ? asRecord(entry.payload) : null,
    )
    .find((payload) => payload !== null);
  const turnContext = entries
    .map((entry) =>
      entry.type === 'turn_context' ? asRecord(entry.payload) : null,
    )
    .find((payload) => payload !== null);
  const git = sessionMeta ? asRecord(sessionMeta.git) : null;
  return {
    id: sessionMeta ? asString(sessionMeta.id) : null,
    cwd:
      (sessionMeta ? asString(sessionMeta.cwd) : null) ??
      (turnContext ? asString(turnContext.cwd) : null),
    branch: git ? asString(git.branch) : null,
    timestamp: sessionMeta ? asString(sessionMeta.timestamp) : null,
    model:
      (turnContext ? asString(turnContext.model) : null) ??
      (sessionMeta ? asString(sessionMeta.model) : null),
  };
};

export const countMeaningfulTranscriptTurns = (
  transcript: string,
  format?: TranscriptFormat,
): number =>
  parseTranscriptTurns({ transcript, format }).filter(
    (turn) => turn.role === 'user' || turn.role === 'assistant',
  ).length;
