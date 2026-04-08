import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  displayFileSize, displayTokenCount, displayShortDate, padRight, padLeft, truncate,
  projectKeyToName, tryParseJson, extractMessageText, sumTokensFromUsage,
  groupSessionsByProject, markSessionsSynced, markGroupSessionsSynced,
  clamp, computeScrollOffset, parseKeypress,
  type LocalSession, type ProjectGroup,
} from "../src/sync-utils";

// ── Helper: create a minimal LocalSession ──────────────────────────────────

const makeSession = (overrides: Partial<LocalSession> = {}): LocalSession => ({
  filePath: "/tmp/test.jsonl",
  sessionId: "test-session-1",
  projectKey: "-Users-test-Developer-personal-orchid",
  projectName: "personal/orchid",
  cwd: "/Users/test/Developer/personal/orchid",
  gitBranch: "main",
  firstTimestamp: "2026-03-28T22:46:28.142Z",
  lastTimestamp: "2026-03-28T23:00:00.000Z",
  fileSize: 1024,
  messageCount: 10,
  totalTokens: 50000,
  summary: "Add auth middleware",
  synced: false,
  ...overrides,
});

// ── displayFileSize ────────────────────────────────────────────────────────

describe("displayFileSize", () => {
  it("formats bytes", () => {
    assert.equal(displayFileSize(0), "0 B");
    assert.equal(displayFileSize(512), "512 B");
    assert.equal(displayFileSize(1023), "1023 B");
  });

  it("formats kilobytes", () => {
    assert.equal(displayFileSize(1024), "1.0 KB");
    assert.equal(displayFileSize(1536), "1.5 KB");
    assert.equal(displayFileSize(524288), "512.0 KB");
  });

  it("formats megabytes", () => {
    assert.equal(displayFileSize(1048576), "1.0 MB");
    assert.equal(displayFileSize(3932160), "3.8 MB");
  });
});

// ── displayTokenCount ──────────────────────────────────────────────────────

describe("displayTokenCount", () => {
  it("returns dash for zero", () => {
    assert.equal(displayTokenCount(0), "—");
  });

  it("formats small numbers as-is", () => {
    assert.equal(displayTokenCount(42), "42");
    assert.equal(displayTokenCount(999), "999");
  });

  it("formats thousands with k suffix", () => {
    assert.equal(displayTokenCount(1000), "1k");
    assert.equal(displayTokenCount(50000), "50k");
    assert.equal(displayTokenCount(999999), "1000k");
  });

  it("formats millions with M suffix", () => {
    assert.equal(displayTokenCount(1_000_000), "1.0M");
    assert.equal(displayTokenCount(16_900_000), "16.9M");
  });
});

// ── displayShortDate ───────────────────────────────────────────────────────

describe("displayShortDate", () => {
  it("formats ISO dates to Mon D", () => {
    assert.equal(displayShortDate("2026-01-15T12:00:00.000Z"), "Jan 15");
    assert.equal(displayShortDate("2026-12-25T12:00:00.000Z"), "Dec 25");
  });

  it("handles single digit days", () => {
    assert.equal(displayShortDate("2026-03-05T12:00:00.000Z"), "Mar 5");
  });
});

// ── padRight / padLeft ─────────────────────────────────────────────────────

describe("padRight", () => {
  it("pads shorter strings with spaces", () => {
    assert.equal(padRight("abc", 6), "abc   ");
  });

  it("truncates longer strings", () => {
    assert.equal(padRight("abcdef", 3), "abc");
  });

  it("returns string as-is when equal length", () => {
    assert.equal(padRight("abc", 3), "abc");
  });
});

describe("padLeft", () => {
  it("pads shorter strings with spaces on the left", () => {
    assert.equal(padLeft("42", 6), "    42");
  });

  it("truncates longer strings", () => {
    assert.equal(padLeft("abcdef", 3), "abc");
  });
});

// ── truncate ───────────────────────────────────────────────────────────────

describe("truncate", () => {
  it("returns short strings unchanged", () => {
    assert.equal(truncate("hello", 10), "hello");
  });

  it("truncates with ellipsis", () => {
    assert.equal(truncate("hello world", 8), "hello w…");
  });

  it("returns string as-is at exact length", () => {
    assert.equal(truncate("hello", 5), "hello");
  });
});

// ── projectKeyToName ───────────────────────────────────────────────────────

describe("projectKeyToName", () => {
  it("extracts org/project from Developer path", () => {
    assert.equal(
      projectKeyToName("-Users-juliankmazo-Developer-personal-orchid"),
      "personal/orchid"
    );
  });

  it("preserves hyphens in project names", () => {
    assert.equal(
      projectKeyToName("-Users-juliankmazo-Developer-personal-mining-plate-crawler"),
      "personal/mining-plate-crawler"
    );
  });

  it("handles nested org paths", () => {
    assert.equal(
      projectKeyToName("-Users-juliankmazo-Developer-snappr-snappr-server"),
      "snappr/snappr-server"
    );
  });

  it("handles single segment after Developer", () => {
    assert.equal(
      projectKeyToName("-Users-juliankmazo-Developer-snappr"),
      "snappr"
    );
  });

  it("falls back to last two segments when no Developer", () => {
    assert.equal(
      projectKeyToName("-some-random-path"),
      "random/path"
    );
  });
});

// ── tryParseJson ───────────────────────────────────────────────────────────

describe("tryParseJson", () => {
  it("parses valid JSON", () => {
    assert.deepEqual(tryParseJson('{"a": 1}'), { a: 1 });
  });

  it("returns null for invalid JSON", () => {
    assert.equal(tryParseJson("not json"), null);
    assert.equal(tryParseJson(""), null);
  });
});

// ── extractMessageText ─────────────────────────────────────────────────────

describe("extractMessageText", () => {
  it("returns strings as-is", () => {
    assert.equal(extractMessageText("hello"), "hello");
  });

  it("extracts text from block arrays", () => {
    assert.equal(
      extractMessageText([
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ]),
      "hello world"
    );
  });

  it("handles string blocks in array", () => {
    assert.equal(extractMessageText(["hello", "world"]), "hello world");
  });

  it("skips non-text blocks", () => {
    assert.equal(
      extractMessageText([
        { type: "text", text: "hello" },
        { type: "image", url: "..." },
      ]),
      "hello"
    );
  });

  it("returns empty string for other types", () => {
    assert.equal(extractMessageText(42), "");
    assert.equal(extractMessageText(null), "");
    assert.equal(extractMessageText(undefined), "");
  });
});

// ── sumTokensFromUsage ─────────────────────────────────────────────────────

describe("sumTokensFromUsage", () => {
  it("sums all token fields from usage object", () => {
    const result = sumTokensFromUsage({
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        cache_creation_input_tokens: 300,
        cache_read_input_tokens: 400,
      },
    });
    assert.equal(result, 1000);
  });

  it("extracts tokens from nested message.usage", () => {
    const result = sumTokensFromUsage({
      message: {
        usage: { input_tokens: 50, output_tokens: 75 },
      },
    });
    assert.equal(result, 125);
  });

  it("returns 0 when no usage", () => {
    assert.equal(sumTokensFromUsage({}), 0);
    assert.equal(sumTokensFromUsage({ type: "user" }), 0);
  });

  it("handles partial usage fields", () => {
    const result = sumTokensFromUsage({
      usage: { input_tokens: 100 },
    });
    assert.equal(result, 100);
  });
});

// ── groupSessionsByProject ─────────────────────────────────────────────────

describe("groupSessionsByProject", () => {
  it("groups sessions by projectKey", () => {
    const sessions = [
      makeSession({ sessionId: "s1", projectKey: "proj-a", projectName: "proj-a" }),
      makeSession({ sessionId: "s2", projectKey: "proj-b", projectName: "proj-b" }),
      makeSession({ sessionId: "s3", projectKey: "proj-a", projectName: "proj-a" }),
    ];
    const groups = groupSessionsByProject(sessions);
    assert.equal(groups.length, 2);
    const projA = groups.find((g) => g.projectKey === "proj-a");
    assert.equal(projA?.sessions.length, 2);
  });

  it("sorts groups by most recent activity", () => {
    const sessions = [
      makeSession({ sessionId: "s1", projectKey: "old", lastTimestamp: "2026-01-01T00:00:00Z" }),
      makeSession({ sessionId: "s2", projectKey: "new", lastTimestamp: "2026-04-01T00:00:00Z" }),
    ];
    const groups = groupSessionsByProject(sessions);
    assert.equal(groups[0].projectKey, "new");
    assert.equal(groups[1].projectKey, "old");
  });

  it("sorts sessions within group by most recent first", () => {
    const sessions = [
      makeSession({ sessionId: "early", projectKey: "p", lastTimestamp: "2026-01-01T00:00:00Z" }),
      makeSession({ sessionId: "late", projectKey: "p", lastTimestamp: "2026-04-01T00:00:00Z" }),
    ];
    const groups = groupSessionsByProject(sessions);
    assert.equal(groups[0].sessions[0].sessionId, "late");
    assert.equal(groups[0].sessions[1].sessionId, "early");
  });

  it("computes totalSize from sessions", () => {
    const sessions = [
      makeSession({ sessionId: "s1", projectKey: "p", fileSize: 100 }),
      makeSession({ sessionId: "s2", projectKey: "p", fileSize: 200 }),
    ];
    const groups = groupSessionsByProject(sessions);
    assert.equal(groups[0].totalSize, 300);
  });

  it("computes date range from sessions", () => {
    const sessions = [
      makeSession({ sessionId: "s1", projectKey: "p", firstTimestamp: "2026-01-01T00:00:00Z", lastTimestamp: "2026-02-01T00:00:00Z" }),
      makeSession({ sessionId: "s2", projectKey: "p", firstTimestamp: "2026-03-01T00:00:00Z", lastTimestamp: "2026-04-01T00:00:00Z" }),
    ];
    const groups = groupSessionsByProject(sessions);
    assert.equal(groups[0].earliest, "2026-01-01T00:00:00Z");
    assert.equal(groups[0].latest, "2026-04-01T00:00:00Z");
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(groupSessionsByProject([]), []);
  });
});

// ── markSessionsSynced / markGroupSessionsSynced ───────────────────────────

describe("markSessionsSynced", () => {
  it("marks matching sessions as synced", () => {
    const sessions = [
      makeSession({ sessionId: "s1", synced: false }),
      makeSession({ sessionId: "s2", synced: false }),
      makeSession({ sessionId: "s3", synced: false }),
    ];
    const result = markSessionsSynced({ sessions, syncedIds: new Set(["s1", "s3"]) });
    assert.equal(result[0].synced, true);
    assert.equal(result[1].synced, false);
    assert.equal(result[2].synced, true);
  });

  it("does not mutate original sessions", () => {
    const sessions = [makeSession({ sessionId: "s1", synced: false })];
    markSessionsSynced({ sessions, syncedIds: new Set(["s1"]) });
    assert.equal(sessions[0].synced, false);
  });

  it("handles empty syncedIds", () => {
    const sessions = [makeSession({ synced: false })];
    const result = markSessionsSynced({ sessions, syncedIds: new Set() });
    assert.equal(result[0].synced, false);
  });
});

describe("markGroupSessionsSynced", () => {
  it("marks sessions in group and preserves other fields", () => {
    const group: ProjectGroup = {
      projectKey: "p", projectName: "test",
      sessions: [makeSession({ sessionId: "s1", synced: false })],
      totalSize: 100, earliest: "2026-01-01", latest: "2026-04-01",
    };
    const result = markGroupSessionsSynced({ group, syncedIds: new Set(["s1"]) });
    assert.equal(result.sessions[0].synced, true);
    assert.equal(result.projectName, "test");
    assert.equal(result.totalSize, 100);
  });
});

// ── clamp ──────────────────────────────────────────────────────────────────

describe("clamp", () => {
  it("returns value when in range", () => {
    assert.equal(clamp(5, 0, 10), 5);
  });

  it("clamps to min", () => {
    assert.equal(clamp(-5, 0, 10), 0);
  });

  it("clamps to max", () => {
    assert.equal(clamp(15, 0, 10), 10);
  });

  it("handles equal min/max", () => {
    assert.equal(clamp(5, 3, 3), 3);
  });
});

// ── computeScrollOffset ────────────────────────────────────────────────────

describe("computeScrollOffset", () => {
  it("keeps scroll when cursor is in viewport", () => {
    assert.equal(computeScrollOffset({ cursor: 5, scroll: 0, maxVisible: 10, total: 20 }), 0);
  });

  it("scrolls up when cursor goes above viewport", () => {
    assert.equal(computeScrollOffset({ cursor: 2, scroll: 5, maxVisible: 10, total: 20 }), 2);
  });

  it("scrolls down when cursor goes below viewport", () => {
    assert.equal(computeScrollOffset({ cursor: 15, scroll: 0, maxVisible: 10, total: 20 }), 6);
  });

  it("does not scroll past end", () => {
    assert.equal(computeScrollOffset({ cursor: 19, scroll: 0, maxVisible: 10, total: 20 }), 10);
  });

  it("handles cursor at position 0", () => {
    assert.equal(computeScrollOffset({ cursor: 0, scroll: 5, maxVisible: 10, total: 20 }), 0);
  });

  it("handles single-page list (no scrolling needed)", () => {
    assert.equal(computeScrollOffset({ cursor: 3, scroll: 0, maxVisible: 10, total: 5 }), 0);
  });
});

// ── parseKeypress ──────────────────────────────────────────────────────────

describe("parseKeypress", () => {
  it("parses vim keys", () => {
    assert.equal(parseKeypress(Buffer.from("k")), "up");
    assert.equal(parseKeypress(Buffer.from("j")), "down");
    assert.equal(parseKeypress(Buffer.from("g")), "top");
    assert.equal(parseKeypress(Buffer.from("G")), "bottom");
  });

  it("parses arrow keys", () => {
    assert.equal(parseKeypress(Buffer.from([0x1b, 0x5b, 0x41])), "up");
    assert.equal(parseKeypress(Buffer.from([0x1b, 0x5b, 0x42])), "down");
  });

  it("parses action keys", () => {
    assert.equal(parseKeypress(Buffer.from("\r")), "enter");
    assert.equal(parseKeypress(Buffer.from(" ")), "space");
    assert.equal(parseKeypress(Buffer.from("a")), "select-all");
    assert.equal(parseKeypress(Buffer.from("s")), "sync");
    assert.equal(parseKeypress(Buffer.from("q")), "back");
  });

  it("parses escape and ctrl-c", () => {
    assert.equal(parseKeypress(Buffer.from([0x1b])), "back");
    assert.equal(parseKeypress(Buffer.from([0x03])), "ctrl-c");
  });

  it("returns empty string for unknown keys", () => {
    assert.equal(parseKeypress(Buffer.from("x")), "");
    assert.equal(parseKeypress(Buffer.from("Z")), "");
  });
});

// ── JSONL parsing pipeline ─────────────────────────────────────────────────

describe("JSONL parsing pipeline", () => {
  it("tryParseJson + extractMessageText pipeline works on JSONL lines", () => {
    const lines = [
      '{"type":"user","content":"Hello world","sessionId":"abc","cwd":"/tmp","gitBranch":"main","timestamp":"2026-01-01T00:00:00Z"}',
      '{"type":"assistant","content":"Hi there","usage":{"input_tokens":10,"output_tokens":20}}',
    ];
    const parsed = lines.map(tryParseJson).filter((obj): obj is Record<string, unknown> => obj !== null);
    assert.equal(parsed.length, 2);
    assert.equal(extractMessageText(parsed[0].content), "Hello world");
    assert.equal(sumTokensFromUsage(parsed[1]), 30);
  });

  it("handles complex content blocks", () => {
    const line = '{"type":"user","message":{"content":[{"type":"text","text":"first"},{"type":"text","text":"second"}]}}';
    const obj = tryParseJson(line)!;
    const msg = obj.message as Record<string, unknown>;
    assert.equal(extractMessageText(msg.content), "first second");
  });
});
