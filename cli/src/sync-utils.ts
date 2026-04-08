/**
 * Pure, testable utility functions extracted from the sync command.
 * No side effects, no I/O — just data transformations.
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

// ── Formatting ─────────────────────────────────────────────────────────────

export const formatBytes = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export const formatTokens = (tokens: number): string =>
  tokens === 0 ? "—"
    : tokens < 1000 ? String(tokens)
    : tokens < 1_000_000 ? `${(tokens / 1000).toFixed(0)}k`
    : `${(tokens / 1_000_000).toFixed(1)}M`;

export const formatDate = (iso: string): string => {
  const d = new Date(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
};

export const padRight = (str: string, len: number): string =>
  str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);

export const padLeft = (str: string, len: number): string =>
  str.length >= len ? str.slice(0, len) : " ".repeat(len - str.length) + str;

export const truncate = (str: string, len: number): string =>
  str.length <= len ? str : str.slice(0, len - 1) + "…";

// ── Project key parsing ────────────────────────────────────────────────────

export const humanizeProjectKey = (key: string): string => {
  const match = key.match(/-Developer-/);
  if (match && match.index !== undefined) {
    const afterDev = key.slice(match.index + match[0].length);
    const firstDash = afterDev.indexOf("-");
    return firstDash !== -1
      ? `${afterDev.slice(0, firstDash)}/${afterDev.slice(firstDash + 1)}`
      : afterDev;
  }
  const parts = key.split("-").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join("/") : key;
};

// ── JSONL parsing ──────────────────────────────────────────────────────────

export const tryParseJson = (line: string): Record<string, unknown> | null => {
  try { return JSON.parse(line) as Record<string, unknown>; }
  catch { return null; }
};

export const extractTextContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: { type?: string; text?: string }) =>
        typeof block === "string" ? block
          : block?.type === "text" && typeof block.text === "string" ? block.text : "")
      .filter(Boolean)
      .join(" ");
  }
  return "";
};

export const extractTokensFromUsage = (obj: Record<string, unknown>): number => {
  const usage = (obj.usage || (typeof obj.message === "object" && obj.message !== null
    ? (obj.message as Record<string, unknown>).usage : null)) as Record<string, unknown> | null;
  if (!usage) return 0;
  const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
  const cacheCreate = typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : 0;
  const cacheRead = typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0;
  return input + output + cacheCreate + cacheRead;
};

// ── Grouping ───────────────────────────────────────────────────────────────

export const groupByProject = (sessions: readonly LocalSession[]): readonly ProjectGroup[] => {
  const grouped = sessions.reduce<Record<string, LocalSession[]>>(
    (acc, s) => ({ ...acc, [s.projectKey]: [...(acc[s.projectKey] || []), s] }), {}
  );
  return Object.entries(grouped)
    .map(([key, sess]) => {
      const sorted = [...sess].sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());
      return {
        projectKey: key, projectName: sorted[0].projectName, sessions: sorted,
        totalSize: sorted.reduce((sum, s) => sum + s.fileSize, 0),
        earliest: sorted[sorted.length - 1].firstTimestamp, latest: sorted[0].lastTimestamp,
      };
    })
    .sort((a, b) => new Date(b.latest).getTime() - new Date(a.latest).getTime());
};

// ── Synced state ───────────────────────────────────────────────────────────

export const markSynced = (sessions: readonly LocalSession[], syncedIds: ReadonlySet<string>): readonly LocalSession[] =>
  sessions.map((s) => syncedIds.has(s.sessionId) ? { ...s, synced: true } : s);

export const markGroupSynced = (group: ProjectGroup, syncedIds: ReadonlySet<string>): ProjectGroup => ({
  ...group,
  sessions: markSynced(group.sessions, syncedIds),
});

// ── TUI state ──────────────────────────────────────────────────────────────

export const clamp = (val: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, val));

export const computeScroll = (cursor: number, currentScroll: number, maxVisible: number, total: number): number => {
  const maxScroll = Math.max(0, total - maxVisible);
  if (cursor < currentScroll) return cursor;
  if (cursor >= currentScroll + maxVisible) return Math.min(cursor - maxVisible + 1, maxScroll);
  return Math.min(currentScroll, maxScroll);
};

export const parseKey = (buf: Buffer): string => {
  const hex = buf.toString("hex");
  const ch = buf.toString("utf-8");
  if (hex === "1b5b41" || ch === "k") return "up";
  if (hex === "1b5b42" || ch === "j") return "down";
  if (hex === "0d" || hex === "0a") return "enter";
  if (ch === " ") return "space";
  if (ch === "a") return "select-all";
  if (ch === "s") return "sync";
  if (ch === "g") return "top";
  if (ch === "G") return "bottom";
  if (hex === "1b" || ch === "q") return "back";
  if (hex === "03") return "ctrl-c";
  return "";
};
