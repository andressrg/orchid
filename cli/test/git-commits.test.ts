import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  parseGitLog,
  parseGitLogLine,
  branchFromRefDecoration,
  GIT_LOG_PRETTY_FORMAT,
} from '../src/git-commits';

// The backfill resolves a session's commits with:
//   git log --pretty=format:%H%x00%cI%x00%s%x00%D ...
// i.e. four NUL-separated fields per line. These tests feed the parser the exact
// stdout git would produce (NUL = '\x00'), no real repo required.

const NUL = '\x00';
const line = (
  sha: string,
  date: string,
  subject: string,
  decoration: string,
): string => [sha, date, subject, decoration].join(NUL);

// ── parseGitLogLine: one %H%x00%cI%x00%s%x00%D line → commit ─────────────────

describe('parseGitLogLine', () => {
  it('parses sha, ISO date, subject, and branch from the ref decoration', () => {
    const result = parseGitLogLine(
      line(
        'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        '2026-06-13T10:30:00+00:00',
        'feat: add commit ingest endpoint',
        'HEAD -> feat/commit-linking, origin/feat/commit-linking',
      ),
    );
    assert.deepEqual(result, {
      sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      committed_at: '2026-06-13T10:30:00+00:00',
      message: 'feat: add commit ingest endpoint',
      branch: 'feat/commit-linking',
    });
  });

  it('keeps a subject that itself contains spaces and commas intact (NUL split)', () => {
    const result = parseGitLogLine(
      line(
        'abc123abc123abc123abc123abc123abc123abcd',
        '2026-01-01T00:00:00Z',
        'fix: handle a, b, and c in the parser',
        '',
      ),
    );
    assert.equal(result?.message, 'fix: handle a, b, and c in the parser');
    assert.equal(result?.branch, null);
  });

  it('returns null branch when the ref decoration is empty', () => {
    const result = parseGitLogLine(
      line(
        'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        '2026-02-02T12:00:00Z',
        'chore',
        '',
      ),
    );
    assert.equal(result?.branch, null);
  });

  it('returns null for a blank line', () => {
    assert.equal(parseGitLogLine(''), null);
    assert.equal(parseGitLogLine('   '), null);
  });

  it('treats a missing committed date / subject as null fields', () => {
    const result = parseGitLogLine(
      line('feedface' + 'f'.repeat(32), '', '', ''),
    );
    assert.equal(result?.committed_at, null);
    assert.equal(result?.message, null);
  });
});

// ── branchFromRefDecoration: %D → a single branch-ish name ───────────────────

describe('branchFromRefDecoration', () => {
  it('strips the "HEAD -> " arrow and prefers the local branch', () => {
    assert.equal(branchFromRefDecoration('HEAD -> main, origin/main'), 'main');
  });

  it('falls back to a remote ref when there is no local branch', () => {
    assert.equal(branchFromRefDecoration('origin/feat/x'), 'origin/feat/x');
  });

  it('ignores tag refs and a bare HEAD', () => {
    assert.equal(
      branchFromRefDecoration('HEAD, tag: v1.0.0, origin/release'),
      'origin/release',
    );
  });

  it('returns null when nothing usable remains', () => {
    assert.equal(branchFromRefDecoration(''), null);
    assert.equal(branchFromRefDecoration('HEAD'), null);
    assert.equal(branchFromRefDecoration('tag: v2'), null);
  });
});

// ── parseGitLog: full stdout → commit list ───────────────────────────────────

describe('parseGitLog', () => {
  it('parses multiple lines and drops blank/garbage lines', () => {
    const stdout = [
      line(
        '1111111111111111111111111111111111111111',
        '2026-06-10T09:00:00Z',
        'first',
        'HEAD -> main',
      ),
      '',
      line(
        '2222222222222222222222222222222222222222',
        '2026-06-11T09:00:00Z',
        'second',
        'origin/main',
      ),
      '   ',
    ].join('\n');

    const result = parseGitLog(stdout);
    assert.equal(result.length, 2);
    assert.equal(result[0].sha, '1111111111111111111111111111111111111111');
    assert.equal(result[0].message, 'first');
    assert.equal(result[0].branch, 'main');
    assert.equal(result[1].sha, '2222222222222222222222222222222222222222');
    assert.equal(result[1].branch, 'origin/main');
  });

  it('returns [] for empty stdout (no commits / non-repo)', () => {
    assert.deepEqual(parseGitLog(''), []);
  });
});

// ── format contract ──────────────────────────────────────────────────────────

describe('GIT_LOG_PRETTY_FORMAT', () => {
  it('is the NUL-delimited %H/%cI/%s/%D format the parser expects', () => {
    assert.equal(GIT_LOG_PRETTY_FORMAT, 'format:%H%x00%cI%x00%s%x00%D');
  });
});
