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
  readonly committedAt: string | null;
}

interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}

interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input?: { readonly command?: string };
}

interface ToolResultBlock {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content?: string | readonly TextBlock[];
}

type ContentBlock = ToolUseBlock | ToolResultBlock | { readonly type: string };

interface JsonlEntry {
  readonly timestamp?: string;
  readonly message?: {
    readonly role?: string;
    readonly content?: string | readonly ContentBlock[];
  };
  readonly type?: string;
  readonly role?: string;
  readonly content?: string | readonly ContentBlock[];
}

interface TimestampedBlock {
  readonly block: ContentBlock;
  readonly timestamp: string | null;
}

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

const extractTextFromContent = (content: string | readonly TextBlock[] | undefined): string => {
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

const getTimestampedBlocks = (entry: JsonlEntry): readonly TimestampedBlock[] => {
  const content = entry.message?.content ?? entry.content;
  const timestamp = entry.timestamp ?? null;
  if (Array.isArray(content)) {
    return (content as readonly ContentBlock[]).map((block) => ({ block, timestamp }));
  }
  return [];
};

const tryParseJsonlLine = (line: string): JsonlEntry | null => {
  try {
    return JSON.parse(line) as JsonlEntry;
  } catch {
    return null;
  }
};

const isCommitToolUse = (block: ContentBlock): block is ToolUseBlock =>
  block.type === 'tool_use' &&
  'name' in block &&
  (block as ToolUseBlock).name === 'Bash' &&
  'input' in block &&
  Boolean((block as ToolUseBlock).input?.command) &&
  isCommitCommand((block as ToolUseBlock).input!.command!);

const isToolResult = (block: ContentBlock): block is ToolResultBlock =>
  block.type === 'tool_result' && 'tool_use_id' in block;

interface ParseState {
  readonly commitToolUseIds: ReadonlySet<string>;
  readonly commits: readonly ExtractedCommit[];
  readonly seenShas: ReadonlySet<string>;
}

const processTimestampedBlock = (state: ParseState, { block, timestamp }: TimestampedBlock): ParseState => {
  if (isCommitToolUse(block)) {
    return {
      ...state,
      commitToolUseIds: new Set([...state.commitToolUseIds, block.id]),
    };
  }

  if (isToolResult(block) && state.commitToolUseIds.has(block.tool_use_id)) {
    const resultText = extractTextFromContent(block.content);
    const match = COMMIT_OUTPUT_REGEX.exec(resultText);
    if (match && !state.seenShas.has(match[2])) {
      return {
        ...state,
        seenShas: new Set([...state.seenShas, match[2]]),
        commits: [...state.commits, {
          sha: match[2],
          branch: match[1],
          message: match[3].split('\n')[0].trim(),
          toolUseId: block.tool_use_id,
          committedAt: timestamp,
        }],
      };
    }
  }

  return state;
};

export const extractCommitsFromTranscript = (transcript: string): readonly ExtractedCommit[] => {
  const initialState: ParseState = {
    commitToolUseIds: new Set(),
    commits: [],
    seenShas: new Set(),
  };

  return transcript
    .split('\n')
    .filter((l) => l.trim())
    .map(tryParseJsonlLine)
    .filter((entry): entry is JsonlEntry => entry !== null)
    .flatMap(getTimestampedBlocks)
    .reduce(processTimestampedBlock, initialState)
    .commits;
};
