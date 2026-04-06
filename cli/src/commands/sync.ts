import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";
import { execSync } from "child_process";
import { getConfig, getAuthHeaders, tryGetConfig } from "../config";

// ── Types ──────────────────────────────────────────────────────────────────

interface LocalSession {
  readonly filePath: string | null; // null for archived sessions (transcript cleaned up)
  readonly sessionId: string;
  readonly projectKey: string;
  readonly projectName: string;
  readonly cwd: string;
  readonly gitBranch: string;
  readonly firstTimestamp: string;
  readonly lastTimestamp: string;
  readonly fileSize: number;
  readonly messageCount: number;
  readonly summary: string;
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
}

// ── sessions-index.json schema ─────────────────────────────────────────────

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

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

// ── Utility ────────────────────────────────────────────────────────────────

const formatBytes = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[d.getMonth()]} ${d.getDate()}`;
};

const padRight = (str: string, len: number): string =>
  str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);

const padLeft = (str: string, len: number): string =>
  str.length >= len ? str.slice(0, len) : " ".repeat(len - str.length) + str;

const truncate = (str: string, len: number): string =>
  str.length <= len ? str : str.slice(0, len - 1) + "…";

/**
 * Convert a Claude projects directory name to a human-readable project name.
 * e.g. "-Users-juliankmazo-Developer-personal-orchid" → "personal/orchid"
 */
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

// ── Discovery: JSONL files ─────────────────────────────────────────────────

const tryParseJson = (line: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const extractTextContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: { type?: string; text?: string }) =>
        typeof block === "string" ? block
          : block?.type === "text" && typeof block.text === "string" ? block.text
          : ""
      )
      .filter(Boolean)
      .join(" ");
  }
  return "";
};

const extractMetadataFromJsonl = (
  filePath: string
): Omit<LocalSession, "filePath" | "fileSize" | "projectKey" | "projectName"> | null => {
  const fd = (() => {
    try { return fs.openSync(filePath, "r"); }
    catch { return null; }
  })();
  if (fd === null) return null;

  const buf = Buffer.alloc(32 * 1024);
  const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);

  const lines = buf.toString("utf-8", 0, bytesRead).split("\n").filter((l) => l.trim());
  const parsed = lines.map(tryParseJson).filter((obj): obj is Record<string, unknown> => obj !== null);

  const meta = parsed.reduce<{
    sessionId: string;
    cwd: string;
    gitBranch: string;
    firstTimestamp: string;
    messageCount: number;
    firstUserMessage: string;
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
        firstUserMessage: acc.firstUserMessage || userText,
      };
    },
    { sessionId: "", cwd: "", gitBranch: "", firstTimestamp: "", messageCount: 0, firstUserMessage: "" }
  );

  const sessionId = meta.sessionId || path.basename(filePath, ".jsonl");
  const fileSize = fs.statSync(filePath).size;

  const estimatedMessages =
    meta.messageCount > 0 && bytesRead > 0
      ? Math.round((meta.messageCount / bytesRead) * fileSize)
      : meta.messageCount;

  const lastTimestamp = (() => {
    try { return fs.statSync(filePath).mtime.toISOString(); }
    catch { return meta.firstTimestamp; }
  })();

  // Clean up the first user message for use as summary
  const summary = meta.firstUserMessage
    .replace(/<[^>]+>/g, "")  // strip XML tags
    .replace(/\s+/g, " ")     // collapse whitespace
    .trim();

  return {
    sessionId,
    cwd: meta.cwd || "unknown",
    gitBranch: meta.gitBranch || "unknown",
    firstTimestamp: meta.firstTimestamp || new Date().toISOString(),
    lastTimestamp: lastTimestamp || meta.firstTimestamp || new Date().toISOString(),
    messageCount: estimatedMessages,
    summary,
  };
};

// ── Discovery: sessions-index.json (archived sessions) ─────────────────────

const readSessionIndex = (indexPath: string): SessionIndex | null => {
  try {
    return JSON.parse(fs.readFileSync(indexPath, "utf-8")) as SessionIndex;
  } catch {
    return null;
  }
};

const indexEntryToSession = (
  entry: SessionIndexEntry,
  projectKey: string,
  projectName: string
): LocalSession => ({
  filePath: fs.existsSync(entry.fullPath) ? entry.fullPath : null,
  sessionId: entry.sessionId,
  projectKey,
  projectName,
  cwd: entry.projectPath || "unknown",
  gitBranch: entry.gitBranch || "unknown",
  firstTimestamp: entry.created || new Date().toISOString(),
  lastTimestamp: entry.modified || entry.created || new Date().toISOString(),
  fileSize: entry.fullPath && fs.existsSync(entry.fullPath)
    ? ((() => { try { return fs.statSync(entry.fullPath).size; } catch { return 0; } })())
    : 0,
  messageCount: entry.messageCount || 0,
  summary: entry.summary || entry.firstPrompt?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || "",
});

// ── Discovery: combined ────────────────────────────────────────────────────

const tryReadDir = (dir: string): fs.Dirent[] => {
  try { return fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }
};

const tryStatSize = (filePath: string): number | null => {
  try { return fs.statSync(filePath).size; }
  catch { return null; }
};

const discoverLocalSessions = (): readonly LocalSession[] => {
  const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(claudeProjectsDir)) return [];

  const projectDirs = tryReadDir(claudeProjectsDir).filter((e) => e.isDirectory());

  return projectDirs
    .flatMap((projEntry) => {
      const projPath = path.join(claudeProjectsDir, projEntry.name);
      const projectName = humanizeProjectKey(projEntry.name);

      // 1. Sessions from .jsonl files (live/recent sessions)
      const jsonlSessions = tryReadDir(projPath)
        .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
        .map((entry) => {
          const filePath = path.join(projPath, entry.name);
          const fileSize = tryStatSize(filePath);
          if (fileSize === null || fileSize < 100) return null;

          const meta = extractMetadataFromJsonl(filePath);
          if (!meta) return null;

          return {
            ...meta,
            filePath,
            fileSize,
            projectKey: projEntry.name,
            projectName,
          } as LocalSession;
        })
        .filter((s): s is LocalSession => s !== null);

      const jsonlSessionIds = new Set(jsonlSessions.map((s) => s.sessionId));

      // 2. Sessions from sessions-index.json (archived, transcript may be gone)
      const indexPath = path.join(projPath, "sessions-index.json");
      const index = readSessionIndex(indexPath);
      const indexSessions = (index?.entries || [])
        .filter((e) => !jsonlSessionIds.has(e.sessionId)) // skip if already found via .jsonl
        .map((e) => indexEntryToSession(e, projEntry.name, projectName));

      return [...jsonlSessions, ...indexSessions];
    })
    .sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());
};

const groupByProject = (sessions: readonly LocalSession[]): readonly ProjectGroup[] => {
  const grouped = sessions.reduce<Record<string, LocalSession[]>>(
    (acc, s) => ({
      ...acc,
      [s.projectKey]: [...(acc[s.projectKey] || []), s],
    }),
    {}
  );

  return Object.entries(grouped)
    .map(([key, sess]) => {
      const sorted = [...sess].sort(
        (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
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
    .sort((a, b) => new Date(b.latest).getTime() - new Date(a.latest).getTime());
};

// ── Server interaction ─────────────────────────────────────────────────────

const fetchSyncedSessionIds = async (): Promise<Set<string>> => {
  const config = tryGetConfig();
  if (!config) return new Set();

  try {
    const url = `${config.apiUrl.replace(/\/$/, "")}/sessions`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    if (!res.ok) return new Set();

    const sessions = (await res.json()) as Array<{ id: string }>;
    return new Set(sessions.map((s) => s.id));
  } catch {
    return new Set();
  }
};

const execGit = (args: string, dir?: string): string => {
  try {
    return execSync(`git ${args}`, {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
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
  if (!session.filePath) {
    return "skipped"; // archived session, no transcript available
  }

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
      user_name: gitMeta.user_name,
      user_email: gitMeta.user_email,
      working_dir: session.cwd,
      git_remotes: gitMeta.git_remotes,
      branch: session.gitBranch,
      tool: "claude-code",
      transcript,
      status: "done",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${url} returned ${res.status}: ${text}`);
  }

  return "synced";
};

// ── Interactive TUI ────────────────────────────────────────────────────────

const createPrompt = () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    ask: (question: string): Promise<string> =>
      new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
      }),
    close: () => rl.close(),
  };
};

const printProjectTable = (groups: readonly ProjectGroup[]): void => {
  console.log();
  console.log(
    `  ${dim(padRight("#", 4))}${padRight("PROJECT", 34)}${padLeft("SESSIONS", 10)}${padLeft("SIZE", 12)}  ${padRight("DATE RANGE", 20)}`
  );
  console.log(`  ${dim("─".repeat(82))}`);

  groups.forEach((g, i) => {
    const dateRange = `${formatDate(g.earliest)} – ${formatDate(g.latest)}`;
    console.log(
      `  ${cyan(padRight(String(i + 1), 4))}${padRight(g.projectName, 34)}${padLeft(String(g.sessions.length), 10)}${padLeft(formatBytes(g.totalSize), 12)}  ${dim(dateRange)}`
    );
  });
  console.log();
};

const printSessionTable = (sessions: readonly LocalSession[]): void => {
  console.log();
  console.log(
    `  ${dim(padRight("#", 4))}${padRight("SUMMARY", 42)}${padRight("BRANCH", 20)}${padRight("DATE", 10)}${padLeft("MSGS", 6)}`
  );
  console.log(`  ${dim("─".repeat(82))}`);

  sessions.forEach((s, i) => {
    const label = s.summary
      ? truncate(s.summary, 40)
      : s.sessionId.slice(0, 12) + "…";
    const archived = s.filePath === null ? dim(" (archived)") : "";
    console.log(
      `  ${cyan(padRight(String(i + 1), 4))}${padRight(label, 42)}${padRight(s.gitBranch.slice(0, 18), 20)}${padRight(formatDate(s.lastTimestamp), 10)}${padLeft(String(s.messageCount), 6)}${archived}`
    );
  });
  console.log();
};

const syncSessions = async (sessions: readonly LocalSession[]): Promise<SyncResult> => {
  console.log();
  const syncable = sessions.filter((s) => s.filePath !== null);
  const skippedCount = sessions.length - syncable.length;

  if (skippedCount > 0) {
    console.log(`  ${dim(`Skipping ${skippedCount} archived sessions (no transcript on disk)`)}`);
  }

  if (syncable.length === 0) {
    console.log(`  ${dim("Nothing to sync — all selected sessions are archived.")}`);
    console.log();
    return { synced: 0, failed: 0, skipped: skippedCount };
  }

  const total = syncable.length;

  const result = await syncable.reduce<Promise<{ synced: number; failed: number }>>(
    async (accPromise, session, i) => {
      const acc = await accPromise;
      const label = session.summary
        ? truncate(session.summary, 30)
        : session.sessionId.slice(0, 12);
      process.stdout.write(`  ${dim(`[${i + 1}/${total}]`)} Syncing ${label}… `);

      try {
        await syncSessionToServer(session);
        process.stdout.write(`${green("✓")} ${dim(formatBytes(session.fileSize))}\n`);
        return { synced: acc.synced + 1, failed: acc.failed };
      } catch (err) {
        process.stdout.write(`${red("✗")} ${dim((err as Error).message)}\n`);
        return { synced: acc.synced, failed: acc.failed + 1 };
      }
    },
    Promise.resolve({ synced: 0, failed: 0 })
  );

  console.log();
  console.log(
    result.failed === 0
      ? `  ${green("Done!")} ${bold(String(result.synced))} sessions synced.`
      : `  ${yellow("Done.")} ${bold(String(result.synced))} synced, ${red(String(result.failed))} failed.`
  );
  console.log();

  return { ...result, skipped: skippedCount };
};

const expandRange = (start: number, end: number): readonly number[] =>
  Array.from({ length: end - start + 1 }, (_, i) => start + i);

const parseSelection = (input: string, max: number): readonly number[] | "all" | "back" | "quit" | null => {
  const lower = input.toLowerCase();
  if (lower === "q" || lower === "quit") return "quit";
  if (lower === "b" || lower === "back") return "back";
  if (lower === "a" || lower === "all") return "all";

  const indices = input
    .split(",")
    .map((p) => p.trim())
    .flatMap((part) => {
      if (part.includes("-")) {
        const [startStr, endStr] = part.split("-").map((s) => s.trim());
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        return isNaN(start) || isNaN(end) ? [] : expandRange(start, end);
      }
      const n = parseInt(part, 10);
      return isNaN(n) ? [] : [n];
    })
    .filter((n) => n >= 1 && n <= max)
    .map((n) => n - 1);

  return indices.length > 0 ? indices : null;
};

// ── Interactive flows (recursive, no mutation) ─────────────────────────────

const browseProject = async (
  prompt: { ask: (q: string) => Promise<string> },
  group: ProjectGroup
): Promise<ProjectGroup> => {
  console.log();
  console.log(`  ${bold(group.projectName)} ${dim(`— ${group.sessions.length} unsynced sessions`)}`);
  printSessionTable(group.sessions);

  const syncableCount = group.sessions.filter((s) => s.filePath !== null).length;
  const totalSize = group.sessions.reduce((sum, s) => sum + s.fileSize, 0);
  console.log(
    `  ${dim(`[a] Sync all (${syncableCount} syncable, ${formatBytes(totalSize)})`)}  ${dim("[1-" + group.sessions.length + "] Select")}  ${dim("[b] Back")}  ${dim("[q] Quit")}`
  );

  const input = await prompt.ask(`  ${cyan("❯")} `);
  const selection = parseSelection(input, group.sessions.length);

  if (selection === "quit") {
    process.exit(0);
  }

  if (selection === "back") {
    return group;
  }

  if (selection === "all") {
    await syncSessions(group.sessions);
    return { ...group, sessions: [] };
  }

  if (selection === null) {
    console.log(`  ${dim("Invalid input. Enter numbers (e.g. 1,3,5-7), 'a' for all, or 'b' to go back.")}`);
    return browseProject(prompt, group);
  }

  const selected = selection.map((i) => group.sessions[i]);
  await syncSessions(selected);

  const syncedSet = new Set(selected.filter((s) => s.filePath !== null).map((s) => s.sessionId));
  const remaining = group.sessions.filter((s) => !syncedSet.has(s.sessionId));
  const updatedGroup = { ...group, sessions: remaining };

  if (remaining.length === 0) {
    console.log(`  ${green("All sessions in this project are now synced!")}`);
    return updatedGroup;
  }

  return browseProject(prompt, updatedGroup);
};

const runDiscoverLoop = async (
  prompt: { ask: (q: string) => Promise<string> },
  groups: readonly ProjectGroup[],
  allUnsynced: readonly LocalSession[]
): Promise<void> => {
  printProjectTable(groups);

  const syncableCount = allUnsynced.filter((s) => s.filePath !== null).length;
  const totalSize = allUnsynced.reduce((sum, s) => sum + s.fileSize, 0);
  console.log(
    `  ${dim(`[a] Sync all (${syncableCount} syncable, ${formatBytes(totalSize)})`)}  ${dim("[1-" + groups.length + "] Browse project")}  ${dim("[q] Quit")}`
  );

  const input = await prompt.ask(`  ${cyan("❯")} `);
  const selection = parseSelection(input, groups.length);

  if (selection === "quit") return;
  if (selection === "back") return runDiscoverLoop(prompt, groups, allUnsynced);

  if (selection === "all") {
    await syncSessions(allUnsynced);
    return;
  }

  if (selection === null) {
    console.log(`  ${dim("Invalid input. Enter a number, 'a' for all, or 'q' to quit.")}`);
    return runDiscoverLoop(prompt, groups, allUnsynced);
  }

  const updatedGroups = await selection.reduce<Promise<readonly ProjectGroup[]>>(
    async (accPromise, idx) => {
      const acc = await accPromise;
      const updated = await browseProject(prompt, acc[idx]);
      return acc.map((g, i) => (i === idx ? updated : g));
    },
    Promise.resolve([...groups])
  );

  const remainingUnsynced = updatedGroups.flatMap((g) => g.sessions);
  const activeGroups = updatedGroups.filter((g) => g.sessions.length > 0);

  if (activeGroups.length === 0) return;

  return runDiscoverLoop(prompt, activeGroups, remainingUnsynced);
};

const runDiscover = async (): Promise<void> => {
  console.log();
  console.log(`  ${magenta("orchid sync")} ${dim("— discover local Claude Code sessions")}`);
  console.log();
  process.stdout.write(`  ${dim("Scanning ~/.claude/projects…")}`);

  const allSessions = discoverLocalSessions();
  process.stdout.write(`\r  ${dim(`Found ${allSessions.length} local sessions.`)}              \n`);

  if (allSessions.length === 0) {
    console.log(`\n  ${dim("No Claude Code sessions found in ~/.claude/projects/")}`);
    return;
  }

  process.stdout.write(`  ${dim("Checking server for already-synced sessions…")}`);
  const syncedIds = await fetchSyncedSessionIds();
  process.stdout.write(`\r  ${dim(`${syncedIds.size} sessions already synced on server.`)}              \n`);

  const unsyncedSessions = allSessions.filter((s) => !syncedIds.has(s.sessionId));

  if (unsyncedSessions.length === 0) {
    console.log(`\n  ${green("All sessions are already synced!")} Nothing to do.`);
    return;
  }

  const groups = groupByProject(unsyncedSessions);
  const syncableCount = unsyncedSessions.filter((s) => s.filePath !== null).length;
  const archivedCount = unsyncedSessions.length - syncableCount;

  console.log();
  console.log(
    `  ${bold(String(unsyncedSessions.length))} unsynced sessions across ${bold(String(groups.length))} projects` +
    (archivedCount > 0 ? dim(` (${archivedCount} archived, metadata only)`) : "")
  );

  const prompt = createPrompt();
  await runDiscoverLoop(prompt, groups, unsyncedSessions);
  prompt.close();
};

// ── Single file sync ───────────────────────────────────────────────────────

const syncFile = async (filePath: string): Promise<void> => {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    console.error(`${red("Error:")} File not found: ${resolved}`);
    process.exit(1);
  }

  if (!resolved.endsWith(".jsonl")) {
    console.error(`${red("Error:")} Expected a .jsonl file`);
    process.exit(1);
  }

  const fileSize = fs.statSync(resolved).size;
  const meta = extractMetadataFromJsonl(resolved);

  if (!meta) {
    console.error(`${red("Error:")} Could not parse metadata from ${resolved}`);
    process.exit(1);
  }

  const projectKey = path.basename(path.dirname(resolved));
  const session: LocalSession = {
    ...meta,
    filePath: resolved,
    fileSize,
    projectKey,
    projectName: humanizeProjectKey(projectKey),
  };

  console.log();
  console.log(`  ${magenta("orchid sync")} ${dim("— syncing single session")}`);
  console.log();
  console.log(`  Session:  ${session.sessionId}`);
  console.log(`  Summary:  ${session.summary || dim("(no summary)")}`);
  console.log(`  Project:  ${session.projectName}`);
  console.log(`  Branch:   ${session.gitBranch}`);
  console.log(`  Date:     ${formatDate(session.firstTimestamp)}`);
  console.log(`  Size:     ${formatBytes(session.fileSize)}`);
  console.log(`  Messages: ${session.messageCount}`);
  console.log();

  process.stdout.write(`  Syncing… `);

  try {
    await syncSessionToServer(session);
    console.log(`${green("✓")} Done!`);
  } catch (err) {
    console.log(`${red("✗")} ${(err as Error).message}`);
    process.exit(1);
  }

  console.log();
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
