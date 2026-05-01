import { execSync, spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { startSyncWatcher } from '../sync';

export interface GitMetadata {
  user_name: string;
  user_email: string;
  branch: string;
  git_remotes: string[];
  working_dir: string;
}

function execGit(args: string, cwd?: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

function isGitRepo(dir: string): boolean {
  return execGit('rev-parse --git-dir', dir) !== '';
}

function collectRemotes(workingDir: string): string[] {
  const remotes: string[] = [];

  // Collect origin URL from the working directory itself
  if (isGitRepo(workingDir)) {
    const origin = execGit('remote get-url origin', workingDir);
    if (origin) {
      remotes.push(origin);
    }
  }

  // Check immediate subdirectories for git repos
  try {
    const entries = fs.readdirSync(workingDir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name.startsWith('.') ||
        entry.name === 'node_modules'
      ) {
        continue;
      }
      const subDir = path.join(workingDir, entry.name);
      if (isGitRepo(subDir)) {
        const origin = execGit('remote get-url origin', subDir);
        if (origin && !remotes.includes(origin)) {
          remotes.push(origin);
        }
      }
    }
  } catch {
    // Directory not readable — skip
  }

  return remotes;
}

export function collectGitMetadata(): GitMetadata {
  const workingDir = process.cwd();

  const user_name = execGit('config user.name') || 'unknown';
  const user_email = execGit('config user.email') || 'unknown';

  let branch = execGit('rev-parse --abbrev-ref HEAD', workingDir);
  if (!branch || branch === 'HEAD') {
    branch = 'detached';
  }

  const git_remotes = collectRemotes(workingDir);

  return {
    user_name,
    user_email,
    branch,
    git_remotes,
    working_dir: workingDir,
  };
}

/**
 * Recursively find all .jsonl files under a directory.
 */
function findJsonlFiles(dir: string): { path: string; birthtimeMs: number }[] {
  const results: { path: string; birthtimeMs: number }[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findJsonlFiles(fullPath));
      } else if (entry.name.endsWith('.jsonl')) {
        try {
          const stat = fs.statSync(fullPath);
          results.push({ path: fullPath, birthtimeMs: stat.birthtimeMs });
        } catch {
          // File may have been deleted between readdir and stat
        }
      }
    }
  } catch {
    // Directory not readable
  }

  return results;
}

/**
 * Find the newest .jsonl transcript file created after startTime
 * in ~/.claude/projects/.
 */
export function findTranscriptFile(startTimeMs: number): string | null {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');

  if (!fs.existsSync(claudeProjectsDir)) {
    return null;
  }

  const files = findJsonlFiles(claudeProjectsDir);

  let newestFile: string | null = null;
  let newestTime = 0;

  for (const file of files) {
    if (file.birthtimeMs > startTimeMs && file.birthtimeMs > newestTime) {
      newestTime = file.birthtimeMs;
      newestFile = file.path;
    }
  }

  return newestFile;
}

/** Stored transcript path — used by the sync watcher (US-009). */
let detectedTranscriptPath: string | null = null;

export function getDetectedTranscriptPath(): string | null {
  return detectedTranscriptPath;
}

export function runClaude(args: string[]): void {
  const metadata = collectGitMetadata();

  process.stderr.write(
    `[orchid] user: ${metadata.user_name} <${metadata.user_email}>\n`,
  );
  process.stderr.write(`[orchid] branch: ${metadata.branch}\n`);
  process.stderr.write(`[orchid] working_dir: ${metadata.working_dir}\n`);
  process.stderr.write(
    `[orchid] git_remotes: ${metadata.git_remotes.length > 0 ? metadata.git_remotes.join(', ') : '(none)'}\n`,
  );

  const startTimeMs = Date.now();

  // Spawn claude with all args, inheriting stdio for full interactivity
  const child: ChildProcess = spawn('claude', args, {
    stdio: 'inherit',
    env: process.env,
  });

  let syncWatcher: ReturnType<typeof startSyncWatcher> | null = null;

  // Poll for transcript file every 2 seconds
  const pollInterval = setInterval(() => {
    if (!detectedTranscriptPath) {
      detectedTranscriptPath = findTranscriptFile(startTimeMs);
      if (detectedTranscriptPath) {
        process.stderr.write(
          `[orchid] transcript detected: ${detectedTranscriptPath}\n`,
        );
        syncWatcher = startSyncWatcher(detectedTranscriptPath, metadata);
      }
    }
  }, 2000);

  child.on('error', (err) => {
    clearInterval(pollInterval);
    if (syncWatcher) syncWatcher.stop();
    process.stderr.write(`[orchid] error spawning claude: ${err.message}\n`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    clearInterval(pollInterval);

    // One final attempt to detect transcript if not found yet
    if (!detectedTranscriptPath) {
      detectedTranscriptPath = findTranscriptFile(startTimeMs);
      if (detectedTranscriptPath) {
        process.stderr.write(
          `[orchid] transcript detected on exit: ${detectedTranscriptPath}\n`,
        );
        syncWatcher = startSyncWatcher(detectedTranscriptPath, metadata);
      }
    }

    const exit = () => {
      if (signal) {
        process.kill(process.pid, signal);
      } else {
        process.exit(code ?? 1);
      }
    };

    if (syncWatcher) {
      process.stderr.write(`[orchid] performing final sync...\n`);
      syncWatcher.finalSync().then(exit);
    } else {
      exit();
    }
  });

  // Forward signals to child and perform final sync
  const handleSignal = (sig: NodeJS.Signals) => {
    child.kill(sig);
  };
  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
}
