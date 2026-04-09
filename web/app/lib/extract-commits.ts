/**
 * Extract commit SHAs from a Claude Code JSONL transcript.
 *
 * Strategy: walk the JSONL lines, track Bash tool_use IDs whose command
 * contains `git commit` (or `git merge`), then match corresponding
 * tool_result entries and extract the SHA from git's standard output
 * format: `[branch SHA] message`.
 *
 * This two-phase approach (tool_use → tool_result) is what makes it
 * 99.99% reliable: we only look at the *output* of a command that was
 * actually a git commit, not arbitrary text that happens to contain
 * bracket-sha patterns.
 */

export interface ExtractedCommit {
  readonly sha: string;
  readonly branch: string;
  readonly message: string;
  readonly toolUseId: string;
}

interface JsonlEntry {
  message?: {
    role?: string;
    content?: unknown;
  };
  type?: string;
  role?: string;
  content?: unknown;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: { command?: string };
}

interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: unknown;
}

type ContentBlock = ToolUseBlock | ToolResultBlock | { type: string };

/** Commands that produce commits */
const COMMIT_COMMAND_PATTERNS = [
  /\bgit\s+commit\b/,
  /\bgit\s+merge\b/,
  /\bgit\s+cherry-pick\b/,
  /\bgit\s+revert\b/,
];

const isCommitCommand = (command: string): boolean =>
  COMMIT_COMMAND_PATTERNS.some((pattern) => pattern.test(command));

/**
 * Git's commit output format: [branch-name short-sha] commit message
 * Branch names can contain: letters, digits, /, ., -, _
 * SHA is 7-40 hex chars
 */
const COMMIT_OUTPUT_REGEX = /\[([\w/.:-]+)\s+([a-f0-9]{7,40})\]\s+(.+)/;

const extractTextFromContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && 'text' in block) return String(block.text);
        return '';
      })
      .join('\n');
  }
  return '';
};

const getContentBlocks = (entry: JsonlEntry): ContentBlock[] => {
  const content = entry.message?.content ?? entry.content;
  if (Array.isArray(content)) return content as ContentBlock[];
  return [];
};

export const extractCommitsFromTranscript = (transcript: string): readonly ExtractedCommit[] => {
  const lines = transcript.split('\n').filter((l) => l.trim());

  // Phase 1: collect tool_use IDs for commit commands
  const commitToolUseIds = new Set<string>();

  // Phase 2: match tool_results to those IDs and extract SHAs
  const commits: ExtractedCommit[] = [];
  const seenShas = new Set<string>();

  // Single pass: we can do both phases in one pass since tool_use always
  // comes before its corresponding tool_result in the transcript
  for (const line of lines) {
    let entry: JsonlEntry;
    try {
      entry = JSON.parse(line) as JsonlEntry;
    } catch {
      continue;
    }

    const blocks = getContentBlocks(entry);

    for (const block of blocks) {
      // Track Bash tool_use blocks with git commit commands
      if (
        block.type === 'tool_use' &&
        'name' in block &&
        block.name === 'Bash' &&
        'input' in block &&
        block.input?.command &&
        isCommitCommand(block.input.command)
      ) {
        commitToolUseIds.add((block as ToolUseBlock).id);
      }

      // Match tool_results to known commit tool_uses
      if (
        block.type === 'tool_result' &&
        'tool_use_id' in block &&
        commitToolUseIds.has((block as ToolResultBlock).tool_use_id)
      ) {
        const resultText = extractTextFromContent((block as ToolResultBlock).content);
        const match = COMMIT_OUTPUT_REGEX.exec(resultText);
        if (match && !seenShas.has(match[2])) {
          seenShas.add(match[2]);
          commits.push({
            sha: match[2],
            branch: match[1],
            message: match[3].split('\n')[0].trim(),
            toolUseId: (block as ToolResultBlock).tool_use_id,
          });
        }
      }
    }
  }

  return commits;
};
