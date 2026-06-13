/**
 * Pure, testable utility functions for the sync command.
 * No side effects, no I/O — just data transformations.
 *
 * Naming: functions describe what they do at the call site.
 * Multi-param domain functions take objects for clarity.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface LocalSession {
  readonly filePath: string | null;
  readonly sessionId: string;
  readonly projectKey: string;
  readonly projectName: string;
  readonly cwd: string;
  readonly gitBranch: string;
  readonly firstTimestamp: string;
  readonly lastTimestamp: string;
  readonly fileSize: number;
  readonly messageCount: number;
  readonly totalTokens: number;
  readonly summary: string;
  readonly synced: boolean;
}

export interface ProjectGroup {
  readonly projectName: string;
  readonly projectKey: string;
  readonly sessions: readonly LocalSession[];
  readonly totalSize: number;
  readonly earliest: string;
  readonly latest: string;
}

export interface ScrollState {
  readonly cursor: number;
  readonly scroll: number;
  readonly maxVisible: number;
  readonly total: number;
}

// ── Display formatting (value → display string) ───────────────────────────

export const displayFileSize = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export const displayTokenCount = (tokens: number): string =>
  tokens === 0
    ? '—'
    : tokens < 1000
      ? String(tokens)
      : tokens < 1_000_000
        ? `${(tokens / 1000).toFixed(0)}k`
        : `${(tokens / 1_000_000).toFixed(1)}M`;

export const displayShortDate = (iso: string): string => {
  const d = new Date(iso);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[d.getMonth()]} ${d.getDate()}`;
};

// ── String layout helpers ──────────────────────────────────────────────────

export const padRight = (str: string, len: number): string =>
  str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);

export const padLeft = (str: string, len: number): string =>
  str.length >= len ? str.slice(0, len) : ' '.repeat(len - str.length) + str;

export const truncate = (str: string, len: number): string =>
  str.length <= len ? str : str.slice(0, len - 1) + '…';

// ── Project key → display name ─────────────────────────────────────────────

export const projectKeyToName = (key: string): string => {
  const match = key.match(/-Developer-/);
  if (match && match.index !== undefined) {
    const afterDev = key.slice(match.index + match[0].length);
    const firstDash = afterDev.indexOf('-');
    return firstDash !== -1
      ? `${afterDev.slice(0, firstDash)}/${afterDev.slice(firstDash + 1)}`
      : afterDev;
  }
  const parts = key.split('-').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('/') : key;
};

// ── JSONL parsing ──────────────────────────────────────────────────────────

export const tryParseJson = (line: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const extractMessageText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block: { type?: string; text?: string }) =>
        typeof block === 'string'
          ? block
          : block?.type === 'text' && typeof block.text === 'string'
            ? block.text
            : '',
      )
      .filter(Boolean)
      .join(' ');
  }
  return '';
};

// Input vs output token split parsed from a single transcript line's `usage`.
// Cache creation/read tokens are input-side, so they fold into inputTokens.
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export const ZERO_TOKEN_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

// Split one transcript object's `usage` into input/output totals. Reads either a
// top-level `usage` or a nested `message.usage` (Claude Code shape).
export const splitTokensFromUsage = (
  obj: Record<string, unknown>,
): TokenUsage => {
  const usage = (obj.usage ||
    (typeof obj.message === 'object' && obj.message !== null
      ? (obj.message as Record<string, unknown>).usage
      : null)) as Record<string, unknown> | null;
  if (!usage) return ZERO_TOKEN_USAGE;
  const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
  const cacheCreate =
    typeof usage.cache_creation_input_tokens === 'number'
      ? usage.cache_creation_input_tokens
      : 0;
  const cacheRead =
    typeof usage.cache_read_input_tokens === 'number'
      ? usage.cache_read_input_tokens
      : 0;
  const output =
    typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
  return { inputTokens: input + cacheCreate + cacheRead, outputTokens: output };
};

export const sumTokensFromUsage = (obj: Record<string, unknown>): number => {
  const { inputTokens, outputTokens } = splitTokensFromUsage(obj);
  return inputTokens + outputTokens;
};

// Reduce parsed transcript lines into persisted input/output token totals.
export const sumTokenUsageFromTranscript = (
  parsed: readonly Record<string, unknown>[],
): TokenUsage =>
  parsed.reduce<TokenUsage>((acc, obj) => {
    const { inputTokens, outputTokens } = splitTokensFromUsage(obj);
    return {
      inputTokens: acc.inputTokens + inputTokens,
      outputTokens: acc.outputTokens + outputTokens,
    };
  }, ZERO_TOKEN_USAGE);

// Parse a raw JSONL transcript string straight into input/output token totals.
// Used by the live sync watcher, which holds the full transcript text in memory.
export const tokenUsageFromTranscriptText = (transcript: string): TokenUsage =>
  sumTokenUsageFromTranscript(
    transcript
      .split('\n')
      .filter((l) => l.trim())
      .map(tryParseJson)
      .filter((obj): obj is Record<string, unknown> => obj !== null),
  );

// ── Session grouping ───────────────────────────────────────────────────────

export const groupSessionsByProject = (
  sessions: readonly LocalSession[],
): readonly ProjectGroup[] => {
  const grouped = sessions.reduce<Record<string, LocalSession[]>>(
    (acc, s) => ({ ...acc, [s.projectKey]: [...(acc[s.projectKey] || []), s] }),
    {},
  );
  return Object.entries(grouped)
    .map(([key, sess]) => {
      const sorted = [...sess].sort(
        (a, b) =>
          new Date(b.lastTimestamp).getTime() -
          new Date(a.lastTimestamp).getTime(),
      );
      return {
        projectKey: key,
        projectName: sorted[0].projectName,
        sessions: sorted,
        totalSize: sorted.reduce((sum, s) => sum + s.fileSize, 0),
        earliest: sorted[sorted.length - 1].firstTimestamp,
        latest: sorted[0].lastTimestamp,
      };
    })
    .sort(
      (a, b) => new Date(b.latest).getTime() - new Date(a.latest).getTime(),
    );
};

// ── Synced state (immutable updates) ───────────────────────────────────────

export const markSessionsSynced = (params: {
  readonly sessions: readonly LocalSession[];
  readonly syncedIds: ReadonlySet<string>;
}): readonly LocalSession[] =>
  params.sessions.map((s) =>
    params.syncedIds.has(s.sessionId) ? { ...s, synced: true } : s,
  );

export const markGroupSessionsSynced = (params: {
  readonly group: ProjectGroup;
  readonly syncedIds: ReadonlySet<string>;
}): ProjectGroup => ({
  ...params.group,
  sessions: markSessionsSynced({
    sessions: params.group.sessions,
    syncedIds: params.syncedIds,
  }),
});

// ── TUI state ──────────────────────────────────────────────────────────────

export const clamp = (val: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, val));

export const computeScrollOffset = (state: ScrollState): number => {
  const maxScroll = Math.max(0, state.total - state.maxVisible);
  if (state.cursor < state.scroll) return state.cursor;
  if (state.cursor >= state.scroll + state.maxVisible)
    return Math.min(state.cursor - state.maxVisible + 1, maxScroll);
  return Math.min(state.scroll, maxScroll);
};

export const parseKeypress = (buf: Buffer): string => {
  const hex = buf.toString('hex');
  const ch = buf.toString('utf-8');
  if (hex === '1b5b41' || ch === 'k') return 'up';
  if (hex === '1b5b42' || ch === 'j') return 'down';
  if (hex === '0d' || hex === '0a') return 'enter';
  if (ch === ' ') return 'space';
  if (ch === 'a') return 'select-all';
  if (ch === 's') return 'sync';
  if (ch === 'g') return 'top';
  if (ch === 'G') return 'bottom';
  if (hex === '1b' || ch === 'q') return 'back';
  if (hex === '03') return 'ctrl-c';
  return '';
};
