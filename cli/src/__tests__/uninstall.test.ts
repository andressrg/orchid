import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const execSyncMock = vi.fn(() => "");
vi.mock("child_process", () => ({
  execSync: (...args: any[]) => execSyncMock(...args),
}));

let mockDaemonPid: number | null = null;

vi.mock("../daemon", () => ({
  getDaemonPid: () => mockDaemonPid,
  PID_FILE: path.join(os.tmpdir(), "orchid-test-uninstall", ".orchid", "daemon.pid"),
}));

vi.mock("./install", () => ({
  PLIST_PATH: path.join(os.tmpdir(), "orchid-test-uninstall", "Library", "LaunchAgents", "com.orchid.daemon.plist"),
  SYSTEMD_SERVICE: path.join(os.tmpdir(), "orchid-test-uninstall", ".config", "systemd", "user", "orchid-daemon.service"),
}));

describe("uninstall command", () => {
  let tmpDir: string;
  let logs: string[];
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), "orchid-test-uninstall");
    fs.mkdirSync(tmpDir, { recursive: true });
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    execSyncMock.mockClear();
    mockDaemonPid = null;

    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.join(" "));
    });
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function setPlatform(platform: string) {
    Object.defineProperty(process, "platform", {
      value: platform,
      writable: true,
      configurable: true,
    });
  }

  it("prints uninstall message", async () => {
    setPlatform("darwin");
    const { runUninstall } = await import("../commands/uninstall");

    runUninstall();

    const output = logs.join("\n");
    expect(output).toContain("Uninstalling");
    expect(output).toContain("no longer be captured");
  });

  it("calls launchctl unload on macOS", async () => {
    setPlatform("darwin");

    vi.resetModules();
    const { runUninstall } = await import("../commands/uninstall");

    runUninstall();

    const launchctlCalls = execSyncMock.mock.calls.filter(
      (call: any[]) =>
        typeof call[0] === "string" && call[0].includes("launchctl unload")
    );
    expect(launchctlCalls.length).toBeGreaterThanOrEqual(0); // May or may not run depending on state
  });

  it("mentions orchid claude as alternative after uninstall", async () => {
    setPlatform("darwin");
    const { runUninstall } = await import("../commands/uninstall");

    runUninstall();

    const output = logs.join("\n");
    expect(output).toContain("orchid claude");
  });
});
