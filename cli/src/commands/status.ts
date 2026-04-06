import * as fs from "fs";
import { getDaemonPid, LOG_FILE } from "../daemon";

export function runStatus(): void {
  const pid = getDaemonPid();

  if (pid) {
    console.log(`  Orchid daemon is running (PID ${pid})\n`);
  } else {
    console.log("  Orchid daemon is not running.\n");
    console.log(
      '  Run "orchid install" to start capturing conversations automatically.\n'
    );
    return;
  }

  try {
    const log = fs.readFileSync(LOG_FILE, "utf-8");
    const lines = log.trim().split("\n");
    const recent = lines.slice(-10);

    const syncedSessions = new Set<string>();
    for (const line of lines) {
      const match = line.match(/synced session (\S+)/);
      if (match) syncedSessions.add(match[1]);
      const finalMatch = line.match(/finalized session (\S+)/);
      if (finalMatch) syncedSessions.add(finalMatch[1]);
    }

    console.log(`  Sessions captured: ${syncedSessions.size}`);
    console.log(`  Log file: ${LOG_FILE}\n`);
    console.log("  Recent activity:");
    for (const line of recent) {
      console.log(`    ${line}`);
    }
    console.log();
  } catch {
    console.log("  No log file found yet.\n");
  }
}
