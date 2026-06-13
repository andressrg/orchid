import { execSync } from 'child_process';
import { getConfig, getAuthHeaders } from '../config';

// Conversation-aware code review for agents — the flagship Orchid flow.
//
// Before writing a single review comment, a reviewing agent asks Orchid: who
// built this PR, across which sessions, and WHY? It resolves the PR/branch's
// commit SHAs LOCALLY (via `gh`/`git`), POSTs them to the server-side
// `/api/review-context` endpoint (Claude, never OpenAI), and prints a
// review-context brief grounded in the building agents' thoughts.
//
// `orchid ask-context <pr>` is the pre-review call (brief + session list);
// `orchid review <pr>` frames the same brief as review prep. Both run this.

// ── ANSI (Claude Code TUI style: clean, dim secondary text, section headers) ──
const BOLD = '\x1b[1m';
const DIM = '\x1b[90m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const BLUE = '\x1b[34m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

interface ReviewContextSession {
  readonly id: string;
  readonly user_name: string;
  readonly branch: string;
  readonly commit_shas: readonly string[];
}

interface ReviewContextResponse {
  readonly sessions_analyzed: number;
  readonly sessions: readonly ReviewContextSession[];
  readonly brief: string;
}

interface ResolvedArgs {
  readonly target: string | null;
  readonly json: boolean;
}

// Split argv into the (first non-flag) target and the --json flag.
function parseArgs(args: readonly string[]): ResolvedArgs {
  const target = args.find((a) => !a.startsWith('-')) ?? null;
  const json = args.includes('--json');
  return { target, json };
}

// A PR reference is a bare number ("42") or a GitHub PR URL
// (".../pull/42"). Anything else is treated as a branch name.
export function parsePrNumber(target: string): number | null {
  const trimmed = target.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const urlMatch = trimmed.match(/\/pull\/(\d+)/);
  if (urlMatch) return Number(urlMatch[1]);
  return null;
}

// Dedup SHAs preserving first-seen order; drop blanks. (No mutation.)
export function dedupShas(shas: readonly string[]): readonly string[] {
  return shas
    .map((s) => s.trim())
    .filter(Boolean)
    .reduce<readonly string[]>(
      (acc, sha) => (acc.includes(sha) ? acc : [...acc, sha]),
      [],
    );
}

// Split a command's stdout into trimmed, non-empty lines.
export function splitShaLines(stdout: string): readonly string[] {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function runShell(command: string): string {
  try {
    return execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

// Resolve a branch's commits as the range default-base..branch. Tries
// origin/main first, then main; returns [] if neither base exists.
function resolveBranchShas(branch: string): readonly string[] {
  const base =
    runShell('git rev-parse --verify --quiet origin/main') !== ''
      ? 'origin/main'
      : runShell('git rev-parse --verify --quiet main') !== ''
        ? 'main'
        : null;
  if (!base) return [];
  return splitShaLines(runShell(`git rev-list ${base}..${branch}`));
}

// Resolve the target (PR number/URL or branch) to its commit SHAs, locally.
function resolveTargetShas(target: string): readonly string[] {
  const prNumber = parsePrNumber(target);
  if (prNumber !== null) {
    return dedupShas(
      splitShaLines(
        runShell(`gh pr view ${prNumber} --json commits --jq '.commits[].oid'`),
      ),
    );
  }
  return dedupShas(resolveBranchShas(target));
}

const HELP = `orchid review / ask-context — conversation-aware code review for agents

Usage:
  orchid ask-context <branch | pr# | pr-url> [--json]
  orchid review      <branch | pr# | pr-url> [--json]

Resolves the PR/branch's commits to the AI sessions that BUILT them, then asks
Orchid (Claude) for a review-context brief — intent, decisions, risks, and what
the diff alone won't reveal — BEFORE you write a single review comment.

  ask-context   The pre-review call: prints the brief + the building sessions.
  review        The same intelligence, framed as review prep.

Options:
  --json   Print the raw { sessions, brief } JSON (for agent consumption).

Examples:
  orchid ask-context 42
  orchid ask-context https://github.com/org/repo/pull/42
  orchid review feat/webhook-retry
  orchid review 42 --json
`;

// Print the brief + building-session list in the Claude Code TUI style. `mode`
// only changes the framing copy; the underlying intelligence is identical.
function printBrief(params: {
  mode: 'review' | 'ask-context';
  target: string;
  data: ReviewContextResponse;
  webUrl: string;
}): void {
  const { mode, target, data, webUrl } = params;
  const title =
    mode === 'review' ? '🌸 Orchid Review — grounded in intent' : '🌸 Orchid Review Context';

  console.log(`${MAGENTA}${title}${RESET}`);
  console.log(
    `${DIM}${data.sessions_analyzed} session${data.sessions_analyzed === 1 ? '' : 's'} built ${target}${RESET}\n`,
  );

  console.log(`${CYAN}${BOLD}Review-context brief${RESET}`);
  console.log(`${data.brief.trim()}\n`);

  console.log(`${CYAN}${BOLD}Building sessions${RESET}`);
  console.log(
    data.sessions
      .map((s) => {
        const shas = s.commit_shas.map((sha) => sha.slice(0, 8)).join(', ');
        return [
          `${BOLD}• ${s.user_name}${RESET} ${DIM}on ${s.branch}${RESET}`,
          `  ${DIM}session ${s.id}${RESET}`,
          `  ${DIM}commits: ${shas}${RESET}`,
          `  ${BLUE}${webUrl}/sessions/${encodeURIComponent(s.id)}${RESET}`,
        ].join('\n');
      })
      .join('\n\n'),
  );

  console.log(
    `\n${DIM}Review against this intent — not just the diff.${RESET}`,
  );
}

export async function runReviewContext(
  mode: 'review' | 'ask-context',
  args: string[],
): Promise<void> {
  const { target, json } = parseArgs(args);

  if (!target || args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return;
  }

  const { apiUrl, webUrl } = getConfig();

  // 1. Resolve the PR/branch's commit SHAs locally.
  const shas = resolveTargetShas(target);

  if (shas.length === 0) {
    if (json) {
      console.log(JSON.stringify({ sessions: [], brief: '' }));
      return;
    }
    console.log(
      `${YELLOW}No commits found for "${target}".${RESET}\n` +
        `${DIM}If it's a PR, check the number/URL and that 'gh' is authenticated.\n` +
        `If it's a branch, make sure it exists and origin/main (or main) is the base.${RESET}`,
    );
    return;
  }

  if (!json) {
    console.log(
      `${DIM}Resolved ${shas.length} commit${shas.length === 1 ? '' : 's'} for "${target}" — asking Orchid who built them…${RESET}`,
    );
  }

  // 2. POST the SHAs to the server-side Claude review-context endpoint.
  const res = await fetch(`${apiUrl.replace(/\/$/, '')}/review-context`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ shas }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(
      `${RED}Orchid review-context failed (${res.status}).${RESET} ${DIM}${detail}${RESET}`,
    );
    process.exit(1);
  }

  const data = (await res.json()) as ReviewContextResponse;

  // 3a. Agent consumption: raw JSON.
  if (json) {
    console.log(JSON.stringify({ sessions: data.sessions, brief: data.brief }));
    return;
  }

  // 3b. No session matched these commits yet.
  if (data.sessions_analyzed === 0) {
    console.log(
      `${YELLOW}These commits aren't linked to any Orchid session yet.${RESET}\n` +
        `${DIM}The building agents may not have synced their sessions, or commit-linking\n` +
        `hasn't run for them. Review the diff directly, or ask the author to sync.${RESET}`,
    );
    return;
  }

  // 3c. Human-facing TUI brief.
  printBrief({ mode, target, data, webUrl });
}

// `orchid review <pr|branch>` — review prep grounded in intent.
export async function runReview(args: string[]): Promise<void> {
  return runReviewContext('review', args);
}

// `orchid ask-context <pr|branch>` — the pre-review call (brief + sessions).
export async function runAskContext(args: string[]): Promise<void> {
  return runReviewContext('ask-context', args);
}
