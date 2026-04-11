import * as fs from "fs";
import * as path from "path";
import { gzipSync } from "zlib";
import { getConfig, getAuthHeaders } from "./config";
import { GitMetadata } from "./commands/claude";

/**
 * Derive a session ID from a transcript file path.
 * The file is like /path/to/<session-id>.jsonl — strip the .jsonl extension and take the basename.
 */
export function sessionIdFromPath(transcriptPath: string): string {
  return path.basename(transcriptPath, ".jsonl");
}

/**
 * PUT the current transcript content to the server.
 */
async function syncToServer(
  sessionId: string,
  metadata: GitMetadata,
  transcriptPath: string,
  status: "active" | "done"
): Promise<void> {
  const { apiUrl } = getConfig();

  let transcript = "";
  try {
    transcript = fs.readFileSync(transcriptPath, "utf-8");
  } catch {
    // File might not exist yet or be temporarily locked
    return;
  }

  const json = JSON.stringify({
    user_name: metadata.user_name,
    user_email: metadata.user_email,
    working_dir: metadata.working_dir,
    git_remotes: metadata.git_remotes,
    branch: metadata.branch,
    tool: "claude-code",
    transcript,
    status,
  });

  const compressed = gzipSync(Buffer.from(json, "utf-8"));

  const url = `${apiUrl.replace(/\/$/, "")}/sessions/${sessionId}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
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
export function startSyncWatcher(
  transcriptPath: string,
  metadata: GitMetadata
): { stop: () => void; finalSync: () => Promise<void> } {
  const sessionId = sessionIdFromPath(transcriptPath);

  process.stderr.write(`[orchid] sync started for session ${sessionId}\n`);

  const interval = setInterval(() => {
    syncToServer(sessionId, metadata, transcriptPath, "active").catch((err) => {
      process.stderr.write(`[orchid] sync error: ${err.message}\n`);
    });
  }, 5000);

  // Do an immediate first sync
  syncToServer(sessionId, metadata, transcriptPath, "active").catch((err) => {
    process.stderr.write(`[orchid] sync error: ${err.message}\n`);
  });

  return {
    stop() {
      clearInterval(interval);
    },
    finalSync() {
      clearInterval(interval);
      return syncToServer(sessionId, metadata, transcriptPath, "done").catch(
        (err) => {
          process.stderr.write(
            `[orchid] final sync error: ${err.message}\n`
          );
        }
      );
    },
  };
}
