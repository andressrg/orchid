import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Track execSync calls to verify system commands are/aren't run
const execSyncMock = vi.fn(() => "/usr/local/bin/node");
vi.mock("child_process", () => ({
  execSync: (...args: any[]) => execSyncMock(...args),
}));

// Use a mutable ref so tests can change the return value
let mockPid: number | null = null;
vi.mock("../daemon", () => ({
  getDaemonPid: () => mockPid,
}));

describe("install command", () => {
  let tmpDir: string;
  let originalHome: string;
  let originalPlatform: PropertyDescriptor | undefined;
  let logs: string[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchid-test-"));
    originalHome = process.env.HOME || "";
    process.env.HOME = tmpDir;
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    execSyncMock.mockClear();
    mockPid = null;

    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: any[]) => {
      logs.push(args.join(" "));
    });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
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

  describe("macOS", () => {
    it("creates plist file without running launchctl by default", async () => {
      setPlatform("darwin");
      const { runInstall, PLIST_PATH } = await import("../commands/install");

      runInstall([]);

      expect(fs.existsSync(PLIST_PATH)).toBe(true);

      const plistContent = fs.readFileSync(PLIST_PATH, "utf-8");
      expect(plistContent).toContain("com.orchid.daemon");
      expect(plistContent).toContain("daemon-entry.js");

      const launchctlCalls = execSyncMock.mock.calls.filter(
        (call: any[]) =>
          typeof call[0] === "string" && call[0].includes("launchctl")
      );
      expect(launchctlCalls).toHaveLength(0);

      const output = logs.join("\n");
      expect(output).toContain("launchctl load");
      expect(output).toContain("orchid install --run");
    });

    it("runs launchctl when --run flag is passed", async () => {
      setPlatform("darwin");
      const { runInstall } = await import("../commands/install");

      runInstall(["--run"]);

      const launchctlCalls = execSyncMock.mock.calls.filter(
        (call: any[]) =>
          typeof call[0] === "string" && call[0].includes("launchctl load")
      );
      expect(launchctlCalls.length).toBeGreaterThan(0);

      const output = logs.join("\n");
      expect(output).toContain("Loaded LaunchAgent");
    });

    it("creates ~/Library/LaunchAgents if it doesn't exist", async () => {
      setPlatform("darwin");
      const { runInstall, PLIST_PATH } = await import("../commands/install");

      runInstall([]);

      const launchAgentsDir = path.dirname(PLIST_PATH);
      expect(fs.existsSync(launchAgentsDir)).toBe(true);
    });

    it("plist contains correct structure", async () => {
      setPlatform("darwin");
      const { runInstall, PLIST_PATH } = await import("../commands/install");

      runInstall([]);

      const content = fs.readFileSync(PLIST_PATH, "utf-8");
      expect(content).toContain("<key>RunAtLoad</key>");
      expect(content).toContain("<key>KeepAlive</key>");
      expect(content).toContain("<key>StandardOutPath</key>");
      expect(content).toContain("daemon.log");
    });
  });

  describe("linux", () => {
    it("creates systemd unit file without running systemctl by default", async () => {
      setPlatform("linux");
      const { runInstall, SYSTEMD_SERVICE } = await import(
        "../commands/install"
      );

      runInstall([]);

      expect(fs.existsSync(SYSTEMD_SERVICE)).toBe(true);

      const unitContent = fs.readFileSync(SYSTEMD_SERVICE, "utf-8");
      expect(unitContent).toContain("Orchid Daemon");
      expect(unitContent).toContain("daemon-entry.js");

      const systemctlCalls = execSyncMock.mock.calls.filter(
        (call: any[]) =>
          typeof call[0] === "string" && call[0].includes("systemctl")
      );
      expect(systemctlCalls).toHaveLength(0);

      const output = logs.join("\n");
      expect(output).toContain("systemctl --user daemon-reload");
      expect(output).toContain("orchid install --run");
    });

    it("runs systemctl when --run flag is passed", async () => {
      setPlatform("linux");
      const { runInstall } = await import("../commands/install");

      runInstall(["--run"]);

      const systemctlCalls = execSyncMock.mock.calls.filter(
        (call: any[]) =>
          typeof call[0] === "string" && call[0].includes("systemctl")
      );
      expect(systemctlCalls.length).toBe(3); // daemon-reload, enable, start
    });
  });

  describe("windows", () => {
    it("creates task XML without running schtasks by default", async () => {
      setPlatform("win32");
      const { runInstall } = await import("../commands/install");

      runInstall([]);

      const xmlPath = path.join(tmpDir, ".orchid", "orchid-task.xml");
      expect(fs.existsSync(xmlPath)).toBe(true);

      const xmlContent = fs.readFileSync(xmlPath, "utf-8");
      expect(xmlContent).toContain("Orchid Daemon");
      expect(xmlContent).toContain("daemon-entry.js");
      expect(xmlContent).toContain("<LogonTrigger>");

      // schtasks should NOT have been called
      const schtasksCalls = execSyncMock.mock.calls.filter(
        (call: any[]) =>
          typeof call[0] === "string" && call[0].includes("schtasks")
      );
      expect(schtasksCalls).toHaveLength(0);

      const output = logs.join("\n");
      expect(output).toContain("schtasks /Create");
      expect(output).toContain("orchid install --run");
    });

    it("runs schtasks when --run flag is passed", async () => {
      setPlatform("win32");
      const { runInstall } = await import("../commands/install");

      runInstall(["--run"]);

      const schtasksCalls = execSyncMock.mock.calls.filter(
        (call: any[]) =>
          typeof call[0] === "string" && call[0].includes("schtasks")
      );
      // /Create and /Run
      expect(schtasksCalls.length).toBe(2);

      const output = logs.join("\n");
      expect(output).toContain("Created and started Windows Scheduled Task");
    });

    it("task XML has correct settings", async () => {
      setPlatform("win32");
      const { runInstall } = await import("../commands/install");

      runInstall([]);

      const xmlPath = path.join(tmpDir, ".orchid", "orchid-task.xml");
      const content = fs.readFileSync(xmlPath, "utf-8");
      expect(content).toContain("<DisallowStartIfOnBatteries>false");
      expect(content).toContain("<StopIfGoingOnBatteries>false");
      expect(content).toContain("<RestartOnFailure>");
    });
  });

  describe("already running", () => {
    it("exits early if daemon is already running", async () => {
      mockPid = 12345;
      const { runInstall } = await import("../commands/install");

      runInstall([]);

      const output = logs.join("\n");
      expect(output).toContain("already running");
      expect(output).toContain("12345");
    });
  });

  describe("unsupported platform", () => {
    it("prints error for unsupported platforms", async () => {
      setPlatform("freebsd");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      const { runInstall } = await import("../commands/install");

      runInstall([]);

      const output = logs.join("\n");
      expect(output).toContain("Unsupported platform");
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});
