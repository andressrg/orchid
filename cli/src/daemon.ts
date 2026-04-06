import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { getConfig, getAuthHeaders } from "./config";

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
export const PID_FILE = path.join(os.homedir(), ".orchid", "daemon.pid");
export const LOG_FILE = path.join(os.homedir(), ".orchid", "daemon.log");
const SYNC_INTERVAL_MS = 5000;
const STALE_THRESHOLD_MS = 120_000; // 2 minutes without changes → finalize

interface TrackedSession {
  transcriptPath: string;
  lastSyncedSize: number;
  lastSyncedAt: number;
  status: "active" | "done";
}

const activeSessions = new Map<string, TrackedSession>();

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stderr.write(line);
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // Log file not writable
  }
}

function sessionIdFromPath(transcriptPath: string): string {
  return path.basename(transcriptPath, ".jsonl");
}

/**
 * Derive the working directory from the transcript path.
 * ~/.claude/projects/-Users-foo-myproject/session.jsonl → /Users/foo/myproject
 */
function workingDirFromTranscriptPath(transcriptPath: string): string {
  const projectDirName = path.basename(path.dirname(transcriptPath));
  return projectDirName.replace(/^-/, "/").replace(/-/g, "/");
}

function execGit(args: string, cwd?: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function collectMetadataForPath(transcriptPath: string) {
  const workingDir = workingDirFromTranscriptPath(transcriptPath);
  const user_name = execGit("config user.name") || "unknown";
  const user_email = execGit("config user.email") || "unknown";
  let branch = execGit("rev-parse --abbrev-ref HEAD", workingDir);
  if (!branch || branch === "HEAD") branch = "detached";
  const git_remotes: string[] = [];
  const origin = execGit("remote get-url origin", workingDir);
  if (origin) git_remotes.push(origin);
  return { user_name, user_email, branch, git_remotes, working_dir: workingDir };
}

async function syncSession(transcriptPath: string): Promise<void> {
  const sessionId = sessionIdFromPath(transcriptPath);

  let transcript = "";
  let currentSize = 0;
  try {
    const content = fs.readFileSync(transcriptPath, "utf-8");
    transcript = content;
    currentSize = content.length;
  } catch {
    return; // File locked or deleted
  }

  const tracked = activeSessions.get(sessionId);
  if (tracked && tracked.lastSyncedSize === currentSize) {
    return; // No changes
  }

  const { apiUrl } = getConfig();
  const metadata = collectMetadataForPath(transcriptPath);

  const body = JSON.stringify({
    user_name: metadata.user_name,
    user_email: metadata.user_email,
    working_dir: metadata.working_dir,
    git_remotes: metadata.git_remotes,
    branch: metadata.branch,
    tool: "claude-code",
    transcript,
    status: "active",
  });

  const url = `${apiUrl.replace(/\/$/, "")}/sessions/${sessionId}`;

  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      log(`sync error: PUT ${url} returned ${res.status}: ${text}`);
      return;
    }

    activeSessions.set(sessionId, {
      transcriptPath,
      lastSyncedSize: currentSize,
      lastSyncedAt: Date.now(),
      status: "active",
    });

    log(`synced session ${sessionId} (${currentSize} bytes)`);
  } catch (err: any) {
    log(`sync error: ${err.message}`);
  }
}

async function finalizeStale(): Promise<void> {
  const now = Date.now();

  for (const [sessionId, session] of activeSessions) {
    if (session.status === "done") continue;
    if (now - session.lastSyncedAt < STALE_THRESHOLD_MS) continue;

    // Check if file size actually changed
    try {
      const content = fs.readFileSync(session.transcriptPath, "utf-8");
      if (content.length !== session.lastSyncedSize) continue;
    } catch {
      continue;
    }

    const { apiUrl } = getConfig();
    const metadata = collectMetadataForPath(session.transcriptPath);
    let transcript = "";
    try {
      transcript = fs.readFileSync(session.transcriptPath, "utf-8");
    } catch {
      continue;
    }

    const url = `${apiUrl.replace(/\/$/, "")}/sessions/${sessionId}`;
    try {
      await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          ...metadata,
          tool: "claude-code",
          transcript,
          status: "done",
        }),
      });
      session.status = "done";
      log(`finalized session ${sessionId} (stale for 2m)`);
    } catch (err: any) {
      log(`finalize error: ${err.message}`);
    }
  }
}

function findJsonlFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...findJsonlFiles(fullPath));
      else if (entry.name.endsWith(".jsonl")) results.push(fullPath);
    }
  } catch {
    // Directory not readable
  }
  return results;
}

async function scanAndSync(): Promise<void> {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return;
  const files = findJsonlFiles(CLAUDE_PROJECTS_DIR);
  for (const file of files) {
    await syncSession(file);
  }
  await finalizeStale();
}

function writePidFile(): void {
  const dir = path.dirname(PID_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid));
}

function removePidFile(): void {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

export function getDaemonPid(): number | null {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
    process.kill(pid, 0); // Check if process exists
    return pid;
  } catch {
    return null;
  }
}

export function startDaemon(): void {
  const existing = getDaemonPid();
  if (existing) {
    console.log(`Orchid daemon is already running (PID ${existing})`);
    process.exit(0);
  }

  writePidFile();
  log("daemon started");

  // Periodic full scan
  setInterval(() => {
    scanAndSync().catch((err) => log(`scan error: ${err.message}`));
  }, SYNC_INTERVAL_MS);

  // fs.watch for immediate change detection
  if (fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    try {
      fs.watch(CLAUDE_PROJECTS_DIR, { recursive: true }, (_event, filename) => {
        if (filename && filename.endsWith(".jsonl")) {
          const fullPath = path.join(CLAUDE_PROJECTS_DIR, filename);
          syncSession(fullPath).catch((err) =>
            log(`watch sync error: ${err.message}`)
          );
        }
      });
    } catch {
      log("fs.watch not available, using polling only");
    }
  }

  // Immediate initial scan
  scanAndSync().catch((err) => log(`initial scan error: ${err.message}`));

  // Graceful shutdown
  const shutdown = () => {
    log("daemon stopping");
    removePidFile();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive
  process.stdin.resume();
}
