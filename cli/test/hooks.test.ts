import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  ORCHID_HOOK_EVENTS,
  buildHookEntries,
  buildSettingsWithInstalledHooks,
  buildSettingsWithoutOrchidHooks,
  claudeHookInputFromJson,
  isOrchidHookEntry,
  mergeHooks,
  removeOrchidHooks,
  sessionStartOutputForMode,
  type HookCollection,
  type JsonObject,
  type JsonValue,
} from "../src/commands/hooks";

const entriesForEvent = (
  hooks: HookCollection,
  event: "SessionStart" | "Stop" | "SessionEnd"
): readonly JsonValue[] =>
  Array.isArray(hooks[event]) ? hooks[event] : [];

const objectFromValue = (value: JsonValue | undefined): JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};

const firstCommandForEvent = (
  hooks: HookCollection,
  event: "SessionStart" | "Stop" | "SessionEnd"
): string | null => {
  const entry = objectFromValue(entriesForEvent(hooks, event)[0]);
  const commands = Array.isArray(entry.hooks) ? entry.hooks : [];
  const command = objectFromValue(commands[0]).command;
  return typeof command === "string" ? command : null;
};

const assertHookCommand = (command: string | null, subcommand: "_on-start" | "_on-stop" | "_on-end"): void => {
  assert.notEqual(command, null);
  assert.match(command || "", /orchid-hook/);
  assert.equal((command || "").endsWith(` ${subcommand}`), true);
};

describe("buildHookEntries", () => {
  it("returns only Claude hook event keys", () => {
    const keys = Object.keys(buildHookEntries());
    assert.deepEqual(keys.filter((key) => !ORCHID_HOOK_EVENTS.includes(key as typeof ORCHID_HOOK_EVENTS[number])), []);
  });

  it("installs lifecycle hooks for current Claude sessions", () => {
    const entries = buildHookEntries();
    const startEntry = objectFromValue(entriesForEvent(entries, "SessionStart")[0]);

    assert.equal(startEntry.matcher, "startup|resume|clear|compact");
    assert.equal(entriesForEvent(entries, "Stop").length, 1);
    assert.equal(entriesForEvent(entries, "SessionEnd").length, 1);
  });

  it("uses the internal hook commands", () => {
    const entries = buildHookEntries();

    assertHookCommand(firstCommandForEvent(entries, "SessionStart"), "_on-start");
    assertHookCommand(firstCommandForEvent(entries, "Stop"), "_on-stop");
    assertHookCommand(firstCommandForEvent(entries, "SessionEnd"), "_on-end");
  });
});

describe("isOrchidHookEntry", () => {
  it("detects legacy orchid hook entries", () => {
    assert.equal(isOrchidHookEntry({
      hooks: [{ type: "command", command: "orchid hooks _on-start" }],
    }), true);
    assert.equal(isOrchidHookEntry({
      hooks: [{ type: "command", command: "orchid hooks _on-stop", timeout: 30 }],
    }), true);
    assert.equal(isOrchidHookEntry({
      matcher: "startup|resume|clear|compact",
      hooks: [{ type: "command", command: "orchid hooks _on-end" }],
    }), true);
  });

  it("detects launcher-based orchid hook entries", () => {
    assert.equal(isOrchidHookEntry({
      hooks: [{ type: "command", command: "'/Users/example/.orchid/hooks/orchid-hook' _on-start" }],
    }), true);
    assert.equal(isOrchidHookEntry({
      hooks: [{ type: "command", command: "'/Users/example/.orchid/hooks/orchid-hook' _on-stop" }],
    }), true);
    assert.equal(isOrchidHookEntry({
      matcher: "startup|resume|clear|compact",
      hooks: [{ type: "command", command: "'/Users/example/.orchid/hooks/orchid-hook' _on-end" }],
    }), true);
  });

  it("rejects non-orchid entries", () => {
    assert.equal(isOrchidHookEntry({
      hooks: [{ type: "command", command: "echo done" }],
    }), false);
    assert.equal(isOrchidHookEntry({
      hooks: [{ type: "command", command: "osascript -e 'display notification'" }],
    }), false);
    assert.equal(isOrchidHookEntry(null), false);
    assert.equal(isOrchidHookEntry({}), false);
    assert.equal(isOrchidHookEntry({ hooks: "not an array" }), false);
  });
});

describe("mergeHooks", () => {
  it("merges into empty existing hooks", () => {
    const result = mergeHooks({}, buildHookEntries());

    assert.equal(entriesForEvent(result, "SessionStart").length, 1);
    assert.equal(entriesForEvent(result, "Stop").length, 1);
    assert.equal(entriesForEvent(result, "SessionEnd").length, 1);
    assert.equal(result.__orchid_managed, undefined);
    assert.equal(result.mode, undefined);
  });

  it("preserves non-overlapping hooks", () => {
    const existing = {
      Notification: [{ matcher: "permission_prompt", hooks: [{ type: "command", command: "echo notify" }] }],
      PostToolUse: [{ matcher: "Write|Edit", hooks: [{ type: "command", command: "echo format" }] }],
    };
    const result = mergeHooks(existing, buildHookEntries());

    assert.equal(Array.isArray(result.Notification), true);
    assert.equal(Array.isArray(result.PostToolUse), true);
    assert.equal((result.Notification as readonly JsonValue[]).length, 1);
    assert.equal((result.PostToolUse as readonly JsonValue[]).length, 1);
  });

  it("merges overlapping Stop hooks", () => {
    const result = mergeHooks(
      { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] },
      buildHookEntries()
    );

    const stopEntries = entriesForEvent(result, "Stop").map(objectFromValue);

    assert.equal(stopEntries.length, 2);
    assert.equal(firstCommandForEvent({ Stop: [stopEntries[0]] }, "Stop"), "echo done");
    assertHookCommand(firstCommandForEvent({ Stop: [stopEntries[1]] }, "Stop"), "_on-stop");
  });

  it("replaces existing orchid entries without duplicates", () => {
    const result = mergeHooks(
      {
        ...buildHookEntries(),
        Notification: [{ matcher: "test", hooks: [{ type: "command", command: "echo test" }] }],
      },
      buildHookEntries()
    );

    assert.equal(entriesForEvent(result, "SessionStart").length, 1);
    assert.equal(entriesForEvent(result, "Stop").length, 1);
    assert.equal(entriesForEvent(result, "SessionEnd").length, 1);
    assert.equal(Array.isArray(result.Notification), true);
  });

  it("replaces legacy PATH-based orchid entries", () => {
    const result = mergeHooks(
      {
        SessionStart: [
          { matcher: "startup", hooks: [{ type: "command", command: "orchid hooks _on-start" }] },
        ],
        Stop: [
          { hooks: [{ type: "command", command: "orchid hooks _on-stop" }] },
        ],
        SessionEnd: [
          { hooks: [{ type: "command", command: "orchid hooks _on-end" }] },
        ],
      },
      buildHookEntries()
    );
    const startEntry = objectFromValue(entriesForEvent(result, "SessionStart")[0]);

    assert.equal(entriesForEvent(result, "SessionStart").length, 1);
    assert.equal(entriesForEvent(result, "Stop").length, 1);
    assert.equal(entriesForEvent(result, "SessionEnd").length, 1);
    assert.equal(startEntry.matcher, "startup|resume|clear|compact");
    assertHookCommand(firstCommandForEvent(result, "SessionStart"), "_on-start");
  });
});

describe("removeOrchidHooks", () => {
  it("removes orchid entries", () => {
    const result = removeOrchidHooks(buildHookEntries());

    assert.equal(result.SessionStart, undefined);
    assert.equal(result.Stop, undefined);
    assert.equal(result.SessionEnd, undefined);
  });

  it("preserves non-orchid hooks on same events", () => {
    const orchid = buildHookEntries();
    const result = removeOrchidHooks({
      ...orchid,
      Notification: [{ matcher: "permission_prompt", hooks: [{ type: "command", command: "echo notify" }] }],
      Stop: [
        { hooks: [{ type: "command", command: "echo done" }] },
        ...entriesForEvent(orchid, "Stop"),
      ],
    });

    assert.equal(Array.isArray(result.Notification), true);
    assert.equal(entriesForEvent(result, "Stop").length, 1);
    assert.equal(firstCommandForEvent(result, "Stop"), "echo done");
    assert.equal(result.SessionStart, undefined);
    assert.equal(result.SessionEnd, undefined);
  });

  it("returns empty object when only orchid hooks existed", () => {
    assert.equal(Object.keys(removeOrchidHooks(buildHookEntries())).length, 0);
  });
});

describe("settings helpers", () => {
  it("installs hooks without mutating other settings", () => {
    const result = buildSettingsWithInstalledHooks({
      theme: "dark",
      hooks: {
        Notification: [{ matcher: "idle_prompt", hooks: [{ type: "command", command: "echo idle" }] }],
      },
    });

    const hooks = objectFromValue(result.hooks);

    assert.equal(result.theme, "dark");
    assert.equal(Array.isArray(hooks.Notification), true);
    assert.equal(entriesForEvent(hooks, "SessionStart").length, 1);
  });

  it("removes only Orchid hooks from settings", () => {
    const installed = buildSettingsWithInstalledHooks({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo done" }] }],
      },
    });
    const result = buildSettingsWithoutOrchidHooks(installed);
    const hooks = objectFromValue(result.hooks);

    assert.equal(firstCommandForEvent(hooks, "Stop"), "echo done");
    assert.equal(hooks.SessionStart, undefined);
    assert.equal(hooks.SessionEnd, undefined);
  });
});

describe("Claude hook input/output", () => {
  it("reads the current Claude transcript_path field", () => {
    const input = claudeHookInputFromJson({
      session_id: "session-123",
      transcript_path: "/tmp/session-123.jsonl",
      cwd: "/tmp/project",
      hook_event_name: "Stop",
    }, "/fallback");

    assert.deepEqual(input, {
      sessionId: "session-123",
      transcriptPath: "/tmp/session-123.jsonl",
      cwd: "/tmp/project",
    });
  });

  it("falls back to the process cwd when Claude omits cwd", () => {
    const input = claudeHookInputFromJson({
      session_id: "session-123",
      transcript_path: "/tmp/session-123.jsonl",
    }, "/fallback");

    assert.equal(input.cwd, "/fallback");
  });

  it("returns SessionStart JSON context instead of plain text", () => {
    const output = sessionStartOutputForMode({
      mode: "auto",
      sessionId: "session-123",
      webUrl: "https://www.orchidkeep.com",
    });
    const hookSpecificOutput = objectFromValue(output.hookSpecificOutput);

    assert.equal(hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(String(hookSpecificOutput.additionalContext), /Orchid is syncing/);
  });
});
