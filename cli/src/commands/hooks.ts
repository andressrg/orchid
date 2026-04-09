import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { tryGetConfig, getConfig, getAuthHeaders } from "../config";

// ── ANSI helpers ──────────────────────────────────────────────────────────

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

// ── Constants ─────────────────────────────────────────────────────────────

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const ORCHID_HOOKS_DIR = path.join(os.homedir(), ".orchid", "hooks");
const ORCHID_HOOK_MARKER = "__orchid_managed";

// ── Settings helpers ──────────────────────────────────────────────────────

const readSettings = (): Record<string, unknown> => {
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, "utf-8"));
  } catch {
    return {};
  }
};

const writeSettings = (settings: Record<string, unknown>): void => {
  const dir = path.dirname(CLAUDE_SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
};

const ensureDir = (dir: string): void => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

// ── Hook definitions ──────────────────────────────────────────────────────

export type HookMode = "auto" | "prompt";

export const buildHookConfig = (mode: HookMode) => ({
  [ORCHID_HOOK_MARKER]: true,
  mode,
  SessionStart: [
    {
      matcher: "startup",
      hooks: [
        {
          type: "command",
          command: "orchid hooks _on-start",
          timeout: 10,
        },
      ],
    },
  ],
  Stop: [
    {
      hooks: [
        {
          type: "command",
          command: "orchid hooks _on-stop",
          timeout: 30,
        },
      ],
    },
  ],
  SessionEnd: [
    {
      hooks: [
        {
          type: "command",
          command: "orchid hooks _on-end",
          timeout: 30,
        },
      ],
    },
  ],
});

// ── Install ───────────────────────────────────────────────────────────────

const installHooks = (mode: HookMode): void => {
  const config = tryGetConfig();
  if (!config) {
    console.error(red("Error: Not authenticated."));
    console.error(`Run ${cyan("orchid login")} first.\n`);
    process.exit(1);
  }

  const settings = readSettings();
  const existingHooks = (settings.hooks ?? {}) as Record<string, unknown>;

  // Check if already installed
  if (existingHooks[ORCHID_HOOK_MARKER]) {
    const currentMode = existingHooks.mode as string;
    if (currentMode === mode) {
      console.log(`${green("✓")} Orchid hooks already installed ${dim(`(mode: ${mode})`)}`);
      return;
    }
    console.log(`${yellow("→")} Updating hook mode from ${bold(currentMode)} to ${bold(mode)}`);
  }

  const orchidHooks = buildHookConfig(mode);

  // Merge with existing hooks — preserve non-orchid hooks on the same events
  const mergedHooks = mergeHooks(existingHooks, orchidHooks);
  settings.hooks = mergedHooks;

  writeSettings(settings);
  ensureDir(ORCHID_HOOKS_DIR);

  console.log("");
  console.log(`  ${green("✓")} Orchid hooks installed into Claude Code`);
  console.log("");
  console.log(`  ${dim("Mode:")}    ${bold(mode)}`);
  console.log(`  ${dim("Config:")}  ${dim(CLAUDE_SETTINGS_PATH)}`);
  console.log("");

  if (mode === "auto") {
    console.log(`  Every conversation will be synced automatically.`);
  } else {
    console.log(`  Claude will ask if you want to sync at the start of each conversation.`);
  }

  console.log(`  View synced conversations at ${cyan(config.webUrl)}`);
  console.log("");
};

// ── Uninstall ─────────────────────────────────────────────────────────────

const uninstallHooks = (): void => {
  const settings = readSettings();
  const existingHooks = (settings.hooks ?? {}) as Record<string, unknown>;

  if (!existingHooks[ORCHID_HOOK_MARKER]) {
    console.log(`${dim("Orchid hooks are not installed.")}`);
    return;
  }

  // Remove orchid-managed hooks, keep others
  const cleaned = removeOrchidHooks(existingHooks);
  if (Object.keys(cleaned).length === 0) {
    delete settings.hooks;
  } else {
    settings.hooks = cleaned;
  }

  writeSettings(settings);

  // Clean up state files
  cleanupStateFiles();

  console.log("");
  console.log(`  ${green("✓")} Orchid hooks removed from Claude Code`);
  console.log("");
};

// ── Status ────────────────────────────────────────────────────────────────

const showStatus = (): void => {
  const settings = readSettings();
  const existingHooks = (settings.hooks ?? {}) as Record<string, unknown>;

  console.log("");

  if (existingHooks[ORCHID_HOOK_MARKER]) {
    const mode = (existingHooks.mode as string) || "unknown";
    console.log(`  ${green("●")} Orchid hooks are ${green("installed")}`);
    console.log(`  ${dim("Mode:")}    ${bold(mode)}`);
    console.log(`  ${dim("Config:")}  ${dim(CLAUDE_SETTINGS_PATH)}`);

    const config = tryGetConfig();
    if (config) {
      console.log(`  ${dim("Auth:")}    ${green("authenticated")}`);
      console.log(`  ${dim("Server:")}  ${dim(config.apiUrl)}`);
    } else {
      console.log(`  ${dim("Auth:")}    ${red("not authenticated")} — run ${cyan("orchid login")}`);
    }

    // Show active sync sessions
    const activeSessions = listActiveHookSessions();
    if (activeSessions.length > 0) {
      console.log(`  ${dim("Active:")}  ${bold(String(activeSessions.length))} session(s) syncing`);
    }
  } else {
    console.log(`  ${dim("○")} Orchid hooks are ${dim("not installed")}`);
    console.log(`  Run ${cyan("orchid hooks install")} to set up.`);
  }

  console.log("");
};

// ── Hook merge/remove helpers ─────────────────────────────────────────────

export const ORCHID_HOOK_EVENTS = ["SessionStart", "Stop", "SessionEnd"] as const;

export const mergeHooks = (
  existing: Record<string, unknown>,
  orchid: Record<string, unknown>
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  // Copy non-orchid, non-event keys from existing
  Object.entries(existing)
    .filter(([key]) => key !== ORCHID_HOOK_MARKER && key !== "mode" && !ORCHID_HOOK_EVENTS.includes(key as typeof ORCHID_HOOK_EVENTS[number]))
    .forEach(([key, value]) => { result[key] = value; });

  // For each event, merge: keep non-orchid entries, add orchid entries
  ORCHID_HOOK_EVENTS.forEach((event) => {
    const existingEntries = (existing[event] as unknown[] ?? []).filter(
      (entry) => !isOrchidHookEntry(entry)
    );
    const orchidEntries = orchid[event] as unknown[] ?? [];
    const merged = [...existingEntries, ...orchidEntries];
    if (merged.length > 0) result[event] = merged;
  });

  // Copy orchid marker and mode
  result[ORCHID_HOOK_MARKER] = orchid[ORCHID_HOOK_MARKER];
  result.mode = orchid.mode;

  return result;
};

export const removeOrchidHooks = (existing: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  Object.entries(existing)
    .filter(([key]) => key !== ORCHID_HOOK_MARKER && key !== "mode")
    .forEach(([key, value]) => {
      if (ORCHID_HOOK_EVENTS.includes(key as typeof ORCHID_HOOK_EVENTS[number])) {
        const filtered = (value as unknown[]).filter((entry) => !isOrchidHookEntry(entry));
        if (filtered.length > 0) result[key] = filtered;
      } else {
        result[key] = value;
      }
    });

  return result;
};

export const isOrchidHookEntry = (entry: unknown): boolean => {
  if (!entry || typeof entry !== "object") return false;
  const hooks = (entry as Record<string, unknown>).hooks as unknown[];
  if (!Array.isArray(hooks)) return false;
  return hooks.some((h) => {
    const cmd = (h as Record<string, unknown>).command;
    return typeof cmd === "string" && cmd.startsWith("orchid hooks _on-");
  });
};

// ── State file helpers (for tracking active syncing sessions) ─────────────

interface HookSessionState {
  readonly sessionId: string;
  readonly cwd: string;
  readonly transcriptPath: string | null;
  readonly enabled: boolean;
  readonly startedAt: string;
}

const stateFilePath = (sessionId: string): string =>
  path.join(ORCHID_HOOKS_DIR, `${sessionId}.json`);

const readSessionState = (sessionId: string): HookSessionState | null => {
  try {
    return JSON.parse(fs.readFileSync(stateFilePath(sessionId), "utf-8"));
  } catch {
    return null;
  }
};

const writeSessionState = (state: HookSessionState): void => {
  ensureDir(ORCHID_HOOKS_DIR);
  fs.writeFileSync(stateFilePath(state.sessionId), JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
};

const removeSessionState = (sessionId: string): void => {
  try { fs.unlinkSync(stateFilePath(sessionId)); } catch { /* noop */ }
};

const listActiveHookSessions = (): readonly HookSessionState[] => {
  try {
    return fs.readdirSync(ORCHID_HOOKS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try { return JSON.parse(fs.readFileSync(path.join(ORCHID_HOOKS_DIR, f), "utf-8")) as HookSessionState; }
        catch { return null; }
      })
      .filter((s): s is HookSessionState => s !== null);
  } catch {
    return [];
  }
};

const cleanupStateFiles = (): void => {
  try {
    fs.readdirSync(ORCHID_HOOKS_DIR)
      .filter((f) => f.endsWith(".json"))
      .forEach((f) => {
        try { fs.unlinkSync(path.join(ORCHID_HOOKS_DIR, f)); } catch { /* noop */ }
      });
  } catch { /* noop */ }
};

// ── Git helpers ───────────────────────────────────────────────────────────

const execGit = (args: string, cwd?: string): string => {
  try {
    return execSync(`git ${args}`, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
};

const collectGitMetadata = (cwd: string) => ({
  user_name: execGit("config user.name") || "unknown",
  user_email: execGit("config user.email") || "unknown",
  branch: (() => {
    const b = fs.existsSync(cwd) ? execGit("rev-parse --abbrev-ref HEAD", cwd) : "";
    return b && b !== "HEAD" ? b : "detached";
  })(),
  git_remotes: (() => {
    if (!fs.existsSync(cwd)) return [];
    const origin = execGit("remote get-url origin", cwd);
    return origin ? [origin] : [];
  })(),
  working_dir: cwd,
});

// ── Transcript finder ─────────────────────────────────────────────────────

const findTranscriptForSession = (sessionId: string, cwd: string): string | null => {
  const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(claudeProjectsDir)) return null;

  // Try direct lookup: the session ID is the filename
  try {
    const projectDirs = fs.readdirSync(claudeProjectsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory());

    // Search all project dirs for a file matching the session ID
    const match = projectDirs.reduce<string | null>((found, projDir) => {
      if (found) return found;
      const candidate = path.join(claudeProjectsDir, projDir.name, `${sessionId}.jsonl`);
      return fs.existsSync(candidate) ? candidate : null;
    }, null);

    if (match) return match;
  } catch { /* fallthrough */ }

  return null;
};

// ── Sync helper ───────────────────────────────────────────────────────────

const syncTranscript = async (
  sessionId: string,
  transcriptPath: string,
  cwd: string,
  status: "active" | "done"
): Promise<void> => {
  const config = tryGetConfig();
  if (!config) return;

  const transcript = (() => {
    try { return fs.readFileSync(transcriptPath, "utf-8"); }
    catch { return null; }
  })();

  if (!transcript) return;

  const gitMeta = collectGitMetadata(cwd);
  const url = `${config.apiUrl.replace(/\/$/, "")}/sessions/${sessionId}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({
      user_name: gitMeta.user_name,
      user_email: gitMeta.user_email,
      working_dir: cwd,
      git_remotes: gitMeta.git_remotes,
      branch: gitMeta.branch,
      tool: "claude-code",
      transcript,
      status,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sync failed (${res.status}): ${text}`);
  }
};

// ── Hook event handlers ───────────────────────────────────────────────────

const readStdinJson = (): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        resolve({});
      }
    });
    // If stdin is already closed or not piped, resolve immediately
    if (process.stdin.readableEnded) resolve({});
    setTimeout(() => resolve({}), 3000); // Safety timeout
  });

const handleOnStart = async (): Promise<void> => {
  const config = tryGetConfig();
  if (!config) {
    // Not configured — silently exit
    process.exit(0);
  }

  const input = await readStdinJson();
  const sessionId = (input.session_id as string) || "";
  const cwd = (input.cwd as string) || process.cwd();

  if (!sessionId) {
    process.exit(0);
  }

  // Read current hook mode
  const settings = readSettings();
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
  const mode = (hooks.mode as string) || "auto";

  // Create session state
  const state: HookSessionState = {
    sessionId,
    cwd,
    transcriptPath: null,
    enabled: mode === "auto",
    startedAt: new Date().toISOString(),
  };

  writeSessionState(state);

  // Output message to Claude's context
  if (mode === "auto") {
    process.stdout.write(
      `🌸 Orchid is syncing this conversation. ` +
      `View it live at ${config.webUrl}/sessions/${sessionId}\n`
    );
  } else {
    // Prompt mode: ask Claude to offer syncing
    process.stdout.write(
      `🌸 Orchid sync is available for this conversation. ` +
      `If the user wants to sync, run: orchid hooks _enable-sync ${sessionId}\n` +
      `The conversation can then be viewed at ${config.webUrl}/sessions/${sessionId}\n` +
      `Briefly mention that Orchid sync is available — do not be pushy about it.\n`
    );
  }
};

const handleOnStop = async (): Promise<void> => {
  const config = tryGetConfig();
  if (!config) process.exit(0);

  const input = await readStdinJson();
  const sessionId = (input.session_id as string) || "";
  const cwd = (input.cwd as string) || process.cwd();

  if (!sessionId) process.exit(0);

  // Check if sync is enabled for this session
  const state = readSessionState(sessionId);
  if (!state || !state.enabled) process.exit(0);

  // Find transcript if we haven't yet
  const transcriptPath = state.transcriptPath || findTranscriptForSession(sessionId, cwd);
  if (!transcriptPath) process.exit(0);

  // Update state with transcript path
  if (!state.transcriptPath) {
    writeSessionState({ ...state, transcriptPath });
  }

  // Sync — silently (don't pollute Claude's context)
  try {
    await syncTranscript(sessionId, transcriptPath, cwd, "active");
  } catch {
    // Silent failure — don't interrupt the conversation
  }

  // Output nothing to keep Claude's context clean
};

const handleOnEnd = async (): Promise<void> => {
  const config = tryGetConfig();
  if (!config) process.exit(0);

  const input = await readStdinJson();
  const sessionId = (input.session_id as string) || "";
  const cwd = (input.cwd as string) || process.cwd();

  if (!sessionId) process.exit(0);

  const state = readSessionState(sessionId);

  // If sync was enabled, do a final sync with status "done"
  if (state?.enabled) {
    const transcriptPath = state.transcriptPath || findTranscriptForSession(sessionId, cwd);
    if (transcriptPath) {
      try {
        await syncTranscript(sessionId, transcriptPath, cwd, "done");
        process.stderr.write(`🌸 Orchid: conversation synced → ${config.webUrl}/sessions/${sessionId}\n`);
      } catch (err) {
        process.stderr.write(`🌸 Orchid: sync failed — ${(err as Error).message}\n`);
      }
    }
  } else {
    // Sync wasn't enabled — offer a reminder
    const transcriptPath = findTranscriptForSession(sessionId, cwd);
    if (transcriptPath) {
      process.stderr.write(
        `🌸 Orchid: This conversation wasn't synced. Run ${cyan("orchid sync --discover")} to sync it later.\n`
      );
    }
  }

  // Clean up state file
  removeSessionState(sessionId);
};

const handleEnableSync = async (sessionId: string): Promise<void> => {
  if (!sessionId) {
    console.error("Usage: orchid hooks _enable-sync <session-id>");
    process.exit(1);
  }

  const config = tryGetConfig();
  if (!config) {
    console.error(red("Not authenticated. Run orchid login first."));
    process.exit(1);
  }

  const state = readSessionState(sessionId);
  if (!state) {
    // Create state if it doesn't exist (in case _on-start didn't fire)
    writeSessionState({
      sessionId,
      cwd: process.cwd(),
      transcriptPath: null,
      enabled: true,
      startedAt: new Date().toISOString(),
    });
  } else {
    writeSessionState({ ...state, enabled: true });
  }

  console.log(`${green("✓")} Orchid sync enabled for this conversation.`);
  console.log(`${dim("View it at:")} ${config.webUrl}/sessions/${sessionId}`);
};

// ── CLI entry point ───────────────────────────────────────────────────────

const HOOKS_HELP = `orchid hooks - manage Claude Code integration

Usage:
  orchid hooks install [--mode auto|prompt]  Install hooks into Claude Code
  orchid hooks uninstall                     Remove hooks from Claude Code
  orchid hooks status                        Show hook installation status

Modes:
  auto     Sync every conversation automatically ${dim("(default)")}
  prompt   Claude asks at the start of each conversation

Examples:
  orchid hooks install              Install with auto-sync
  orchid hooks install --mode prompt  Install with prompt mode
  orchid hooks uninstall            Remove all Orchid hooks
`;

export const runHooks = async (args: readonly string[]): Promise<void> => {
  const subcommand = args[0];

  switch (subcommand) {
    case "install": {
      const modeIdx = args.indexOf("--mode");
      const mode = modeIdx !== -1 ? (args[modeIdx + 1] as HookMode) : "auto";
      if (mode !== "auto" && mode !== "prompt") {
        console.error(`Invalid mode: ${mode}. Use "auto" or "prompt".`);
        process.exit(1);
      }
      installHooks(mode);
      break;
    }
    case "uninstall":
      uninstallHooks();
      break;
    case "status":
      showStatus();
      break;

    // Internal handlers (called by Claude Code hooks)
    case "_on-start":
      await handleOnStart();
      break;
    case "_on-stop":
      await handleOnStop();
      break;
    case "_on-end":
      await handleOnEnd();
      break;
    case "_enable-sync":
      await handleEnableSync(args[1]);
      break;

    case "--help":
    case "-h":
    case undefined:
      console.log(HOOKS_HELP);
      break;
    default:
      console.error(`Unknown hooks subcommand: ${subcommand}`);
      console.error('Run "orchid hooks --help" for usage.');
      process.exit(1);
  }
};
