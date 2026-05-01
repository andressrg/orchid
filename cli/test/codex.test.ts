import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  codexSessionIdFromTranscriptPath,
  findCodexTranscriptFile,
} from '../src/commands/codex';

type JsonPrimitive = string | number | boolean | null;
type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
type JsonRecord = { readonly [key: string]: JsonValue };

const jsonl = (...entries: readonly JsonRecord[]): string =>
  entries.map((entry) => JSON.stringify(entry)).join('\n');

const withTempDir = (fn: (dir: string) => void): void => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchid-codex-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('codexSessionIdFromTranscriptPath prefers session_meta id', () => {
  withTempDir((dir) => {
    const transcriptPath = path.join(
      dir,
      'rollout-2026-05-01T00-00-00-fallback-id.jsonl',
    );
    fs.writeFileSync(
      transcriptPath,
      jsonl({
        type: 'session_meta',
        payload: { id: 'codex-session-id', cwd: dir },
      }),
    );

    assert.equal(
      codexSessionIdFromTranscriptPath(transcriptPath),
      'codex-session-id',
    );
  });
});

test('findCodexTranscriptFile filters rollout files by cwd and start time', () => {
  withTempDir((dir) => {
    const cwd = path.join(dir, 'repo');
    const otherCwd = path.join(dir, 'other');
    const sessionsDir = path.join(dir, 'sessions', '2026', '05', '01');
    fs.mkdirSync(cwd);
    fs.mkdirSync(otherCwd);
    fs.mkdirSync(sessionsDir, { recursive: true });

    const olderPath = path.join(
      sessionsDir,
      'rollout-2026-05-01T00-00-00-old.jsonl',
    );
    const otherPath = path.join(
      sessionsDir,
      'rollout-2026-05-01T00-00-01-other.jsonl',
    );
    const matchingPath = path.join(
      sessionsDir,
      'rollout-2026-05-01T00-00-02-match.jsonl',
    );

    fs.writeFileSync(
      olderPath,
      jsonl({ type: 'session_meta', payload: { id: 'old', cwd } }),
    );
    const startTimeMs = Date.now();
    fs.writeFileSync(
      otherPath,
      jsonl({ type: 'session_meta', payload: { id: 'other', cwd: otherCwd } }),
    );
    fs.writeFileSync(
      matchingPath,
      jsonl({ type: 'session_meta', payload: { id: 'match', cwd } }),
    );
    fs.utimesSync(
      otherPath,
      new Date(startTimeMs + 1000),
      new Date(startTimeMs + 1000),
    );
    fs.utimesSync(
      matchingPath,
      new Date(startTimeMs + 2000),
      new Date(startTimeMs + 2000),
    );

    assert.equal(
      findCodexTranscriptFile({
        startTimeMs,
        cwd,
        sessionsDir: path.join(dir, 'sessions'),
        useSqlite: false,
      }),
      matchingPath,
    );
  });
});
