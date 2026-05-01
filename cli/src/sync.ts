import * as fs from 'fs';
import * as path from 'path';
import { gzipSync } from 'zlib';
import { getConfig, getAuthHeaders } from './config';
import { GitMetadata } from './git';
import { SourceTool } from './transcript';

/**
 * Derive a session ID from a transcript file path.
 * The file is like /path/to/<session-id>.jsonl — strip the .jsonl extension and take the basename.
 */
export function sessionIdFromPath(transcriptPath: string): string {
  return path.basename(transcriptPath, '.jsonl');
}

/**
 * PUT the current transcript content to the server.
 */
async function syncToServer(params: {
  readonly sessionId: string;
  readonly metadata: GitMetadata;
  readonly transcriptPath: string;
  readonly tool: SourceTool;
  readonly status: 'active' | 'done';
}): Promise<void> {
  const { apiUrl } = getConfig();

  const transcript = (() => {
    try {
      return fs.readFileSync(params.transcriptPath, 'utf-8');
    } catch {
      return '';
    }
  })();

  if (!transcript) return;

  const json = JSON.stringify({
    user_name: params.metadata.user_name,
    user_email: params.metadata.user_email,
    working_dir: params.metadata.working_dir,
    git_remotes: params.metadata.git_remotes,
    branch: params.metadata.branch,
    tool: params.tool,
    transcript,
    status: params.status,
  });

  const compressed = gzipSync(Buffer.from(json, 'utf-8'));

  const url = `${apiUrl.replace(/\/$/, '')}/sessions/${params.sessionId}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      ...getAuthHeaders(),
    },
    body: compressed,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${url} returned ${res.status}: ${text}`);
  }
}

/**
 * Start a periodic sync watcher that PUTs the transcript to the server every 5 seconds.
 * Returns a handle to stop the watcher and perform a final sync.
 */
export function startSyncWatcher(params: {
  readonly transcriptPath: string;
  readonly metadata: GitMetadata;
  readonly tool: SourceTool;
  readonly deriveSessionId?: (transcriptPath: string) => string;
}): { stop: () => void; finalSync: () => Promise<void> } {
  const sessionId = params.deriveSessionId
    ? params.deriveSessionId(params.transcriptPath)
    : sessionIdFromPath(params.transcriptPath);

  process.stderr.write(`[orchid] sync started for session ${sessionId}\n`);

  const interval = setInterval(() => {
    syncToServer({ ...params, sessionId, status: 'active' }).catch((err) => {
      process.stderr.write(`[orchid] sync error: ${err.message}\n`);
    });
  }, 5000);

  // Do an immediate first sync
  syncToServer({ ...params, sessionId, status: 'active' }).catch((err) => {
    process.stderr.write(`[orchid] sync error: ${err.message}\n`);
  });

  return {
    stop() {
      clearInterval(interval);
    },
    finalSync() {
      clearInterval(interval);
      return syncToServer({ ...params, sessionId, status: 'done' }).catch(
        (err) => {
          process.stderr.write(`[orchid] final sync error: ${err.message}\n`);
        },
      );
    },
  };
}
