import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// We test the hooks command by running it as a subprocess since the install/uninstall
// functions modify ~/.claude/settings.json. We use a temp dir approach.

const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

// ── Helper: read/write settings ──────────────────────────────────────────

const readSettings = (): Record<string, unknown> => {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8")); }
  catch { return {}; }
};

const writeSettings = (settings: Record<string, unknown>): void => {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("orchid hooks", () => {
  const originalSettings = readSettings();

  afterEach(() => {
    // Restore original settings after each test
    writeSettings(originalSettings);
  });

  describe("install", () => {
    it("adds orchid hooks to empty hooks section", () => {
      writeSettings({ permissions: { defaultMode: "auto" } });
      const { execSync } = require("child_process");
      execSync("node dist/main.js hooks install", { cwd: path.join(__dirname, ".."), encoding: "utf-8" });

      const settings = readSettings();
      const hooks = settings.hooks as Record<string, unknown>;

      assert.equal(hooks.__orchid_managed, true);
      assert.equal(hooks.mode, "auto");
      assert.ok(Array.isArray(hooks.SessionStart));
      assert.ok(Array.isArray(hooks.Stop));
      assert.ok(Array.isArray(hooks.SessionEnd));
    });

    it("preserves existing non-orchid hooks", () => {
      writeSettings({
        hooks: {
          Notification: [{ matcher: "permission_prompt", hooks: [{ type: "command", command: "echo notify" }] }],
          Stop: [{ hooks: [{ type: "command", command: "echo done" }] }],
          PostToolUse: [{ matcher: "Write|Edit", hooks: [{ type: "command", command: "echo format" }] }],
        },
      });

      const { execSync } = require("child_process");
      execSync("node dist/main.js hooks install", { cwd: path.join(__dirname, ".."), encoding: "utf-8" });

      const settings = readSettings();
      const hooks = settings.hooks as Record<string, unknown>;

      // Notification and PostToolUse should be preserved
      assert.ok(Array.isArray(hooks.Notification));
      assert.ok(Array.isArray(hooks.PostToolUse));

      // Stop should have both the original and orchid entry
      const stopEntries = hooks.Stop as unknown[];
      assert.equal(stopEntries.length, 2);

      // First is the original
      const firstStop = stopEntries[0] as Record<string, unknown>;
      const firstHooks = firstStop.hooks as Record<string, unknown>[];
      assert.equal((firstHooks[0] as Record<string, unknown>).command, "echo done");

      // Second is orchid
      const secondStop = stopEntries[1] as Record<string, unknown>;
      const secondHooks = secondStop.hooks as Record<string, unknown>[];
      assert.ok((secondHooks[0] as Record<string, unknown>).command?.toString().includes("orchid hooks _on-stop"));
    });

    it("installs with prompt mode", () => {
      writeSettings({});
      const { execSync } = require("child_process");
      execSync("node dist/main.js hooks install --mode prompt", { cwd: path.join(__dirname, ".."), encoding: "utf-8" });

      const settings = readSettings();
      const hooks = settings.hooks as Record<string, unknown>;
      assert.equal(hooks.mode, "prompt");
    });
  });

  describe("uninstall", () => {
    it("removes orchid hooks and preserves others", () => {
      // First install
      writeSettings({
        hooks: {
          Notification: [{ matcher: "permission_prompt", hooks: [{ type: "command", command: "echo notify" }] }],
          Stop: [{ hooks: [{ type: "command", command: "echo done" }] }],
        },
      });

      const { execSync } = require("child_process");
      execSync("node dist/main.js hooks install", { cwd: path.join(__dirname, ".."), encoding: "utf-8" });

      // Then uninstall
      execSync("node dist/main.js hooks uninstall", { cwd: path.join(__dirname, ".."), encoding: "utf-8" });

      const settings = readSettings();
      const hooks = settings.hooks as Record<string, unknown>;

      // Orchid marker should be gone
      assert.equal(hooks.__orchid_managed, undefined);
      assert.equal(hooks.mode, undefined);

      // Notification should be preserved
      assert.ok(Array.isArray(hooks.Notification));

      // Stop should only have the original (non-orchid) entry
      const stopEntries = hooks.Stop as unknown[];
      assert.equal(stopEntries.length, 1);
      const firstHooks = (stopEntries[0] as Record<string, unknown>).hooks as Record<string, unknown>[];
      assert.equal(firstHooks[0].command, "echo done");

      // SessionStart and SessionEnd should be removed (they only had orchid entries)
      assert.equal(hooks.SessionStart, undefined);
      assert.equal(hooks.SessionEnd, undefined);
    });
  });

  describe("idempotent install", () => {
    it("does not duplicate hooks on repeated install", () => {
      writeSettings({});
      const { execSync } = require("child_process");
      execSync("node dist/main.js hooks install", { cwd: path.join(__dirname, ".."), encoding: "utf-8" });
      execSync("node dist/main.js hooks install", { cwd: path.join(__dirname, ".."), encoding: "utf-8" });

      const settings = readSettings();
      const hooks = settings.hooks as Record<string, unknown>;

      // Should only have one orchid entry per event
      const stopEntries = hooks.Stop as unknown[];
      assert.equal(stopEntries.length, 1);

      const sessionStartEntries = hooks.SessionStart as unknown[];
      assert.equal(sessionStartEntries.length, 1);

      const sessionEndEntries = hooks.SessionEnd as unknown[];
      assert.equal(sessionEndEntries.length, 1);
    });
  });
});
