import { describe, it, expect } from 'vitest';
import { extractCommitsFromTranscript } from '@/app/lib/extract-commits';

// Helper: build a JSONL transcript from structured entries
const jsonl = (...entries: object[]): string => entries.map((e) => JSON.stringify(e)).join('\n');

// Helper: build a tool_use line for a Bash git commit
const bashToolUse = (id: string, command: string) => ({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }],
  },
});

// Helper: build a tool_result line
const toolResult = (toolUseId: string, content: string) => ({
  type: 'user',
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
  },
});

// Helper: build a plain user message
const userMessage = (text: string) => ({
  type: 'user',
  message: { role: 'user', content: text },
});

// Helper: build a plain assistant message
const assistantMessage = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: text },
});

describe('extractCommitsFromTranscript', () => {
  it('extracts a single commit from a simple transcript', () => {
    const transcript = jsonl(
      bashToolUse('tool_1', 'git add . && git commit -m "Add feature"'),
      toolResult('tool_1', '[main abc1234] Add feature\n 1 file changed, 10 insertions(+)'),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual({
      sha: 'abc1234',
      branch: 'main',
      message: 'Add feature',
      toolUseId: 'tool_1',
      committedAt: null,
    });
  });

  it('extracts multiple commits from a session', () => {
    const transcript = jsonl(
      bashToolUse('t1', 'git commit -m "First commit"'),
      toolResult('t1', '[feat/auth f289a29] First commit\n 2 files changed'),
      userMessage('Now fix the tests'),
      bashToolUse('t2', 'git add . && git commit -m "Fix tests"'),
      toolResult('t2', '[feat/auth 955dce7] Fix tests\n 1 file changed'),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(2);
    expect(commits[0].sha).toBe('f289a29');
    expect(commits[1].sha).toBe('955dce7');
  });

  it('ignores non-Bash tool_use blocks', () => {
    const transcript = jsonl(
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'read_1', name: 'Read', input: { file_path: '/foo' } }],
        },
      },
      toolResult('read_1', '[main abc1234] This looks like a commit but is from Read tool'),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(0);
  });

  it('ignores Bash commands that are NOT git commit', () => {
    const transcript = jsonl(
      bashToolUse('t1', 'git log --oneline'),
      toolResult('t1', '[main abc1234] Add feature\n[main def5678] Fix bug'),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(0);
  });

  it('ignores pasted commit-like text in user messages', () => {
    const transcript = jsonl(
      userMessage('Hey, I saw this commit: [main abc1234] Add feature'),
      assistantMessage('Yes, that commit adds a feature.'),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(0);
  });

  it('ignores pasted commit output in assistant messages', () => {
    const transcript = jsonl(assistantMessage('The last commit was [feat/x 1234abc] Some change'));

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(0);
  });

  it('handles git merge commits', () => {
    const transcript = jsonl(
      bashToolUse('t1', 'git merge feat/auth'),
      toolResult(
        't1',
        "Merge made by the 'ort' strategy.\n[main 8a3b2c1] Merge branch 'feat/auth'\n 5 files changed",
      ),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe('8a3b2c1');
    expect(commits[0].message).toBe("Merge branch 'feat/auth'");
  });

  it('handles git cherry-pick commits', () => {
    const transcript = jsonl(
      bashToolUse('t1', 'git cherry-pick abc123'),
      toolResult('t1', '[main def4567] Cherry-picked commit\n 1 file changed'),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe('def4567');
  });

  it('handles git revert commits', () => {
    const transcript = jsonl(
      bashToolUse('t1', 'git revert HEAD'),
      toolResult('t1', '[main aaa1111] Revert "Bad change"\n 2 files changed'),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe('aaa1111');
  });

  it('handles failed git commit (no [branch sha] in output)', () => {
    const transcript = jsonl(
      bashToolUse('t1', 'git commit -m "Try to commit"'),
      toolResult('t1', 'On branch main\nnothing to commit, working tree clean'),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(0);
  });

  it('handles pre-commit hook failure (no commit created)', () => {
    const transcript = jsonl(
      bashToolUse('t1', 'git commit -m "Fails lint"'),
      toolResult(
        't1',
        'Running pre-commit hooks...\neslint: 3 errors\nhusky - pre-commit hook exited with code 1',
      ),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(0);
  });

  it('deduplicates commits with the same SHA', () => {
    // This can happen if the same commit appears twice (e.g., amend then force push log)
    const transcript = jsonl(
      bashToolUse('t1', 'git commit -m "First"'),
      toolResult('t1', '[main abc1234] First\n 1 file changed'),
      bashToolUse('t2', 'git commit --amend -m "First (amended)"'),
      toolResult('t2', '[main abc1234] First (amended)\n 1 file changed'),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe('abc1234');
  });

  it('handles branch names with slashes, dots, and hyphens', () => {
    const transcript = jsonl(
      bashToolUse('t1', 'git commit -m "Fix"'),
      toolResult('t1', '[feat/my-feature.v2 aabbcc1] Fix\n 1 file changed'),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(1);
    expect(commits[0].branch).toBe('feat/my-feature.v2');
  });

  it('handles full 40-char SHAs in output', () => {
    const transcript = jsonl(
      bashToolUse('t1', 'git commit -m "Full sha"'),
      toolResult('t1', '[main a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0] Full sha\n 1 file changed'),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0');
  });

  it('handles tool_result with array content blocks', () => {
    const transcript = jsonl(bashToolUse('t1', 'git commit -m "Array content"'), {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: [{ type: 'text', text: '[main bbb2222] Array content\n 1 file changed' }],
          },
        ],
      },
    });

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe('bbb2222');
  });

  it('handles chained commands: git add && git commit', () => {
    const transcript = jsonl(
      bashToolUse('t1', 'cd /project && git add -A && git commit -m "Chained"'),
      toolResult('t1', '[feat/x ccc3333] Chained\n 3 files changed, 50 insertions(+)'),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe('ccc3333');
  });

  it('handles heredoc commit messages (Claude Code pattern)', () => {
    const transcript = jsonl(
      bashToolUse(
        't1',
        'git commit -m "$(cat <<\'EOF\'\nAdd feature\n\nCo-Authored-By: Claude\nEOF\n)"',
      ),
      toolResult('t1', '[main ddd4444] Add feature\n 2 files changed'),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe('ddd4444');
    expect(commits[0].message).toBe('Add feature');
  });

  it('handles commit output with extra text before the [branch sha] line', () => {
    const transcript = jsonl(
      bashToolUse('t1', 'git add . && git commit -m "After warnings"'),
      toolResult(
        't1',
        'warning: LF will be replaced by CRLF\n[main eee5555] After warnings\n 1 file changed',
      ),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe('eee5555');
  });

  it('returns empty array for empty transcript', () => {
    expect(extractCommitsFromTranscript('')).toHaveLength(0);
  });

  it('returns empty array for transcript with no tool use', () => {
    const transcript = jsonl(userMessage('Hello'), assistantMessage('Hi there'));

    expect(extractCommitsFromTranscript(transcript)).toHaveLength(0);
  });

  it('handles malformed JSONL lines gracefully', () => {
    const transcript = [
      'not json at all',
      '{"broken": true',
      JSON.stringify(bashToolUse('t1', 'git commit -m "Valid"')),
      JSON.stringify(toolResult('t1', '[main fff6666] Valid\n 1 file changed')),
    ].join('\n');

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe('fff6666');
  });

  it('handles real-world transcript pattern with Shell cwd reset', () => {
    const transcript = jsonl(
      bashToolUse(
        'toolu_01RsKtog8W2hnNp4YoSVEjuC',
        'cd /project && git add file.ts && git commit -m "$(cat <<\'EOF\'\nAdd hooks command\n\nCo-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>\nEOF\n)"',
      ),
      toolResult(
        'toolu_01RsKtog8W2hnNp4YoSVEjuC',
        '[feat/cli-hooks cf14a7a] Add hooks command\n 3 files changed, 797 insertions(+)\n create mode 100644 cli/src/commands/hooks.ts\nShell cwd was reset to /Users/user/project\n[result-id: r23]\n[rerun: b18]',
      ),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual({
      sha: 'cf14a7a',
      branch: 'feat/cli-hooks',
      message: 'Add hooks command',
      toolUseId: 'toolu_01RsKtog8W2hnNp4YoSVEjuC',
      committedAt: null,
    });
  });

  it('does not match [result-id: r23] or [rerun: b18] as commits', () => {
    // These are Claude Code metadata tags, not git output
    const transcript = jsonl(
      bashToolUse('t1', 'git status'),
      toolResult('t1', 'On branch main\n[result-id: r23]\n[rerun: b18]'),
    );

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(0);
  });

  it('handles multiple content blocks in a single tool_result', () => {
    const transcript = jsonl(bashToolUse('t1', 'git commit -m "Multi block"'), {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: [
              { type: 'text', text: '[main aaf7777] Multi block' },
              { type: 'text', text: ' 1 file changed, 5 insertions(+)' },
            ],
          },
        ],
      },
    });

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe('aaf7777');
  });

  it('captures the JSONL entry timestamp as committedAt', () => {
    const transcript = [
      JSON.stringify({
        timestamp: '2026-04-06T01:27:57.242Z',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'Bash',
              input: { command: 'git commit -m "Timestamped"' },
            },
          ],
        },
      }),
      JSON.stringify({
        timestamp: '2026-04-06T01:28:01.000Z',
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't1',
              content: '[main abc1234] Timestamped\n 1 file changed',
            },
          ],
        },
      }),
    ].join('\n');

    const commits = extractCommitsFromTranscript(transcript);
    expect(commits).toHaveLength(1);
    expect(commits[0].committedAt).toBe('2026-04-06T01:28:01.000Z');
  });
});
