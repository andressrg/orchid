import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";
import { execSync } from "child_process";
import { getConfig, getAuthHeaders, tryGetConfig } from "../config";

// ── Types ──────────────────────────────────────────────────────────────────

interface LocalSession {
  filePath: string;
  sessionId: string;
  projectKey: string; // raw directory name e.g. "-Users-juliankmazo-Developer-personal-orchid"
  projectName: string; // human-readable e.g. "personal/orchid"
  cwd: string;
  gitBranch: string;
  firstTimestamp: string;
  lastTimestamp: string;
  fileSize: number;
  messageCount: number;
}

interface ProjectGroup {
  projectName: string;
  projectKey: string;
  sessions: LocalSession[];
  totalSize: number;
  earliest: string;
  latest: string;
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : " ".repeat(len - str.length) + str;
}

/**
 * Convert a Claude projects directory name to a human-readable project name.
 * The dir name is the full path with "/" replaced by "-".
 * We decode it back and take the relative path from the "Developer" directory.
 * e.g. "-Users-juliankmazo-Developer-personal-orchid" → "personal/orchid"
 */
function humanizeProjectKey(key: string): string {
  // The key is the full absolute path with / → -
  // Decode by looking at the actual cwd from session metadata if available,
  // otherwise reconstruct from the key pattern.
  // The key starts with "-Users-<user>-Developer-..." or similar.
  // We want to find the last meaningful path segments.

  // Try to find a "Developer" segment and take everything after it
  const devPattern = /-Developer-/;
  const match = key.match(devPattern);
  if (match && match.index !== undefined) {
    const afterDev = key.slice(match.index + match[0].length);
    // Split on known path separators: use the original dir structure
    // The cwd was something like /Users/julian/Developer/personal/orchid
    // Key becomes -Users-julian-Developer-personal-orchid
    // "afterDev" = "personal-orchid"
    // We want "personal/orchid" — but only split on the first segment boundary
    // Heuristic: split by single "-" that separates path segments
    // Since actual folder names can contain "-" (e.g. "mining-plate-crawler"),
    // we use the cwd from actual sessions to get accurate names.
    // For now, use a simple approach: replace only the first "-" with "/"
    // to get "org/project" format.
    const firstDash = afterDev.indexOf("-");
    if (firstDash !== -1) {
      const org = afterDev.slice(0, firstDash);
      const rest = afterDev.slice(firstDash + 1);
      return `${org}/${rest}`;
    }
    return afterDev;
  }

  // Fallback
  const parts = key.split("-").filter(Boolean);
  if (parts.length >= 2) {
    return parts.slice(-2).join("/");
  }
  return key;
}

// ── Discovery ──────────────────────────────────────────────────────────────

function extractMetadataFromJsonl(filePath: string): Omit<LocalSession, "filePath" | "fileSize" | "projectKey" | "projectName"> | null {
  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return null;
  }

  const buf = Buffer.alloc(32 * 1024); // read first 32KB — enough for metadata lines
  const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);

  const chunk = buf.toString("utf-8", 0, bytesRead);
  const lines = chunk.split("\n").filter((l) => l.trim());

  let sessionId = "";
  let cwd = "";
  let gitBranch = "";
  let firstTimestamp = "";
  let messageCount = 0;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === "user" || obj.type === "assistant") {
        messageCount++;
      }
      if (!sessionId && obj.sessionId) {
        sessionId = obj.sessionId;
      }
      if (!cwd && obj.cwd) {
        cwd = obj.cwd;
      }
      if (!gitBranch && obj.gitBranch) {
        gitBranch = obj.gitBranch;
      }
      if (!firstTimestamp && obj.timestamp) {
        firstTimestamp = obj.timestamp;
      }
    } catch {
      // skip unparseable lines
    }
  }

  // If we didn't find metadata in the first chunk, fall back to filename
  if (!sessionId) {
    sessionId = path.basename(filePath, ".jsonl");
  }

  // Estimate total message count from file size + density in first chunk
  // Avoids reading multi-MB files just for a count
  if (messageCount > 0 && bytesRead > 0) {
    const density = messageCount / bytesRead; // messages per byte in first chunk
    const stat = fs.statSync(filePath);
    messageCount = Math.round(density * stat.size);
  }

  // Get last timestamp from file stat
  let lastTimestamp = firstTimestamp;
  try {
    const stat = fs.statSync(filePath);
    lastTimestamp = stat.mtime.toISOString();
  } catch {
    // keep firstTimestamp
  }

  return {
    sessionId,
    cwd: cwd || "unknown",
    gitBranch: gitBranch || "unknown",
    firstTimestamp: firstTimestamp || new Date().toISOString(),
    lastTimestamp,
    messageCount,
  };
}

function discoverLocalSessions(): LocalSession[] {
  const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(claudeProjectsDir)) {
    return [];
  }

  const sessions: LocalSession[] = [];

  const projectDirs = fs.readdirSync(claudeProjectsDir, { withFileTypes: true });
  for (const projEntry of projectDirs) {
    if (!projEntry.isDirectory()) continue;

    const projPath = path.join(claudeProjectsDir, projEntry.name);

    // Only pick up top-level .jsonl files (skip subagent dirs)
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(projPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

      const filePath = path.join(projPath, entry.name);
      let fileSize: number;
      try {
        fileSize = fs.statSync(filePath).size;
      } catch {
        continue;
      }

      // Skip tiny files (< 100 bytes = likely empty/corrupt)
      if (fileSize < 100) continue;

      const meta = extractMetadataFromJsonl(filePath);
      if (!meta) continue;

      sessions.push({
        ...meta,
        filePath,
        fileSize,
        projectKey: projEntry.name,
        projectName: humanizeProjectKey(projEntry.name),
      });
    }
  }

  // Sort by most recent first
  sessions.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());

  return sessions;
}

function groupByProject(sessions: LocalSession[]): ProjectGroup[] {
  const map = new Map<string, LocalSession[]>();

  for (const s of sessions) {
    const existing = map.get(s.projectKey) || [];
    existing.push(s);
    map.set(s.projectKey, existing);
  }

  const groups: ProjectGroup[] = [];
  for (const [key, sess] of map) {
    const sorted = sess.sort((a, b) =>
      new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
    );
    groups.push({
      projectKey: key,
      projectName: sorted[0].projectName,
      sessions: sorted,
      totalSize: sorted.reduce((sum, s) => sum + s.fileSize, 0),
      earliest: sorted[sorted.length - 1].firstTimestamp,
      latest: sorted[0].lastTimestamp,
    });
  }

  // Sort groups by most recent activity
  groups.sort((a, b) => new Date(b.latest).getTime() - new Date(a.latest).getTime());

  return groups;
}

// ── Server interaction ─────────────────────────────────────────────────────

async function fetchSyncedSessionIds(): Promise<Set<string>> {
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
}

function collectGitMetadataForDir(cwd: string): {
  user_name: string;
  user_email: string;
  git_remotes: string[];
} {
  function execGit(args: string, dir?: string): string {
    try {
      return execSync(`git ${args}`, {
        cwd: dir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      return "";
    }
  }

  const user_name = execGit("config user.name") || "unknown";
  const user_email = execGit("config user.email") || "unknown";

  const git_remotes: string[] = [];
  if (fs.existsSync(cwd)) {
    const origin = execGit("remote get-url origin", cwd);
    if (origin) git_remotes.push(origin);
  }

  return { user_name, user_email, git_remotes };
}

async function syncSessionToServer(session: LocalSession): Promise<void> {
  const { apiUrl } = getConfig();

  let transcript = "";
  try {
    transcript = fs.readFileSync(session.filePath, "utf-8");
  } catch (err) {
    throw new Error(`Cannot read ${session.filePath}: ${(err as Error).message}`);
  }

  const gitMeta = collectGitMetadataForDir(session.cwd);

  const body = JSON.stringify({
    user_name: gitMeta.user_name,
    user_email: gitMeta.user_email,
    working_dir: session.cwd,
    git_remotes: gitMeta.git_remotes,
    branch: session.gitBranch,
    tool: "claude-code",
    transcript,
    status: "done",
  });

  const url = `${apiUrl.replace(/\/$/, "")}/sessions/${session.sessionId}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${url} returned ${res.status}: ${text}`);
  }
}

// ── Interactive TUI ────────────────────────────────────────────────────────

function createPrompt(): {
  ask: (question: string) => Promise<string>;
  close: () => void;
} {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    ask(question: string): Promise<string> {
      return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
      });
    },
    close() {
      rl.close();
    },
  };
}

function printProjectTable(groups: ProjectGroup[]): void {
  console.log();
  console.log(
    `  ${dim(padRight("#", 4))}${padRight("PROJECT", 34)}${padLeft("SESSIONS", 10)}${padLeft("SIZE", 12)}  ${padRight("DATE RANGE", 20)}`
  );
  console.log(`  ${dim("─".repeat(82))}`);

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const dateRange = `${formatDate(g.earliest)} – ${formatDate(g.latest)}`;
    console.log(
      `  ${cyan(padRight(String(i + 1), 4))}${padRight(g.projectName, 34)}${padLeft(String(g.sessions.length), 10)}${padLeft(formatBytes(g.totalSize), 12)}  ${dim(dateRange)}`
    );
  }
  console.log();
}

function printSessionTable(sessions: LocalSession[]): void {
  console.log();
  console.log(
    `  ${dim(padRight("#", 4))}${padRight("SESSION", 16)}${padRight("BRANCH", 20)}${padRight("DATE", 14)}${padLeft("SIZE", 10)}${padLeft("MSGS", 8)}`
  );
  console.log(`  ${dim("─".repeat(72))}`);

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const shortId = s.sessionId.slice(0, 12) + "…";
    console.log(
      `  ${cyan(padRight(String(i + 1), 4))}${padRight(shortId, 16)}${padRight(s.gitBranch.slice(0, 18), 20)}${padRight(formatDate(s.lastTimestamp), 14)}${padLeft(formatBytes(s.fileSize), 10)}${padLeft(String(s.messageCount), 8)}`
    );
  }
  console.log();
}

async function syncSessions(sessions: LocalSession[]): Promise<void> {
  console.log();
  const total = sessions.length;
  let synced = 0;
  let failed = 0;

  for (const session of sessions) {
    const shortId = session.sessionId.slice(0, 12);
    process.stdout.write(`  ${dim(`[${synced + failed + 1}/${total}]`)} Syncing ${shortId}… `);

    try {
      await syncSessionToServer(session);
      synced++;
      process.stdout.write(`${green("✓")} ${dim(formatBytes(session.fileSize))}\n`);
    } catch (err) {
      failed++;
      process.stdout.write(`${red("✗")} ${dim((err as Error).message)}\n`);
    }
  }

  console.log();
  if (failed === 0) {
    console.log(`  ${green("Done!")} ${bold(String(synced))} sessions synced.`);
  } else {
    console.log(`  ${yellow("Done.")} ${bold(String(synced))} synced, ${red(String(failed))} failed.`);
  }
  console.log();
}

function parseSelection(input: string, max: number): number[] | "all" | "back" | "quit" | null {
  const lower = input.toLowerCase();
  if (lower === "q" || lower === "quit") return "quit";
  if (lower === "b" || lower === "back") return "back";
  if (lower === "a" || lower === "all") return "all";

  // Parse comma-separated numbers and ranges like "1,3,5-7"
  const indices: number[] = [];
  const parts = input.split(",").map((p) => p.trim());
  for (const part of parts) {
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-").map((s) => s.trim());
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end)) return null;
      for (let i = start; i <= end; i++) {
        if (i >= 1 && i <= max) indices.push(i - 1);
      }
    } else {
      const n = parseInt(part, 10);
      if (isNaN(n)) return null;
      if (n >= 1 && n <= max) indices.push(n - 1);
    }
  }

  return indices.length > 0 ? indices : null;
}

async function runDiscover(): Promise<void> {
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

  console.log();
  console.log(
    `  ${bold(String(unsyncedSessions.length))} unsynced sessions across ${bold(String(groups.length))} projects`
  );

  const prompt = createPrompt();

  // Main loop: project browser
  let running = true;
  while (running) {
    printProjectTable(groups);

    const totalSize = unsyncedSessions.reduce((sum, s) => sum + s.fileSize, 0);
    console.log(
      `  ${dim(`[a] Sync all (${formatBytes(totalSize)})`)}  ${dim("[1-" + groups.length + "] Browse project")}  ${dim("[q] Quit")}`
    );

    const input = await prompt.ask(`  ${cyan("❯")} `);
    const selection = parseSelection(input, groups.length);

    if (selection === "quit") {
      running = false;
      break;
    }

    if (selection === "back") {
      continue; // already at top level
    }

    if (selection === "all") {
      await syncSessions(unsyncedSessions);
      running = false;
      break;
    }

    if (selection === null) {
      console.log(`  ${dim("Invalid input. Enter a number, 'a' for all, or 'q' to quit.")}`);
      continue;
    }

    // User selected a project — drill into it
    for (const idx of selection) {
      const group = groups[idx];
      await browseProject(prompt, group);
    }
  }

  prompt.close();
}

async function browseProject(
  prompt: { ask: (q: string) => Promise<string> },
  group: ProjectGroup
): Promise<void> {
  let browsing = true;
  while (browsing) {
    console.log();
    console.log(`  ${bold(group.projectName)} ${dim(`— ${group.sessions.length} unsynced sessions`)}`);
    printSessionTable(group.sessions);

    const totalSize = group.sessions.reduce((sum, s) => sum + s.fileSize, 0);
    console.log(
      `  ${dim(`[a] Sync all (${formatBytes(totalSize)})`)}  ${dim("[1-" + group.sessions.length + "] Select")}  ${dim("[b] Back")}  ${dim("[q] Quit")}`
    );

    const input = await prompt.ask(`  ${cyan("❯")} `);
    const selection = parseSelection(input, group.sessions.length);

    if (selection === "quit") {
      process.exit(0);
    }

    if (selection === "back") {
      browsing = false;
      break;
    }

    if (selection === "all") {
      await syncSessions(group.sessions);
      // Remove synced sessions from the group
      group.sessions.length = 0;
      browsing = false;
      break;
    }

    if (selection === null) {
      console.log(`  ${dim("Invalid input. Enter numbers (e.g. 1,3,5-7), 'a' for all, or 'b' to go back.")}`);
      continue;
    }

    // Sync selected sessions
    const selected = selection.map((i) => group.sessions[i]);
    await syncSessions(selected);

    // Remove synced sessions from the group
    const syncedSet = new Set(selected.map((s) => s.sessionId));
    group.sessions = group.sessions.filter((s) => !syncedSet.has(s.sessionId));

    if (group.sessions.length === 0) {
      console.log(`  ${green("All sessions in this project are now synced!")}`);
      browsing = false;
    }
  }
}

// ── Single file sync ───────────────────────────────────────────────────────

async function syncFile(filePath: string): Promise<void> {
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
}

// ── Entry point ────────────────────────────────────────────────────────────

export function runSync(args: string[]): void {
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

  // Treat as a file path
  syncFile(flag).catch((err) => {
    console.error(`\n${red("Error:")} ${err.message}`);
    process.exit(1);
  });
}
