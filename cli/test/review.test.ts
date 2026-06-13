import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  parsePrNumber,
  dedupShas,
  splitShaLines,
} from '../src/commands/review';

// ── parsePrNumber: PR number / URL detection vs branch names ────────────────

describe('parsePrNumber', () => {
  it('parses a bare PR number', () => {
    assert.equal(parsePrNumber('42'), 42);
  });

  it('parses a GitHub PR URL', () => {
    assert.equal(parsePrNumber('https://github.com/org/repo/pull/123'), 123);
  });

  it('parses a PR URL with a trailing path segment', () => {
    assert.equal(parsePrNumber('https://github.com/org/repo/pull/7/files'), 7);
  });

  it('treats a branch name as not-a-PR (null)', () => {
    assert.equal(parsePrNumber('feat/webhook-retry'), null);
  });

  it('treats a branch that merely contains digits as not-a-PR', () => {
    assert.equal(parsePrNumber('release-2026'), null);
  });
});

// ── dedupShas: order-preserving dedup + blank stripping (no mutation) ───────

describe('dedupShas', () => {
  it('removes duplicates while preserving first-seen order', () => {
    assert.deepEqual(dedupShas(['aaa', 'bbb', 'aaa', 'ccc', 'bbb']), [
      'aaa',
      'bbb',
      'ccc',
    ]);
  });

  it('strips blank / whitespace-only entries and trims', () => {
    assert.deepEqual(dedupShas(['  aaa  ', '', '   ', 'bbb']), ['aaa', 'bbb']);
  });

  it('returns [] for an all-empty input (the empty case)', () => {
    assert.deepEqual(dedupShas(['', '  ']), []);
  });

  it('does not mutate the input array', () => {
    const input = ['aaa', 'aaa'];
    dedupShas(input);
    assert.deepEqual(input, ['aaa', 'aaa']);
  });
});

// ── splitShaLines: turn gh/git stdout into clean SHA lines ──────────────────

describe('splitShaLines', () => {
  it('splits multi-line stdout into trimmed non-empty lines', () => {
    const stdout = 'abc123\ndef456\n\n  ghi789  \n';
    assert.deepEqual(splitShaLines(stdout), ['abc123', 'def456', 'ghi789']);
  });

  it('returns [] for empty stdout (no commits / command failed)', () => {
    assert.deepEqual(splitShaLines(''), []);
  });
});
