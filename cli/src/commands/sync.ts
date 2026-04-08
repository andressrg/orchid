import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { getConfig, getAuthHeaders, tryGetConfig } from "../config";

// ── Types ──────────────────────────────────────────────────────────────────

interface LocalSession {
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

interface ProjectGroup {
  readonly projectName: string;
  readonly projectKey: string;
  readonly sessions: readonly LocalSession[];
  readonly totalSize: number;
  readonly earliest: string;
  readonly latest: string;
}

interface SyncResult {
  readonly synced: number;
  readonly failed: number;
  readonly skipped: number;
  readonly syncedIds: ReadonlySet<string>;
}

interface SessionIndexEntry {
  readonly sessionId: string;
  readonly fullPath: string;
  readonly firstPrompt?: string;
  readonly summary?: string;
  readonly messageCount?: number;
  readonly created?: string;
  readonly modified?: string;
  readonly gitBranch?: string;
  readonly projectPath?: string;
}

interface SessionIndex {
  readonly version: number;
  readonly entries: readonly SessionIndexEntry[];
  readonly originalPath?: string;
}

// ── ANSI helpers ───────────────────────────────────────────────────────────

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

const formatBytes = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const formatTokens = (tokens: number): string =>
  tokens === 0 ? "—"
    : tokens < 1000 ? String(tokens)
    : tokens < 1_000_000 ? `${(tokens / 1000).toFixed(0)}k`
    : `${(tokens / 1_000_000).toFixed(1)}M`;

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
};

const padRight = (str: string, len: number): string =>
  str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);

const padLeft = (str: string, len: number): string =>
  str.length >= len ? str.slice(0, len) : " ".repeat(len - str.length) + str;

const truncate = (str: string, len: number): string =>
  str.length <= len ? str : str.slice(0, len - 1) + "…";

const humanizeProjectKey = (key: string): string => {
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

// ── Discovery ──────────────────────────────────────────────────────────────

const tryParseJson = (line: string): Record<string, unknown> | null => {
  try { return JSON.parse(line) as Record<string, unknown>; }
  catch { return null; }
};

const extractTextContent = (content: unknown): string => {
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

const extractTokensFromUsage = (obj: Record<string, unknown>): number => {
  const usage = (obj.usage || (typeof obj.message === "object" && obj.message !== null
    ? (obj.message as Record<string, unknown>).usage : null)) as Record<string, unknown> | null;
  if (!usage) return 0;
  const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
  const cacheCreate = typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : 0;
  const cacheRead = typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0;
  return input + output + cacheCreate + cacheRead;
};

const extractMetadataFromJsonl = (
  filePath: string
): Omit<LocalSession, "filePath" | "fileSize" | "projectKey" | "projectName" | "synced"> | null => {
  const fd = (() => { try { return fs.openSync(filePath, "r"); } catch { return null; } })();
  if (fd === null) return null;

  const buf = Buffer.alloc(32 * 1024);
  const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);

  const parsed = buf.toString("utf-8", 0, bytesRead).split("\n").filter((l) => l.trim())
    .map(tryParseJson).filter((obj): obj is Record<string, unknown> => obj !== null);

  const meta = parsed.reduce<{
    sessionId: string; cwd: string; gitBranch: string;
    firstTimestamp: string; messageCount: number; totalTokens: number; firstUserMessage: string;
  }>(
    (acc, obj) => {
      const isUserMsg = obj.type === "user" || obj.type === "human";
      const userText = isUserMsg && !acc.firstUserMessage
        ? extractTextContent((obj as Record<string, unknown>).message
            ? ((obj as Record<string, unknown>).message as Record<string, unknown>).content
            : obj.content)
        : "";
      return {
        sessionId: acc.sessionId || (obj.sessionId as string) || "",
        cwd: acc.cwd || (obj.cwd as string) || "",
        gitBranch: acc.gitBranch || (obj.gitBranch as string) || "",
        firstTimestamp: acc.firstTimestamp || (obj.timestamp as string) || "",
        messageCount: acc.messageCount + (isUserMsg || obj.type === "assistant" ? 1 : 0),
        totalTokens: acc.totalTokens + extractTokensFromUsage(obj),
        firstUserMessage: acc.firstUserMessage || userText,
      };
    },
    { sessionId: "", cwd: "", gitBranch: "", firstTimestamp: "", messageCount: 0, totalTokens: 0, firstUserMessage: "" }
  );

  const sessionId = meta.sessionId || path.basename(filePath, ".jsonl");
  const fileSize = fs.statSync(filePath).size;
  const estimatedMessages = meta.messageCount > 0 && bytesRead > 0
    ? Math.round((meta.messageCount / bytesRead) * fileSize) : meta.messageCount;
  const estimatedTokens = meta.totalTokens > 0 && bytesRead > 0
    ? Math.round((meta.totalTokens / bytesRead) * fileSize) : meta.totalTokens;
  const lastTimestamp = (() => {
    try { return fs.statSync(filePath).mtime.toISOString(); }
    catch { return meta.firstTimestamp; }
  })();
  const summary = meta.firstUserMessage.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

  return {
    sessionId, cwd: meta.cwd || "unknown", gitBranch: meta.gitBranch || "unknown",
    firstTimestamp: meta.firstTimestamp || new Date().toISOString(),
    lastTimestamp: lastTimestamp || meta.firstTimestamp || new Date().toISOString(),
    messageCount: estimatedMessages, totalTokens: estimatedTokens, summary,
  };
};

const readSessionIndex = (indexPath: string): SessionIndex | null => {
  try { return JSON.parse(fs.readFileSync(indexPath, "utf-8")) as SessionIndex; }
  catch { return null; }
};

const indexEntryToSession = (entry: SessionIndexEntry, projectKey: string, projectName: string, synced: boolean): LocalSession => ({
  filePath: fs.existsSync(entry.fullPath) ? entry.fullPath : null,
  sessionId: entry.sessionId, projectKey, projectName,
  cwd: entry.projectPath || "unknown",
  gitBranch: entry.gitBranch || "unknown",
  firstTimestamp: entry.created || new Date().toISOString(),
  lastTimestamp: entry.modified || entry.created || new Date().toISOString(),
  fileSize: entry.fullPath && fs.existsSync(entry.fullPath)
    ? ((() => { try { return fs.statSync(entry.fullPath).size; } catch { return 0; } })()) : 0,
  messageCount: entry.messageCount || 0,
  totalTokens: 0,
  summary: entry.summary || entry.firstPrompt?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || "",
  synced,
});

const tryReadDir = (dir: string): fs.Dirent[] => {
  try { return fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }
};

const tryStatSize = (filePath: string): number | null => {
  try { return fs.statSync(filePath).size; }
  catch { return null; }
};

const discoverLocalSessions = (syncedIds: ReadonlySet<string>): readonly LocalSession[] => {
  const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(claudeProjectsDir)) return [];

  return tryReadDir(claudeProjectsDir).filter((e) => e.isDirectory())
    .flatMap((projEntry) => {
      const projPath = path.join(claudeProjectsDir, projEntry.name);
      const projectName = humanizeProjectKey(projEntry.name);

      const jsonlSessions = tryReadDir(projPath)
        .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
        .map((entry) => {
          const filePath = path.join(projPath, entry.name);
          const fileSize = tryStatSize(filePath);
          if (fileSize === null || fileSize < 100) return null;
          const meta = extractMetadataFromJsonl(filePath);
          if (!meta) return null;
          return {
            ...meta, filePath, fileSize,
            projectKey: projEntry.name, projectName,
            synced: syncedIds.has(meta.sessionId),
          } as LocalSession;
        })
        .filter((s): s is LocalSession => s !== null);

      const jsonlSessionIds = new Set(jsonlSessions.map((s) => s.sessionId));
      const indexPath = path.join(projPath, "sessions-index.json");
      const index = readSessionIndex(indexPath);
      const indexSessions = (index?.entries || [])
        .filter((e) => !jsonlSessionIds.has(e.sessionId))
        .map((e) => indexEntryToSession(e, projEntry.name, projectName, syncedIds.has(e.sessionId)));

      return [...jsonlSessions, ...indexSessions];
    })
    .sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());
};

const groupByProject = (sessions: readonly LocalSession[]): readonly ProjectGroup[] => {
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

// ── Server interaction ─────────────────────────────────────────────────────

const fetchSyncedSessionIds = async (): Promise<Set<string>> => {
  const config = tryGetConfig();
  if (!config) return new Set();
  try {
    const url = `${config.apiUrl.replace(/\/$/, "")}/sessions`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${config.token}` } });
    if (!res.ok) return new Set();
    const sessions = (await res.json()) as Array<{ id: string }>;
    return new Set(sessions.map((s) => s.id));
  } catch { return new Set(); }
};

const execGit = (args: string, dir?: string): string => {
  try {
    return execSync(`git ${args}`, { cwd: dir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch { return ""; }
};

const collectGitMetadataForDir = (cwd: string) => {
  const origin = fs.existsSync(cwd) ? execGit("remote get-url origin", cwd) : "";
  return {
    user_name: execGit("config user.name") || "unknown",
    user_email: execGit("config user.email") || "unknown",
    git_remotes: origin ? [origin] : [],
  };
};

const syncSessionToServer = async (session: LocalSession): Promise<"synced" | "skipped"> => {
  if (!session.filePath) return "skipped";
  const { apiUrl } = getConfig();
  const transcript = (() => {
    try { return fs.readFileSync(session.filePath, "utf-8"); }
    catch (err) { throw new Error(`Cannot read ${session.filePath}: ${(err as Error).message}`); }
  })();
  const gitMeta = collectGitMetadataForDir(session.cwd);
  const url = `${apiUrl.replace(/\/$/, "")}/sessions/${session.sessionId}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({
      user_name: gitMeta.user_name, user_email: gitMeta.user_email,
      working_dir: session.cwd, git_remotes: gitMeta.git_remotes,
      branch: session.gitBranch, tool: "claude-code", transcript, status: "done",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${url} returned ${res.status}: ${text}`);
  }
  return "synced";
};

const syncSessions = async (sessions: readonly LocalSession[]): Promise<SyncResult> => {
  const syncable = sessions.filter((s) => s.filePath !== null && !s.synced);
  const skippedCount = sessions.length - syncable.length;

  if (skippedCount > 0 && syncable.length === 0) {
    const archivedCount = sessions.filter((s) => s.filePath === null).length;
    const alreadySynced = sessions.filter((s) => s.synced).length;
    const reasons = [
      ...(archivedCount > 0 ? [`${archivedCount} archived`] : []),
      ...(alreadySynced > 0 ? [`${alreadySynced} already synced`] : []),
    ].join(", ");
    console.log(`  ${dim(`Nothing to sync (${reasons}).`)}\n`);
    return { synced: 0, failed: 0, skipped: skippedCount, syncedIds: new Set() };
  }

  if (skippedCount > 0) {
    console.log(`  ${dim(`Skipping ${skippedCount} sessions (archived or already synced)`)}`);
  }

  const total = syncable.length;
  const successIds: string[] = [];
  const result = await syncable.reduce<Promise<{ synced: number; failed: number }>>(
    async (accPromise, session, i) => {
      const acc = await accPromise;
      const label = session.summary ? truncate(session.summary, 30) : session.sessionId.slice(0, 12);
      process.stdout.write(`  ${dim(`[${i + 1}/${total}]`)} Syncing ${label}… `);
      try {
        await syncSessionToServer(session);
        successIds.push(session.sessionId);
        process.stdout.write(`${green("✓")} ${dim(formatBytes(session.fileSize))}\n`);
        return { synced: acc.synced + 1, failed: acc.failed };
      } catch (err) {
        process.stdout.write(`${red("✗")} ${dim((err as Error).message)}\n`);
        return { synced: acc.synced, failed: acc.failed + 1 };
      }
    },
    Promise.resolve({ synced: 0, failed: 0 })
  );

  console.log(
    result.failed === 0
      ? `\n  ${green("Done!")} ${bold(String(result.synced))} sessions synced.\n`
      : `\n  ${yellow("Done.")} ${bold(String(result.synced))} synced, ${red(String(result.failed))} failed.\n`
  );
  return { ...result, skipped: skippedCount, syncedIds: new Set(successIds) };
};

// ── Mark sessions as synced (immutable update) ─────────────────────────────

const markSynced = (sessions: readonly LocalSession[], syncedIds: ReadonlySet<string>): readonly LocalSession[] =>
  sessions.map((s) => syncedIds.has(s.sessionId) ? { ...s, synced: true } : s);

const markGroupSynced = (group: ProjectGroup, syncedIds: ReadonlySet<string>): ProjectGroup => ({
  ...group,
  sessions: markSynced(group.sessions, syncedIds),
});

// ── Vim-style Interactive TUI ──────────────────────────────────────────────

interface ListState {
  readonly cursor: number;
  readonly selected: ReadonlySet<number>;
  readonly scroll: number;
}

type ListAction =
  | { type: "enter"; index: number }
  | { type: "sync"; indices: readonly number[] }
  | { type: "back" }
  | { type: "quit" };

const parseKey = (buf: Buffer): string => {
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

const clamp = (val: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, val));

const computeScroll = (cursor: number, currentScroll: number, maxVisible: number, total: number): number => {
  const maxScroll = Math.max(0, total - maxVisible);
  if (cursor < currentScroll) return cursor;
  if (cursor >= currentScroll + maxVisible) return Math.min(cursor - maxVisible + 1, maxScroll);
  return Math.min(currentScroll, maxScroll);
};

const interactiveList = <T>(config: {
  readonly items: readonly T[];
  readonly renderRow: (item: T, index: number, active: boolean, selected: boolean) => string;
  readonly headerLines: readonly string[];
  readonly footerLine: (selectedCount: number, total: number) => string;
  readonly selectable: boolean;
}): Promise<ListAction> =>
  new Promise((resolve) => {
    const maxVisible = clamp((process.stdout.rows || 24) - config.headerLines.length - 4, 5, 40);
    const total = config.items.length;

    const stateRef: [ListState] = [{ cursor: 0, selected: new Set(), scroll: 0 }];
    const renderedRef: [number] = [0];

    const render = () => {
      const state = stateRef[0];
      const scroll = computeScroll(state.cursor, state.scroll, maxVisible, total);
      stateRef[0] = { ...state, scroll };

      const visibleItems = config.items.slice(scroll, scroll + maxVisible);
      const lines = [
        ...config.headerLines,
        ...visibleItems.map((item, i) => {
          const globalIdx = scroll + i;
          const active = globalIdx === state.cursor;
          const isSelected = state.selected.has(globalIdx);
          return config.renderRow(item, globalIdx, active, isSelected);
        }),
        ...(total > maxVisible ? [`    ${dim(`↕ ${scroll + 1}–${Math.min(scroll + maxVisible, total)} of ${total}`)}`] : []),
        "",
        config.footerLine(state.selected.size, total),
      ];

      const moveUp = renderedRef[0] > 0 ? `\x1b[${renderedRef[0]}A` : "";
      const output = moveUp + lines.map((line) => `\x1b[2K${line}`).join("\n") + "\n";
      const extraClears = renderedRef[0] > lines.length
        ? Array.from({ length: renderedRef[0] - lines.length }, () => "\x1b[2K\n").join("")
        : "";
      process.stdout.write(output + extraClears);
      renderedRef[0] = lines.length;
    };

    const cleanup = () => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      process.stdin.removeAllListeners("data");
      process.stdout.write(SHOW_CURSOR);
    };

    const onKey = (buf: Buffer) => {
      const key = parseKey(buf);
      const state = stateRef[0];

      if (key === "ctrl-c") { cleanup(); process.exit(0); }

      if (key === "up") {
        stateRef[0] = { ...state, cursor: clamp(state.cursor - 1, 0, total - 1) };
        render();
      } else if (key === "down") {
        stateRef[0] = { ...state, cursor: clamp(state.cursor + 1, 0, total - 1) };
        render();
      } else if (key === "top") {
        stateRef[0] = { ...state, cursor: 0, scroll: 0 };
        render();
      } else if (key === "bottom") {
        stateRef[0] = { ...state, cursor: total - 1 };
        render();
      } else if (key === "space" && config.selectable) {
        const next = new Set(state.selected);
        if (next.has(state.cursor)) { next.delete(state.cursor); } else { next.add(state.cursor); }
        stateRef[0] = { ...state, selected: next, cursor: clamp(state.cursor + 1, 0, total - 1) };
        render();
      } else if (key === "select-all" && config.selectable) {
        const allSelected = state.selected.size === total;
        const next = allSelected ? new Set<number>() : new Set(Array.from({ length: total }, (_, i) => i));
        stateRef[0] = { ...state, selected: next };
        render();
      } else if (key === "enter") {
        cleanup();
        resolve({ type: "enter", index: state.cursor });
      } else if (key === "sync") {
        cleanup();
        const indices = state.selected.size > 0
          ? Array.from(state.selected).sort((a, b) => a - b)
          : Array.from({ length: total }, (_, i) => i);
        resolve({ type: "sync", indices });
      } else if (key === "back") {
        cleanup();
        resolve({ type: "back" });
      }
    };

    process.stdout.write(HIDE_CURSOR);
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", onKey);
    render();
  });

// ── View renderers ─────────────────────────────────────────────────────────

const renderProjectRow = (g: ProjectGroup, _idx: number, active: boolean, _selected: boolean): string => {
  const pointer = active ? cyan("▸") : " ";
  const dateRange = `${formatDate(g.earliest)} – ${formatDate(g.latest)}`;
  const paddedName = padRight(g.projectName, 34);
  const name = active ? bold(paddedName) : paddedName;
  const content = `  ${pointer} ${name}${padLeft(String(g.sessions.length), 8)}${padLeft(formatBytes(g.totalSize), 12)}  ${dim(dateRange)}`;
  return active ? `\x1b[48;5;236m${content}\x1b[0m` : content;
};

const renderSessionRow = (s: LocalSession, _idx: number, active: boolean, selected: boolean): string => {
  const pointer = active ? cyan("▸") : " ";
  const status = s.synced ? green(" ✓ ") : selected ? green("[✓]") : dim("[ ]");
  const rawLabel = s.summary ? truncate(s.summary, 34) : s.sessionId.slice(0, 12) + "…";
  const paddedLabel = padRight(rawLabel, 36);
  const label = s.synced ? dim(paddedLabel) : !s.summary ? dim(paddedLabel) : paddedLabel;
  const branch = padRight(s.gitBranch.slice(0, 14), 16);
  const date = padRight(formatDate(s.lastTimestamp), 8);
  const msgs = padLeft(String(s.messageCount), 5);
  const tokens = padLeft(formatTokens(s.totalTokens), 7);
  const archived = s.filePath === null && !s.synced ? dim(" ✱") : "";
  const content = `  ${pointer} ${status} ${label}${branch}${date}${msgs}${tokens}${archived}`;
  return s.synced
    ? (active ? `\x1b[48;5;236m${dim(content)}\x1b[0m` : dim(content))
    : (active ? `\x1b[48;5;236m${content}\x1b[0m` : content);
};

// ── Main flows ─────────────────────────────────────────────────────────────

const browseProject = async (group: ProjectGroup): Promise<ProjectGroup> => {
  const syncableCount = group.sessions.filter((s) => s.filePath !== null && !s.synced).length;
  const syncedCount = group.sessions.filter((s) => s.synced).length;
  const subtitle = [
    `${group.sessions.length} sessions`,
    ...(syncableCount > 0 ? [`${syncableCount} syncable`] : []),
    ...(syncedCount > 0 ? [`${syncedCount} synced`] : []),
  ].join(", ");

  const action = await interactiveList({
    items: group.sessions,
    renderRow: renderSessionRow,
    headerLines: [
      "",
      `  ${bold(group.projectName)} ${dim(`— ${subtitle}`)}`,
      "",
      `  ${dim("    ")}${dim(padRight("SUMMARY", 40))}${dim(padRight("BRANCH", 16))}${dim(padRight("DATE", 8))}${dim(padLeft("MSGS", 5))}${dim(padLeft("TOKENS", 7))}`,
      `  ${dim("─".repeat(82))}`,
    ],
    footerLine: (sel, _total) => {
      const selLabel = sel > 0 ? ` (${sel} selected)` : "";
      return `  ${dim("j/k")} navigate  ${dim("space")} select  ${dim("a")} toggle all  ${dim("s")} sync${selLabel}  ${dim("esc")} back`;
    },
    selectable: true,
  });

  if (action.type === "back") return group;

  if (action.type === "enter") {
    console.log();
    const result = await syncSessions([group.sessions[action.index]]);
    const updated = markGroupSynced(group, result.syncedIds);
    return browseProject(updated);
  }

  if (action.type === "sync") {
    const toSync = action.indices.map((i) => group.sessions[i]);
    console.log();
    const result = await syncSessions(toSync);
    const updated = markGroupSynced(group, result.syncedIds);
    return browseProject(updated);
  }

  return group;
};

const runDiscoverLoop = async (groups: readonly ProjectGroup[]): Promise<void> => {
  const allSessions = groups.flatMap((g) => g.sessions);
  const syncableCount = allSessions.filter((s) => s.filePath !== null && !s.synced).length;

  const action = await interactiveList({
    items: groups,
    renderRow: renderProjectRow,
    headerLines: [
      "",
      `  ${magenta("orchid sync")} ${dim("— discover local Claude Code sessions")}`,
      "",
      `  ${bold(String(allSessions.length))} sessions across ${bold(String(groups.length))} projects ${dim(`(${syncableCount} syncable)`)}`,
      "",
      `  ${dim(" ")}${dim(padRight("PROJECT", 36))}${dim(padLeft("SESSIONS", 8))}${dim(padLeft("SIZE", 12))}  ${dim("DATE RANGE")}`,
      `  ${dim("─".repeat(82))}`,
    ],
    footerLine: (_sel, _total) =>
      `  ${dim("j/k")} navigate  ${dim("↵")} browse  ${dim("s")} sync all  ${dim("q")} quit`,
    selectable: false,
  });

  if (action.type === "back" || action.type === "quit") return;

  if (action.type === "enter") {
    const updated = await browseProject(groups[action.index]);
    const updatedGroups = groups.map((g, i) => (i === action.index ? updated : g));
    return runDiscoverLoop(updatedGroups);
  }

  if (action.type === "sync") {
    console.log();
    const result = await syncSessions(allSessions);
    const updatedGroups = groups.map((g) => markGroupSynced(g, result.syncedIds));
    return runDiscoverLoop(updatedGroups);
  }
};

const runDiscover = async (): Promise<void> => {
  console.log();
  console.log(`  ${magenta("orchid sync")} ${dim("— discover local Claude Code sessions")}`);
  console.log();
  process.stdout.write(`  ${dim("Scanning ~/.claude/projects…")}`);

  process.stdout.write(`\r  ${dim("Checking server for already-synced sessions…")}              `);
  const syncedIds = await fetchSyncedSessionIds();
  process.stdout.write(`\r  ${dim(`${syncedIds.size} sessions already synced on server.`)}              \n`);

  const allSessions = discoverLocalSessions(syncedIds);
  console.log(`  ${dim(`Found ${allSessions.length} local sessions.`)}`);

  if (allSessions.length === 0) {
    console.log(`\n  ${dim("No Claude Code sessions found in ~/.claude/projects/")}`);
    return;
  }

  const groups = groupByProject(allSessions);
  await runDiscoverLoop(groups);
};

// ── Single file sync ───────────────────────────────────────────────────────

const syncFile = async (filePath: string): Promise<void> => {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) { console.error(`${red("Error:")} File not found: ${resolved}`); process.exit(1); }
  if (!resolved.endsWith(".jsonl")) { console.error(`${red("Error:")} Expected a .jsonl file`); process.exit(1); }

  const fileSize = fs.statSync(resolved).size;
  const meta = extractMetadataFromJsonl(resolved);
  if (!meta) { console.error(`${red("Error:")} Could not parse metadata from ${resolved}`); process.exit(1); }

  const projectKey = path.basename(path.dirname(resolved));
  const session: LocalSession = { ...meta, filePath: resolved, fileSize, projectKey, projectName: humanizeProjectKey(projectKey), synced: false };

  console.log(`\n  ${magenta("orchid sync")} ${dim("— syncing single session")}\n`);
  console.log(`  Session:  ${session.sessionId}`);
  console.log(`  Summary:  ${session.summary || dim("(no summary)")}`);
  console.log(`  Branch:   ${session.gitBranch}`);
  console.log(`  Size:     ${formatBytes(session.fileSize)}`);
  console.log(`  Tokens:   ${formatTokens(session.totalTokens)}\n`);

  process.stdout.write(`  Syncing… `);
  try {
    await syncSessionToServer(session);
    console.log(`${green("✓")} Done!\n`);
  } catch (err) {
    console.log(`${red("✗")} ${(err as Error).message}`);
    process.exit(1);
  }
};

// ── Entry point ────────────────────────────────────────────────────────────

export const runSync = (args: string[]): void => {
  const flag = args[0];

  if (flag === "--help" || flag === "-h") {
    console.log(`orchid sync - sync past Claude Code conversations

Usage:
  orchid sync --discover          Discover and sync unsynced local sessions
  orchid sync <file.jsonl>        Sync a single transcript file

Options:
  --discover    Scan ~/.claude/projects/ for unsynced sessions
  --help        Show this help message`);
    return;
  }

  if (flag === "--discover" || !flag) {
    runDiscover().catch((err) => {
      process.stdout.write(SHOW_CURSOR);
      console.error(`\n${red("Error:")} ${err.message}`);
      process.exit(1);
    });
    return;
  }

  syncFile(flag).catch((err) => {
    console.error(`\n${red("Error:")} ${err.message}`);
    process.exit(1);
  });
};
