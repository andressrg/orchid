import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  formatBytes, formatTokens, formatDate, padRight, padLeft, truncate,
  humanizeProjectKey, tryParseJson, extractTextContent, extractTokensFromUsage,
  groupByProject, markSynced, markGroupSynced, clamp, computeScroll, parseKey,
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

// ── formatBytes ────────────────────────────────────────────────────────────

describe("formatBytes", () => {
  it("formats bytes", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(1023), "1023 B");
  });

  it("formats kilobytes", () => {
    assert.equal(formatBytes(1024), "1.0 KB");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(524288), "512.0 KB");
  });

  it("formats megabytes", () => {
    assert.equal(formatBytes(1048576), "1.0 MB");
    assert.equal(formatBytes(3932160), "3.8 MB");
  });
});

// ── formatTokens ───────────────────────────────────────────────────────────

describe("formatTokens", () => {
  it("returns dash for zero", () => {
    assert.equal(formatTokens(0), "—");
  });

  it("formats small numbers as-is", () => {
    assert.equal(formatTokens(42), "42");
    assert.equal(formatTokens(999), "999");
  });

  it("formats thousands with k suffix", () => {
    assert.equal(formatTokens(1000), "1k");
    assert.equal(formatTokens(50000), "50k");
    assert.equal(formatTokens(999999), "1000k");
  });

  it("formats millions with M suffix", () => {
    assert.equal(formatTokens(1_000_000), "1.0M");
    assert.equal(formatTokens(16_900_000), "16.9M");
  });
});

// ── formatDate ─────────────────────────────────────────────────────────────

describe("formatDate", () => {
  it("formats ISO dates to Mon D", () => {
    // Use midday UTC to avoid timezone day-shift issues
    assert.equal(formatDate("2026-01-15T12:00:00.000Z"), "Jan 15");
    assert.equal(formatDate("2026-12-25T12:00:00.000Z"), "Dec 25");
  });

  it("handles single digit days", () => {
    assert.equal(formatDate("2026-03-05T12:00:00.000Z"), "Mar 5");
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

// ── humanizeProjectKey ─────────────────────────────────────────────────────

describe("humanizeProjectKey", () => {
  it("extracts org/project from Developer path", () => {
    assert.equal(
      humanizeProjectKey("-Users-juliankmazo-Developer-personal-orchid"),
      "personal/orchid"
    );
  });

  it("preserves hyphens in project names", () => {
    assert.equal(
      humanizeProjectKey("-Users-juliankmazo-Developer-personal-mining-plate-crawler"),
      "personal/mining-plate-crawler"
    );
  });

  it("handles nested org paths", () => {
    assert.equal(
      humanizeProjectKey("-Users-juliankmazo-Developer-snappr-snappr-server"),
      "snappr/snappr-server"
    );
  });

  it("handles single segment after Developer", () => {
    assert.equal(
      humanizeProjectKey("-Users-juliankmazo-Developer-snappr"),
      "snappr"
    );
  });

  it("falls back to last two segments when no Developer", () => {
    assert.equal(
      humanizeProjectKey("-some-random-path"),
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

// ── extractTextContent ─────────────────────────────────────────────────────

describe("extractTextContent", () => {
  it("returns strings as-is", () => {
    assert.equal(extractTextContent("hello"), "hello");
  });

  it("extracts text from block arrays", () => {
    assert.equal(
      extractTextContent([
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ]),
      "hello world"
    );
  });

  it("handles string blocks in array", () => {
    assert.equal(extractTextContent(["hello", "world"]), "hello world");
  });

  it("skips non-text blocks", () => {
    assert.equal(
      extractTextContent([
        { type: "text", text: "hello" },
        { type: "image", url: "..." },
      ]),
      "hello"
    );
  });

  it("returns empty string for other types", () => {
    assert.equal(extractTextContent(42), "");
    assert.equal(extractTextContent(null), "");
    assert.equal(extractTextContent(undefined), "");
  });
});

// ── extractTokensFromUsage ─────────────────────────────────────────────────

describe("extractTokensFromUsage", () => {
  it("extracts tokens from usage object", () => {
    const result = extractTokensFromUsage({
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
    const result = extractTokensFromUsage({
      message: {
        usage: { input_tokens: 50, output_tokens: 75 },
      },
    });
    assert.equal(result, 125);
  });

  it("returns 0 when no usage", () => {
    assert.equal(extractTokensFromUsage({}), 0);
    assert.equal(extractTokensFromUsage({ type: "user" }), 0);
  });

  it("handles partial usage fields", () => {
    const result = extractTokensFromUsage({
      usage: { input_tokens: 100 },
    });
    assert.equal(result, 100);
  });
});

// ── groupByProject ─────────────────────────────────────────────────────────

describe("groupByProject", () => {
  it("groups sessions by projectKey", () => {
    const sessions = [
      makeSession({ sessionId: "s1", projectKey: "proj-a", projectName: "proj-a" }),
      makeSession({ sessionId: "s2", projectKey: "proj-b", projectName: "proj-b" }),
      makeSession({ sessionId: "s3", projectKey: "proj-a", projectName: "proj-a" }),
    ];
    const groups = groupByProject(sessions);
    assert.equal(groups.length, 2);
    const projA = groups.find((g) => g.projectKey === "proj-a");
    assert.equal(projA?.sessions.length, 2);
  });

  it("sorts groups by most recent activity", () => {
    const sessions = [
      makeSession({ sessionId: "s1", projectKey: "old", lastTimestamp: "2026-01-01T00:00:00Z" }),
      makeSession({ sessionId: "s2", projectKey: "new", lastTimestamp: "2026-04-01T00:00:00Z" }),
    ];
    const groups = groupByProject(sessions);
    assert.equal(groups[0].projectKey, "new");
    assert.equal(groups[1].projectKey, "old");
  });

  it("sorts sessions within group by most recent first", () => {
    const sessions = [
      makeSession({ sessionId: "early", projectKey: "p", lastTimestamp: "2026-01-01T00:00:00Z" }),
      makeSession({ sessionId: "late", projectKey: "p", lastTimestamp: "2026-04-01T00:00:00Z" }),
    ];
    const groups = groupByProject(sessions);
    assert.equal(groups[0].sessions[0].sessionId, "late");
    assert.equal(groups[0].sessions[1].sessionId, "early");
  });

  it("computes totalSize from sessions", () => {
    const sessions = [
      makeSession({ sessionId: "s1", projectKey: "p", fileSize: 100 }),
      makeSession({ sessionId: "s2", projectKey: "p", fileSize: 200 }),
    ];
    const groups = groupByProject(sessions);
    assert.equal(groups[0].totalSize, 300);
  });

  it("computes date range from sessions", () => {
    const sessions = [
      makeSession({ sessionId: "s1", projectKey: "p", firstTimestamp: "2026-01-01T00:00:00Z", lastTimestamp: "2026-02-01T00:00:00Z" }),
      makeSession({ sessionId: "s2", projectKey: "p", firstTimestamp: "2026-03-01T00:00:00Z", lastTimestamp: "2026-04-01T00:00:00Z" }),
    ];
    const groups = groupByProject(sessions);
    assert.equal(groups[0].earliest, "2026-01-01T00:00:00Z");
    assert.equal(groups[0].latest, "2026-04-01T00:00:00Z");
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(groupByProject([]), []);
  });
});

// ── markSynced / markGroupSynced ───────────────────────────────────────────

describe("markSynced", () => {
  it("marks matching sessions as synced", () => {
    const sessions = [
      makeSession({ sessionId: "s1", synced: false }),
      makeSession({ sessionId: "s2", synced: false }),
      makeSession({ sessionId: "s3", synced: false }),
    ];
    const result = markSynced(sessions, new Set(["s1", "s3"]));
    assert.equal(result[0].synced, true);
    assert.equal(result[1].synced, false);
    assert.equal(result[2].synced, true);
  });

  it("does not mutate original sessions", () => {
    const sessions = [makeSession({ sessionId: "s1", synced: false })];
    markSynced(sessions, new Set(["s1"]));
    assert.equal(sessions[0].synced, false);
  });

  it("handles empty syncedIds", () => {
    const sessions = [makeSession({ synced: false })];
    const result = markSynced(sessions, new Set());
    assert.equal(result[0].synced, false);
  });
});

describe("markGroupSynced", () => {
  it("marks sessions in group and preserves other fields", () => {
    const group: ProjectGroup = {
      projectKey: "p", projectName: "test",
      sessions: [makeSession({ sessionId: "s1", synced: false })],
      totalSize: 100, earliest: "2026-01-01", latest: "2026-04-01",
    };
    const result = markGroupSynced(group, new Set(["s1"]));
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

// ── computeScroll ──────────────────────────────────────────────────────────

describe("computeScroll", () => {
  it("keeps scroll when cursor is in viewport", () => {
    assert.equal(computeScroll(5, 0, 10, 20), 0);
  });

  it("scrolls up when cursor goes above viewport", () => {
    assert.equal(computeScroll(2, 5, 10, 20), 2);
  });

  it("scrolls down when cursor goes below viewport", () => {
    assert.equal(computeScroll(15, 0, 10, 20), 6);
  });

  it("does not scroll past end", () => {
    assert.equal(computeScroll(19, 0, 10, 20), 10);
  });

  it("handles cursor at position 0", () => {
    assert.equal(computeScroll(0, 5, 10, 20), 0);
  });

  it("handles single-page list (no scrolling needed)", () => {
    assert.equal(computeScroll(3, 0, 10, 5), 0);
  });
});

// ── parseKey ───────────────────────────────────────────────────────────────

describe("parseKey", () => {
  it("parses vim keys", () => {
    assert.equal(parseKey(Buffer.from("k")), "up");
    assert.equal(parseKey(Buffer.from("j")), "down");
    assert.equal(parseKey(Buffer.from("g")), "top");
    assert.equal(parseKey(Buffer.from("G")), "bottom");
  });

  it("parses arrow keys", () => {
    assert.equal(parseKey(Buffer.from([0x1b, 0x5b, 0x41])), "up");
    assert.equal(parseKey(Buffer.from([0x1b, 0x5b, 0x42])), "down");
  });

  it("parses action keys", () => {
    assert.equal(parseKey(Buffer.from("\r")), "enter");
    assert.equal(parseKey(Buffer.from(" ")), "space");
    assert.equal(parseKey(Buffer.from("a")), "select-all");
    assert.equal(parseKey(Buffer.from("s")), "sync");
    assert.equal(parseKey(Buffer.from("q")), "back");
  });

  it("parses escape and ctrl-c", () => {
    assert.equal(parseKey(Buffer.from([0x1b])), "back");
    assert.equal(parseKey(Buffer.from([0x03])), "ctrl-c");
  });

  it("returns empty string for unknown keys", () => {
    assert.equal(parseKey(Buffer.from("x")), "");
    assert.equal(parseKey(Buffer.from("Z")), "");
  });
});

// ── extractMetadataFromJsonl (integration — writes temp file) ──────────────

describe("extractMetadataFromJsonl", () => {
  // Import the function that reads files — it's in sync.ts, not sync-utils
  // We test it indirectly by creating temp JSONL files

  const tmpDir = path.join(os.tmpdir(), `orchid-test-${Date.now()}`);

  const writeJsonl = (name: string, lines: Record<string, unknown>[]): string => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    return filePath;
  };

  // We can't easily import extractMetadataFromJsonl from sync.ts without side effects,
  // but we CAN test the building blocks it uses: tryParseJson, extractTextContent,
  // extractTokensFromUsage. The integration of these is tested via the CLI e2e tests.

  it("tryParseJson + extractTextContent pipeline works on JSONL lines", () => {
    const lines = [
      '{"type":"user","content":"Hello world","sessionId":"abc","cwd":"/tmp","gitBranch":"main","timestamp":"2026-01-01T00:00:00Z"}',
      '{"type":"assistant","content":"Hi there","usage":{"input_tokens":10,"output_tokens":20}}',
    ];
    const parsed = lines.map(tryParseJson).filter((obj): obj is Record<string, unknown> => obj !== null);
    assert.equal(parsed.length, 2);
    assert.equal(extractTextContent(parsed[0].content), "Hello world");
    assert.equal(extractTokensFromUsage(parsed[1]), 30);
  });

  it("handles complex content blocks", () => {
    const line = '{"type":"user","message":{"content":[{"type":"text","text":"first"},{"type":"text","text":"second"}]}}';
    const obj = tryParseJson(line)!;
    const msg = obj.message as Record<string, unknown>;
    assert.equal(extractTextContent(msg.content), "first second");
  });

  // Clean up temp dir
  it("cleanup", () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
