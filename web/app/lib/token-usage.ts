/**
 * Parse persisted token totals from a Claude Code JSONL transcript.
 *
 * Each assistant turn carries a `usage` object (either top-level or nested
 * under `message.usage`). Cache creation/read tokens are input-side, so they
 * fold into inputTokens — keeping `inputTokens + outputTokens` equal to the
 * CLI TUI's totalTokens. Mirrors `cli/src/sync-utils.ts` so the server can
 * recompute totals (PUT fallback + backfill) when the CLI doesn't send them.
 */

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export const ZERO_TOKEN_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

interface UsageShape {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

interface TranscriptLine {
  readonly usage?: UsageShape;
  readonly message?: { readonly usage?: UsageShape };
}

const asNumber = (value: number | undefined): number => (typeof value === 'number' ? value : 0);

// Split one transcript line's `usage` into input/output totals.
const splitTokensFromLine = (line: TranscriptLine): TokenUsage => {
  const usage = line.usage ?? line.message?.usage;
  if (!usage) return ZERO_TOKEN_USAGE;
  return {
    inputTokens:
      asNumber(usage.input_tokens) +
      asNumber(usage.cache_creation_input_tokens) +
      asNumber(usage.cache_read_input_tokens),
    outputTokens: asNumber(usage.output_tokens),
  };
};

const tryParseLine = (line: string): TranscriptLine | null => {
  try {
    return JSON.parse(line) as TranscriptLine;
  } catch {
    return null;
  }
};

// Reduce a raw JSONL transcript string into input/output token totals.
export const tokenUsageFromTranscript = (transcript: string): TokenUsage =>
  transcript
    .split('\n')
    .filter((l) => l.trim())
    .map(tryParseLine)
    .filter((line): line is TranscriptLine => line !== null)
    .reduce<TokenUsage>((acc, line) => {
      const { inputTokens, outputTokens } = splitTokensFromLine(line);
      return {
        inputTokens: acc.inputTokens + inputTokens,
        outputTokens: acc.outputTokens + outputTokens,
      };
    }, ZERO_TOKEN_USAGE);
