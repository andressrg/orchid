import { execFileSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectGitMetadata } from '../git';
import { startSyncWatcher, sessionIdFromPath } from '../sync';
import { summarizeTranscriptMetadata } from '../transcript';

interface TranscriptCandidate {
  readonly path: string;
  readonly timestampMs: number;
}

interface SqliteThreadRow {
  readonly id: string;
  readonly rolloutPath: string;
  readonly cwd: string;
  readonly updatedAtMs: number;
  readonly createdAtMs: number;
}

const codexSessionsDir = (): string =>
  path.join(os.homedir(), '.codex', 'sessions');

const codexStateDbPath = (): string =>
  path.join(os.homedir(), '.codex', 'state_5.sqlite');

const tryStat = (filePath: string): fs.Stats | null => {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
};

const tryReadDir = (dir: string): readonly fs.Dirent[] => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

const findRolloutFiles = (dir: string): readonly TranscriptCandidate[] =>
  tryReadDir(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return findRolloutFiles(fullPath);
    if (
      !entry.isFile() ||
      !entry.name.startsWith('rollout-') ||
      !entry.name.endsWith('.jsonl')
    )
      return [];
    const stat = tryStat(fullPath);
    return stat
      ? [
          {
            path: fullPath,
            timestampMs: Math.max(stat.birthtimeMs, stat.mtimeMs),
          },
        ]
      : [];
  });

const readTranscriptPrefix = (filePath: string): string => {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(64 * 1024);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    return buffer.toString('utf-8', 0, bytesRead);
  } catch {
    return '';
  }
};

const metadataMatchesCwd = (filePath: string, cwd: string): boolean => {
  const prefix = readTranscriptPrefix(filePath);
  const metadata = summarizeTranscriptMetadata({
    transcript: prefix,
    format: 'codex-rollout-jsonl',
  });
  return metadata.cwd === null || path.resolve(metadata.cwd) === cwd;
};

const parseTimestamp = (text: string): number => Number.parseInt(text, 10) || 0;

const parseSqliteThreadRow = (line: string): SqliteThreadRow | null => {
  const [id, rolloutPath, cwd, updatedAtMs, createdAtMs] = line.split('\t');
  return id && rolloutPath && cwd
    ? {
        id,
        rolloutPath,
        cwd,
        updatedAtMs: parseTimestamp(updatedAtMs ?? '0'),
        createdAtMs: parseTimestamp(createdAtMs ?? '0'),
      }
    : null;
};

const sqlite3IsAvailable = (): boolean => {
  try {
    execFileSync('sqlite3', ['--version'], { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
};

const findRecentThreadRows = (params: {
  readonly startTimeMs: number;
  readonly cwd: string;
}): readonly SqliteThreadRow[] => {
  const dbPath = codexStateDbPath();
  if (!fs.existsSync(dbPath) || !sqlite3IsAvailable()) return [];

  const minTimeMs = Math.max(0, params.startTimeMs - 10_000);
  const query = `
SELECT threads.id, threads.rollout_path, threads.cwd,
       COALESCE(threads.updated_at_ms, threads.updated_at * 1000),
       COALESCE(threads.created_at_ms, threads.created_at * 1000)
FROM threads
WHERE COALESCE(threads.updated_at_ms, threads.updated_at * 1000) >= ${minTimeMs}
ORDER BY COALESCE(threads.updated_at_ms, threads.updated_at * 1000) DESC
LIMIT 25;`;

  try {
    return execFileSync(
      'sqlite3',
      ['-readonly', '-separator', '\t', dbPath, query],
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
      .split('\n')
      .filter((line) => line.trim())
      .map(parseSqliteThreadRow)
      .filter((row): row is SqliteThreadRow => row !== null)
      .filter((row) => path.resolve(row.cwd) === params.cwd)
      .filter((row) => fs.existsSync(row.rolloutPath));
  } catch {
    return [];
  }
};

const findTranscriptFromSqlite = (params: {
  readonly startTimeMs: number;
  readonly cwd: string;
}): string | null =>
  findRecentThreadRows(params).map((row) => row.rolloutPath)[0] ?? null;

export const findCodexTranscriptFile = (params: {
  readonly startTimeMs: number;
  readonly cwd: string;
  readonly sessionsDir?: string;
  readonly useSqlite?: boolean;
}): string | null => {
  const sqlitePath =
    params.useSqlite === false ? null : findTranscriptFromSqlite(params);
  if (sqlitePath) return sqlitePath;

  const sessionsDir = params.sessionsDir ?? codexSessionsDir();
  if (!fs.existsSync(sessionsDir)) return null;

  return (
    findRolloutFiles(sessionsDir)
      .filter((candidate) => candidate.timestampMs >= params.startTimeMs)
      .filter((candidate) => metadataMatchesCwd(candidate.path, params.cwd))
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .map((candidate) => candidate.path)[0] ?? null
  );
};

export const codexSessionIdFromTranscriptPath = (
  transcriptPath: string,
): string => {
  const transcript = readTranscriptPrefix(transcriptPath);
  const metadata = summarizeTranscriptMetadata({
    transcript,
    format: 'codex-rollout-jsonl',
  });
  const filenameMatch = path
    .basename(transcriptPath, '.jsonl')
    .match(/([0-9a-f]{8}-[0-9a-f-]{27,})$/);
  return metadata.id ?? filenameMatch?.[1] ?? sessionIdFromPath(transcriptPath);
};

const effectiveCodexCwd = (
  args: readonly string[],
  baseCwd: string,
): string => {
  const cdIndex = args.findIndex((arg) => arg === '--cd' || arg === '-C');
  const cdValue = cdIndex >= 0 ? args[cdIndex + 1] : null;
  const equalsValue = args
    .map((arg) => arg.match(/^(--cd|-C)=(.+)$/)?.[2] ?? null)
    .find((value) => value !== null);
  const requested = equalsValue ?? cdValue;
  return requested ? path.resolve(baseCwd, requested) : baseCwd;
};

export function runCodex(args: string[]): void {
  const workingDir = effectiveCodexCwd(args, process.cwd());
  const metadata = collectGitMetadata(workingDir);

  process.stderr.write(
    `[orchid] user: ${metadata.user_name} <${metadata.user_email}>\n`,
  );
  process.stderr.write(`[orchid] branch: ${metadata.branch}\n`);
  process.stderr.write(`[orchid] working_dir: ${metadata.working_dir}\n`);
  process.stderr.write(
    `[orchid] git_remotes: ${metadata.git_remotes.length > 0 ? metadata.git_remotes.join(', ') : '(none)'}\n`,
  );

  const startTimeMs = Date.now();
  const child: ChildProcess = spawn('codex', args, {
    stdio: 'inherit',
    env: process.env,
    cwd: process.cwd(),
  });

  let detectedTranscriptPath: string | null = null;
  let syncWatcher: ReturnType<typeof startSyncWatcher> | null = null;

  const startWatcherIfPossible = (label: string): void => {
    if (detectedTranscriptPath) return;
    detectedTranscriptPath = findCodexTranscriptFile({
      startTimeMs,
      cwd: workingDir,
    });
    if (!detectedTranscriptPath) return;
    process.stderr.write(
      `[orchid] transcript detected${label}: ${detectedTranscriptPath}\n`,
    );
    syncWatcher = startSyncWatcher({
      transcriptPath: detectedTranscriptPath,
      metadata,
      tool: 'codex-cli',
      deriveSessionId: codexSessionIdFromTranscriptPath,
    });
  };

  const pollInterval = setInterval(() => startWatcherIfPossible(''), 2000);

  child.on('error', (err) => {
    clearInterval(pollInterval);
    if (syncWatcher) syncWatcher.stop();
    process.stderr.write(`[orchid] error spawning codex: ${err.message}\n`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    clearInterval(pollInterval);
    startWatcherIfPossible(' on exit');

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

  const handleSignal = (sig: NodeJS.Signals) => {
    child.kill(sig);
  };
  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
}
