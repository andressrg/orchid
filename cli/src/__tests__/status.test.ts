import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let mockDaemonPid: number | null = null;
let mockLogFile: string;

vi.mock("../daemon", () => ({
  get getDaemonPid() {
    return () => mockDaemonPid;
  },
  get LOG_FILE() {
    return mockLogFile;
  },
}));

describe("status command", () => {
  let tmpDir: string;
  let logs: string[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchid-test-status-"));
    mockLogFile = path.join(tmpDir, "daemon.log");
    mockDaemonPid = null;

    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.join(" "));
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("shows not running when daemon is stopped", async () => {
    mockDaemonPid = null;

    vi.resetModules();
    const { runStatus } = await import("../commands/status");

    runStatus();

    const output = logs.join("\n");
    expect(output).toContain("not running");
    expect(output).toContain("orchid install");
  });

  it("shows running status with PID", async () => {
    mockDaemonPid = 42;

    vi.resetModules();
    const { runStatus } = await import("../commands/status");

    runStatus();

    const output = logs.join("\n");
    expect(output).toContain("running");
    expect(output).toContain("42");
  });

  it("shows session count from log file", async () => {
    mockDaemonPid = 42;

    const logContent = [
      "[2024-01-01T00:00:00Z] daemon started",
      "[2024-01-01T00:00:05Z] synced session abc123 (5000 bytes)",
      "[2024-01-01T00:00:10Z] synced session def456 (3000 bytes)",
      "[2024-01-01T00:02:10Z] finalized session abc123 (stale for 2m)",
    ].join("\n");
    fs.writeFileSync(mockLogFile, logContent);

    vi.resetModules();
    const { runStatus } = await import("../commands/status");

    runStatus();

    const output = logs.join("\n");
    expect(output).toContain("Sessions captured: 2");
  });

  it("shows recent activity lines", async () => {
    mockDaemonPid = 42;

    const lines = Array.from(
      { length: 15 },
      (_, i) => `[2024-01-01T00:00:${String(i).padStart(2, "0")}Z] line ${i}`
    );
    fs.writeFileSync(mockLogFile, lines.join("\n"));

    vi.resetModules();
    const { runStatus } = await import("../commands/status");

    runStatus();

    const output = logs.join("\n");
    // Should show last 10 lines
    expect(output).toContain("line 14");
    expect(output).toContain("line 5");
    expect(output).not.toContain("line 4");
  });

  it("handles missing log file gracefully", async () => {
    mockDaemonPid = 42;

    vi.resetModules();
    const { runStatus } = await import("../commands/status");

    runStatus();

    const output = logs.join("\n");
    expect(output).toContain("No log file found");
  });
});
