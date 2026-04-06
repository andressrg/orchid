import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock child_process before importing daemon
vi.mock("child_process", () => ({
  execSync: vi.fn(() => ""),
}));

// Mock config
vi.mock("../config", () => ({
  getConfig: () => ({
    apiUrl: "https://orchid.test/api",
    token: "test-token",
    webUrl: "https://orchid.test",
  }),
  getAuthHeaders: () => ({ Authorization: "Bearer test-token" }),
}));

describe("daemon", () => {
  let tmpDir: string;
  let originalHome: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchid-test-"));
    originalHome = process.env.HOME || "";
    process.env.HOME = tmpDir;

    // Create .orchid dir
    fs.mkdirSync(path.join(tmpDir, ".orchid"), { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("getDaemonPid", () => {
    it("returns null when no pid file exists", async () => {
      const { getDaemonPid } = await import("../daemon");
      expect(getDaemonPid()).toBeNull();
    });

    it("returns null when pid file has invalid content", async () => {
      const { PID_FILE } = await import("../daemon");
      const dir = path.dirname(PID_FILE);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(PID_FILE, "notanumber");
      const { getDaemonPid } = await import("../daemon");
      expect(getDaemonPid()).toBeNull();
    });

    it("returns pid when process is running", async () => {
      const { PID_FILE, getDaemonPid } = await import("../daemon");
      const dir = path.dirname(PID_FILE);
      fs.mkdirSync(dir, { recursive: true });
      // Use current process PID — we know it's alive
      fs.writeFileSync(PID_FILE, String(process.pid));
      expect(getDaemonPid()).toBe(process.pid);
    });

    it("returns null when pid file points to dead process", async () => {
      const { PID_FILE, getDaemonPid } = await import("../daemon");
      const dir = path.dirname(PID_FILE);
      fs.mkdirSync(dir, { recursive: true });
      // Use an absurdly high PID that won't exist
      fs.writeFileSync(PID_FILE, "9999999");
      expect(getDaemonPid()).toBeNull();
    });
  });

  describe("PID_FILE and LOG_FILE", () => {
    it("are in ~/.orchid/", async () => {
      const { PID_FILE, LOG_FILE } = await import("../daemon");
      expect(PID_FILE).toContain(".orchid");
      expect(PID_FILE).toMatch(/daemon\.pid$/);
      expect(LOG_FILE).toContain(".orchid");
      expect(LOG_FILE).toMatch(/daemon\.log$/);
    });
  });
});
