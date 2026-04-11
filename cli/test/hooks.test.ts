import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  mergeHooks, removeOrchidHooks, isOrchidHookEntry, buildHookEntries,
  ORCHID_HOOK_EVENTS,
} from "../src/commands/hooks";

// ── buildHookEntries ──────────────────────────────────────────────────────

describe("buildHookEntries", () => {
  it("returns only valid hook event keys", () => {
    const entries = buildHookEntries();
    const keys = Object.keys(entries);
    keys.forEach((key) => {
      assert.ok(
        ORCHID_HOOK_EVENTS.includes(key as typeof ORCHID_HOOK_EVENTS[number]),
        `Unexpected key "${key}" — only valid hook events allowed`
      );
    });
  });

  it("includes SessionStart, Stop, and SessionEnd", () => {
    const entries = buildHookEntries();
    assert.ok(Array.isArray(entries.SessionStart));
    assert.ok(Array.isArray(entries.Stop));
    assert.ok(Array.isArray(entries.SessionEnd));
  });

  it("includes correct commands", () => {
    const entries = buildHookEntries();
    const startCmd = (entries.SessionStart[0].hooks[0] as Record<string, unknown>).command;
    const stopCmd = (entries.Stop[0].hooks[0] as Record<string, unknown>).command;
    const endCmd = (entries.SessionEnd[0].hooks[0] as Record<string, unknown>).command;

    assert.equal(startCmd, "orchid hooks _on-start");
    assert.equal(stopCmd, "orchid hooks _on-stop");
    assert.equal(endCmd, "orchid hooks _on-end");
  });
});

// ── isOrchidHookEntry ─────────────────────────────────────────────────────

describe("isOrchidHookEntry", () => {
  it("detects orchid hook entries", () => {
    assert.ok(isOrchidHookEntry({
      hooks: [{ type: "command", command: "orchid hooks _on-start" }],
    }));
    assert.ok(isOrchidHookEntry({
      hooks: [{ type: "command", command: "orchid hooks _on-stop", timeout: 30 }],
    }));
    assert.ok(isOrchidHookEntry({
      matcher: "startup",
      hooks: [{ type: "command", command: "orchid hooks _on-end" }],
    }));
  });

  it("rejects non-orchid entries", () => {
    assert.ok(!isOrchidHookEntry({
      hooks: [{ type: "command", command: "echo done" }],
    }));
    assert.ok(!isOrchidHookEntry({
      hooks: [{ type: "command", command: "osascript -e 'display notification'" }],
    }));
    assert.ok(!isOrchidHookEntry(null));
    assert.ok(!isOrchidHookEntry({}));
    assert.ok(!isOrchidHookEntry({ hooks: "not an array" }));
  });
});

// ── mergeHooks ────────────────────────────────────────────────────────────

describe("mergeHooks", () => {
  it("merges into empty existing hooks", () => {
    const orchid = buildHookEntries();
    const result = mergeHooks({}, orchid);

    assert.equal((result.SessionStart as unknown[]).length, 1);
    assert.equal((result.Stop as unknown[]).length, 1);
    assert.equal((result.SessionEnd as unknown[]).length, 1);
    // Should NOT contain non-event keys
    assert.equal(result.__orchid_managed, undefined);
    assert.equal(result.mode, undefined);
  });

  it("preserves non-overlapping hooks", () => {
    const existing = {
      Notification: [{ matcher: "permission_prompt", hooks: [{ type: "command", command: "echo notify" }] }],
      PostToolUse: [{ matcher: "Write|Edit", hooks: [{ type: "command", command: "echo format" }] }],
    };
    const orchid = buildHookEntries();
    const result = mergeHooks(existing, orchid);

    assert.ok(Array.isArray(result.Notification));
    assert.ok(Array.isArray(result.PostToolUse));
    assert.equal((result.Notification as unknown[]).length, 1);
    assert.equal((result.PostToolUse as unknown[]).length, 1);
  });

  it("merges overlapping Stop hooks", () => {
    const existing = {
      Stop: [{ hooks: [{ type: "command", command: "echo done" }] }],
    };
    const orchid = buildHookEntries();
    const result = mergeHooks(existing, orchid);

    const stopEntries = result.Stop as unknown[];
    assert.equal(stopEntries.length, 2);

    const first = stopEntries[0] as Record<string, unknown>;
    assert.equal(((first.hooks as Record<string, unknown>[])[0]).command, "echo done");

    const second = stopEntries[1] as Record<string, unknown>;
    assert.ok(((second.hooks as Record<string, unknown>[])[0]).command?.toString().includes("orchid hooks _on-stop"));
  });

  it("replaces existing orchid entries (no duplicates)", () => {
    // Simulate orchid hooks already present in settings
    const existingOrchid = buildHookEntries();
    const existing = {
      ...existingOrchid,
      Notification: [{ matcher: "test", hooks: [{ type: "command", command: "echo test" }] }],
    };

    const newOrchid = buildHookEntries();
    const result = mergeHooks(existing, newOrchid);

    assert.equal((result.SessionStart as unknown[]).length, 1);
    assert.equal((result.Stop as unknown[]).length, 1);
    assert.equal((result.SessionEnd as unknown[]).length, 1);
    assert.ok(Array.isArray(result.Notification));
  });
});

// ── removeOrchidHooks ─────────────────────────────────────────────────────

describe("removeOrchidHooks", () => {
  it("removes orchid entries", () => {
    const existing = buildHookEntries();
    const result = removeOrchidHooks(existing);

    assert.equal(result.SessionStart, undefined);
    assert.equal(result.Stop, undefined);
    assert.equal(result.SessionEnd, undefined);
  });

  it("preserves non-orchid hooks on same events", () => {
    const orchid = buildHookEntries();
    const existing = {
      ...orchid,
      Notification: [{ matcher: "permission_prompt", hooks: [{ type: "command", command: "echo notify" }] }],
      Stop: [
        { hooks: [{ type: "command", command: "echo done" }] },
        ...(orchid.Stop as unknown[]),
      ],
    };

    const result = removeOrchidHooks(existing);

    assert.ok(Array.isArray(result.Notification));

    const stopEntries = result.Stop as unknown[];
    assert.equal(stopEntries.length, 1);
    assert.equal(((stopEntries[0] as Record<string, unknown>).hooks as Record<string, unknown>[])[0].command, "echo done");

    assert.equal(result.SessionStart, undefined);
    assert.equal(result.SessionEnd, undefined);
  });

  it("returns empty object when only orchid hooks existed", () => {
    const result = removeOrchidHooks(buildHookEntries());
    assert.equal(Object.keys(result).length, 0);
  });
});
