# Landscape: What Already Exists

## Direct Competitors & Prior Art

| Project                                                                                     | What It Does                                                                                                                                                                          | Status           | Relevance                                 |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------- |
| [git-memento](https://github.com/mandel-macaque/memento)                                    | Attaches session transcripts to commits via git notes. CLI: `git memento commit <session-id>`. Supports Codex + Claude Code. Has a GitHub Action that posts notes as PR comments.     | Active           | **Closest to Orchid** - fork candidate    |
| [SpecStory](https://marketplace.visualstudio.com/items?itemName=SpecStory.specstory-vscode) | VS Code extension that auto-saves all AI conversations to `.specstory/history/` as Markdown. Supports Copilot, Cursor, Claude Code, Codex CLI, Gemini CLI. Has cloud sync.            | Most mature      | Capture layer only, no commit linking     |
| [git-ai](https://github.com/git-ai-project/git-ai)                                          | Tracks which _lines_ are AI-generated using git notes with a formal [Authorship Log spec v3.0.0](https://github.com/git-ai-project/git-ai/blob/main/specs/git_ai_standard_v3.0.0.md). | Active           | Line-level attribution, not conversations |
| [prompt-provenance](https://github.com/boydstor/prompt-provenance)                          | Links AI conversations to git commits via git notes with secret redaction.                                                                                                            | Early            | Similar concept, less mature              |
| [ai-cli-log](https://github.com/alingse/ai-cli-log)                                         | CLI wrapper that captures terminal AI sessions as Markdown.                                                                                                                           | Active, 63 stars | Capture mechanism reference               |
| [Mission Control](https://deepwiki.com/agisota/missioncontrol)                              | Scans `~/.claude/projects/` on a schedule, stores sessions in local SQLite, REST API.                                                                                                 | Active           | Scanner code reference                    |
| [clog](https://github.com/HillviewCap/clog)                                                 | Web-based Claude Code log viewer with real-time file watching.                                                                                                                        | Active           | UI reference                              |
| [OpenCode](https://github.com/anomalyco/opencode)                                           | Open-source AI coding agent (TypeScript, 131k+ stars). Has plugin SDK with tool hooks, snapshot system tracking per-step diffs, full session/message/part persistence in SQLite.      | Very active      | Plugin target + architecture reference    |
| [Lore](https://arxiv.org/abs/2603.15566)                                                    | Academic protocol for structured commit messages with decision context via git trailers.                                                                                              | Paper            | Spec reference                            |

## Adjacent Products (AI Code Review)

| Product                                  | Approach                                   |
| ---------------------------------------- | ------------------------------------------ |
| [CodeRabbit](https://www.coderabbit.ai/) | AI-powered code review comments on PRs     |
| Graphite                                 | Fast PR workflow with stacked diffs        |
| Greptile                                 | AI code review with codebase understanding |

## The Gap

**No existing tool provides the full loop:**

1. Capture conversations from multiple AI tools
2. Store them linked to git commits
3. Render them beautifully alongside diffs in PR review

- git-memento stores but rendering is basic (PR comments only)
- SpecStory captures but doesn't integrate into PR review
- git-ai tracks authorship but not conversations
- clog renders but doesn't link to commits

**Orchid fills this gap.**

## How AI Tools Store Conversations Locally

### Claude Code

- **Location**: `~/.claude/projects/<escaped-path>/<session-uuid>.jsonl`
- **Format**: JSONL, one line per message
- **Key fields per line**:
  - `type`: "user" | "assistant" | "file-history-snapshot"
  - `sessionId`, `timestamp`, `cwd`, `gitBranch`, `version`
  - `uuid`, `parentUuid` (message threading)
  - `message`: standard Claude API format (role + content)
- **Session index**: `~/.claude/sessions/<pid>.json`
- **Hooks**: `Stop` hook receives `{ session_id, transcript_path, cwd }` via stdin

### OpenAI Codex CLI

- **Location**: `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread-uuid>.jsonl`
- **SQLite DB**: `~/.codex/state_5.sqlite` with `threads` table containing `git_sha`, `git_branch`, `git_origin_url`
- **JSONL event types**: `session_meta`, `event_msg`, `response_item`, `turn_context`

### Cursor

- **Storage**: SQLite databases (`state.vscdb`) in workspace storage
- **Export**: Community tools exist (cursor-chat-export)

### Key Insight

Both Claude Code and Codex already write structured, parseable conversation logs. We don't need a PTY proxy or shell wrapper - we just need to read what's already there.
