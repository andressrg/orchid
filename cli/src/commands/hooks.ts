import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { tryGetConfig } from "../config";

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

interface HookEntry {
  type: string;
  command: string;
  if?: string;
}

interface HookGroup {
  matcher: string;
  hooks: HookEntry[];
}

interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

function readSettings(): ClaudeSettings {
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeSettings(settings: ClaudeSettings): void {
  const dir = path.dirname(CLAUDE_SETTINGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

function isOrchidHook(hook: HookEntry): boolean {
  return hook.command.startsWith("orchid hooks ");
}

function installHooks(): void {
  const settings = readSettings();
  const hooks = settings.hooks || {};

  // PostToolUse hook: fire after Bash git commit commands
  const postToolUse: HookGroup[] = hooks.PostToolUse || [];
  const existingBashGroup = postToolUse.find(
    (g) => g.matcher === "Bash" && g.hooks.some(isOrchidHook)
  );

  if (!existingBashGroup) {
    postToolUse.push({
      matcher: "Bash",
      hooks: [
        {
          type: "command",
          command: "orchid hooks _on-commit",
        },
      ],
    });
  }

  hooks.PostToolUse = postToolUse;
  settings.hooks = hooks;

  writeSettings(settings);
  console.log("\x1b[32m✓\x1b[0m Installed PostToolUse hook for commit tracking");
  console.log("\x1b[90m  Hook fires after Bash commands to detect git commits\x1b[0m");
  console.log(`\x1b[90m  Settings: ${CLAUDE_SETTINGS_PATH}\x1b[0m`);
}

function uninstallHooks(): void {
  const settings = readSettings();
  const hooks = settings.hooks || {};

  // Remove orchid hooks from PostToolUse
  const postToolUse: HookGroup[] = hooks.PostToolUse || [];
  const cleaned = postToolUse
    .map((group) => ({
      ...group,
      hooks: group.hooks.filter((h) => !isOrchidHook(h)),
    }))
    .filter((group) => group.hooks.length > 0);

  if (cleaned.length > 0) {
    hooks.PostToolUse = cleaned;
  } else {
    delete hooks.PostToolUse;
  }

  settings.hooks = hooks;
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeSettings(settings);
  console.log("\x1b[32m✓\x1b[0m Uninstalled Orchid hooks");
}

function showStatus(): void {
  const settings = readSettings();
  const hooks = settings.hooks || {};
  const postToolUse: HookGroup[] = hooks.PostToolUse || [];

  const orchidHooks = postToolUse.flatMap((g) =>
    g.hooks.filter(isOrchidHook).map((h) => ({ matcher: g.matcher, ...h }))
  );

  if (orchidHooks.length === 0) {
    console.log("\x1b[33m⚠\x1b[0m  No Orchid hooks installed");
    console.log('\x1b[90m  Run "orchid hooks install" to set up commit tracking\x1b[0m');
    return;
  }

  console.log("\x1b[32m✓\x1b[0m Orchid hooks installed:");
  orchidHooks.forEach((h) => {
    console.log(`  \x1b[36mPostToolUse\x1b[0m [${h.matcher}] → ${h.command}`);
  });
}

function execGit(args: string): string {
  try {
    return execSync(`git ${args}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

async function onCommit(): Promise<void> {
  // Read PostToolUse JSON from stdin
  let input = "";
  try {
    input = fs.readFileSync("/dev/stdin", "utf-8");
  } catch {
    // No stdin available
    return;
  }

  if (!input.trim()) return;

  let payload: {
    session_id?: string;
    tool_input?: { command?: string };
    tool_response?: string;
  };

  try {
    payload = JSON.parse(input);
  } catch {
    return;
  }

  // Check if this was a git commit command
  const command = payload.tool_input?.command || "";
  if (!command.includes("git commit") && !command.includes("git merge")) {
    return;
  }

  // Check if the result indicates a successful commit (contains [branch SHA] pattern)
  const response = payload.tool_response || "";
  const commitMatch = response.match(/\[[\w/.:-]+ ([a-f0-9]{7,})\]/);
  if (!commitMatch) {
    return; // Commit didn't succeed or output format unrecognized
  }

  const shortSha = commitMatch[1];
  const sessionId = payload.session_id;

  if (!sessionId) return;

  // Get the full SHA and other git metadata
  const fullSha = execGit(`rev-parse ${shortSha}`) || shortSha;
  const branch = execGit("rev-parse --abbrev-ref HEAD");
  const remote = execGit("remote get-url origin");
  const commitMessage = execGit(`log -1 --format=%s ${fullSha}`);

  // Send to Orchid server
  const config = tryGetConfig();
  if (!config) return; // Not authenticated, skip silently

  try {
    const apiUrl = config.apiUrl.replace(/\/$/, "");
    await fetch(`${apiUrl}/session-commits`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        commit_sha: fullSha,
        branch: branch || undefined,
        remote: remote || undefined,
        message: commitMessage || undefined,
        committed_at: new Date().toISOString(),
      }),
    });
  } catch {
    // Silently fail — don't interrupt the user's flow
  }
}

const HELP = `orchid hooks — manage Claude Code hooks for commit tracking

Usage:
  orchid hooks install      Install PostToolUse hook into Claude Code settings
  orchid hooks uninstall    Remove Orchid hooks from Claude Code settings
  orchid hooks status       Show installed hook status
  orchid hooks _on-commit   (internal) Handle PostToolUse commit event
`;

export async function runHooks(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "install":
      installHooks();
      break;
    case "uninstall":
      uninstallHooks();
      break;
    case "status":
      showStatus();
      break;
    case "_on-commit":
      await onCommit();
      break;
    default:
      console.log(HELP);
      break;
  }
}
