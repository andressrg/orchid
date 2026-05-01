# Plan v3: Codex CLI Support

## Goal

Add first-class OpenAI Codex CLI capture to Orchid without weakening the current Claude Code flow.

The target user experience:

```bash
orchid codex
orchid codex "fix the failing tests"
orchid codex --search "review this module"
orchid sync --discover --tool codex
orchid data show <codex-session-id> --turns
```

Codex support should preserve Orchid's core idea: capture raw AI coding conversations in near realtime, store them with git metadata, and make the context useful later through CLI, web UI, review, explain, summaries, search, and commit correlation.

## Current Repo Findings

The existing architecture already has most of the right shape.

- `cli/src/main.ts` dispatches `orchid claude`, `orchid sync`, `orchid data`, `orchid review`, and `orchid explain`.
- `cli/src/commands/claude.ts` launches `claude`, finds a new transcript in `~/.claude/projects`, and starts the watcher.
- `cli/src/sync.ts` periodically uploads the whole transcript with metadata to `PUT /sessions/:id`.
- `cli/src/commands/sync.ts` bulk-discovers past Claude sessions from `~/.claude/projects` and Claude's `sessions-index.json`.
- `web/app/lib/api-app.ts` accepts gzipped transcript upserts, stores raw JSONL in `orchid_session.transcript`, and extracts commits with `after()`.
- The production API has a single implementation: the Hono app in `web/app/lib/api-app.ts`, mounted by `web/app/api/[[...route]]/route.ts`.
- `web/app/lib/api.ts`, `cli/src/commands/data.ts`, summary, chat, decision extraction, review, and explain all parse transcript turns directly.
- The database already has a generic `tool` column, so a schema migration is probably not required for basic Codex support.

The main blocker is that Claude assumptions are spread through the CLI and read path:

- Launch command is hardcoded to `claude`.
- Live discovery only scans `~/.claude/projects`.
- Bulk discovery only scans Claude projects and indexes.
- Uploaded `tool` is hardcoded to `claude-code`.
- Turn parsers mostly understand Claude-style `type: "human"` / `type: "assistant"` or `message.role`.
- Commit extraction is Claude-specific and only recognizes `tool_use` blocks named `Bash`.
- UI/README copy says `orchid claude` as the only capture command.

## Codex Research

Official OpenAI docs describe Codex CLI as a local terminal coding agent that can read, edit, and run code in the selected directory, installed with `npm i -g @openai/codex` and run with `codex`. The same docs say new versions ship regularly and point users to the Codex changelog for releases.

Official CLI feature docs show interactive TUI usage, local code review, subagents, web search, Codex Cloud tasks, MCP, approval modes, and `codex exec` for non-interactive scripting.

The current official changelog lists Codex CLI `0.128.0` on `2026-04-30`, with active work around persisted goals, permission profiles, TUI controls, plugins, hooks, external-agent imports, and resume reliability. This matters because Orchid should not depend on private, brittle UI behavior when file and metadata artifacts are enough.

Local validation on this machine:

- `codex --help` is available at `/opt/homebrew/bin/codex`.
- Installed Codex is `0.128.0`.
- Codex stores rollout JSONL files under `~/.codex/sessions/YYYY/MM/DD/rollout-...jsonl`.
- Codex stores session metadata in `~/.codex/state_5.sqlite`, table `threads`.
- `threads` includes `id`, `rollout_path`, `created_at`, `updated_at`, `source`, `cwd`, `title`, `git_branch`, `git_origin_url`, `cli_version`, `first_user_message`, `model`, and `reasoning_effort`.
- `~/.codex/history.jsonl` maps recent prompt text to `session_id`, but it is not enough by itself because it lacks the rollout path.
- Codex rollout JSONL includes entries like `session_meta`, `response_item`, `event_msg`, `turn_context`, and `token_count`, so existing Claude parsers will undercount or miss useful turns.

Sources:

- OpenAI Codex CLI docs: https://developers.openai.com/codex/cli
- OpenAI Codex CLI features: https://developers.openai.com/codex/cli/features
- OpenAI Codex changelog: https://developers.openai.com/codex/changelog
- OpenAI Codex GitHub repo: https://github.com/openai/codex

## Product Decision

Implement Codex as a peer tool, not a special case bolted onto `claude.ts`.

The right abstraction is a small tool adapter:

```ts
interface AiToolAdapter {
  readonly commandName: string;
  readonly binaryName: string;
  readonly displayName: string;
  readonly storageToolName: string;
  readonly findLiveTranscriptPath: (params: FindTranscriptParams) => string | null;
  readonly discoverLocalSessions: (params: DiscoverSessionsParams) => readonly LocalSession[];
  readonly parseTranscriptTurns: (transcript: string) => readonly TranscriptTurn[];
  readonly extractCommits: (transcript: string) => readonly ExtractedCommit[];
}
```

Claude and Codex can then share:

- process spawning
- signal handling
- periodic sync
- final sync
- git metadata collection
- single-file sync
- data command formatting
- read-path AI features

This keeps future support for Cursor, Aider, Gemini CLI, or other tools straightforward.

## Phase 1: CLI Live Capture

Deliverable: `orchid codex` launches Codex and syncs the active Codex rollout to Orchid.

Tasks:

- Add `cli/src/commands/codex.ts` or a shared `cli/src/commands/wrap-tool.ts`.
- Refactor `collectGitMetadata` out of `claude.ts` into a shared module.
- Refactor `startSyncWatcher` to accept `tool` as metadata instead of hardcoding `claude-code`.
- Register `codex` in `cli/src/main.ts` help and dispatch.
- Spawn `codex` with all args, inherited stdio, inherited env, and current working directory.
- Detect the live transcript using `~/.codex/sessions` file scanning first, filtered by:
  - file birth/mtime after wrapper start
  - filename `rollout-*.jsonl`
  - first `session_meta.payload.cwd` matching the wrapper cwd when available
- Use `~/.codex/state_5.sqlite` only as an optional refinement when the `sqlite3` binary is present, not as an npm dependency.
- Upload sessions with `tool: "codex-cli"`.
- Derive Codex session IDs from the `session_meta.payload.id` when present, with filename parsing as fallback.
- Keep the final sync behavior identical to Claude.

Acceptance checks:

- `orchid codex --help` forwards to Codex without Orchid swallowing flags.
- `orchid codex "say hi"` creates or finds a Codex rollout file and uploads it.
- Server session row has `tool = "codex-cli"`, correct cwd, branch, remotes, and raw transcript.
- Existing `orchid claude` behavior still works.

## Phase 2: Transcript Parsing

Deliverable: Codex sessions are readable in `orchid data show --turns`, web session viewer, summaries, chat, decisions, review, and explain.

Tasks:

- Create a shared transcript parser module for both CLI and web, or duplicate a tiny pure parser in each package if workspace sharing is too much for this pass.
- Keep raw JSONL unchanged in the database.
- Normalize parsed turns into:
  - `role: "user" | "assistant" | "tool" | "system" | "unknown"`
  - `text`
  - `timestamp`
  - `sourceTool`
  - `rawType`
- Support Claude formats already handled today.
- Add Codex support for:
  - `event_msg.payload.type === "user_message"` as user text
  - `response_item.payload.type === "message"` and `payload.role === "assistant"` as assistant text
  - `response_item.payload.type === "function_call"` as tool invocation
  - `response_item.payload.type === "function_call_output"` as tool output
  - `session_meta.payload` for metadata
  - `turn_context.payload` for cwd, model, approval, sandbox, and runtime metadata when useful
- Exclude giant instruction/config payloads from normal turn rendering.
- Count meaningful user and assistant turns separately from raw JSONL line count in read views.

Acceptance checks:

- A real Codex rollout displays the user's prompt and assistant replies in the web session page.
- `orchid data show <id> --turns` is useful for Codex, not just raw JSON blobs.
- Summary and chat prompts receive readable Codex turns rather than base instructions.

## Phase 3: Bulk Sync Discovery

Deliverable: users can sync past Codex sessions with the same TUI flow as Claude.

Tasks:

- Generalize `LocalSession` with `tool` and `transcriptFormat`.
- Rename Claude-specific discovery text in `sync.ts`.
- Add `orchid sync --discover --tool claude`, `--tool codex`, and default `--tool all`.
- Discover Codex sessions from `~/.codex/state_5.sqlite` when `sqlite3` exists:
  - query `threads` ordered by `updated_at_ms` or `updated_at`
  - use `rollout_path`, `id`, `cwd`, `title`, `git_branch`, `git_origin_url`, `cli_version`, `model`, and `reasoning_effort`
- Fall back to scanning `~/.codex/sessions/**/*.jsonl`.
- Group Codex sessions by cwd/repo instead of Claude project key.
- Preserve current Claude `sessions-index.json` behavior.
- Sync Codex past sessions with `tool: "codex-cli"` and metadata from SQLite or parsed `session_meta`.

Acceptance checks:

- `orchid sync --discover --tool codex` lists local Codex sessions.
- `orchid sync --discover` lists Claude and Codex sessions without confusing the user.
- Already-synced Codex sessions are marked synced.

## Phase 4: Commit Extraction

Deliverable: Codex sessions populate the commits tab and power `orchid explain` with commit links.

Tasks:

- Rename `web/app/lib/extract-commits.ts` from Claude-specific language to tool-neutral language.
- Keep the current Claude extractor.
- Add Codex extraction for function/tool calls that run shell commands.
- Identify Codex command calls that contain `git commit`, `git merge`, `git cherry-pick`, or `git revert`.
- Pair command call IDs with their output events.
- Reuse the existing git output parser for `[branch sha] message`.
- Add unit fixtures with real Codex-style `response_item` lines.

Acceptance checks:

- Existing Claude commit extraction tests still pass.
- New Codex commit extraction tests pass.
- A Codex session that commits code shows commits in the web UI.

## Phase 5: UI and Docs

Deliverable: Codex support is visible and understandable without reading code.

Tasks:

- Update README quick start and CLI README:
  - `orchid claude`
  - `orchid codex`
  - `orchid sync --discover --tool all`
- Update marketing/dashboard/sidebar copy where it implies Claude-only capture.
- Display nicer tool labels:
  - `claude-code` -> `Claude Code`
  - `codex-cli` -> `Codex CLI`
- Add a subtle tool filter to dashboard/search later if sessions become noisy.
- Add release notes for npm package.

Acceptance checks:

- New users can discover `orchid codex` from `orchid --help` and README.
- Web UI does not present Codex sessions as Claude sessions.

## Phase 6: Testing and Release

Tests to add:

- CLI unit tests for Codex session ID extraction.
- CLI unit tests for Codex transcript path detection using temp directories.
- CLI unit tests for Codex local discovery from parsed `session_meta`.
- Parser tests for Claude and Codex formats.
- Commit extraction tests for Claude and Codex formats.
- E2E smoke test using a fake Codex JSONL transcript uploaded through the API.

Manual validation:

- Run `pnpm --filter orchid-cli test`.
- Run `pnpm --filter orchid-cli check`.
- Run web unit tests touching transcript parsing and commit extraction.
- Run `bash check.sh`.
- Start local web app and use the headed browser to inspect a Codex session page.
- Run a real `orchid codex` session against staging or production.
- Verify the production UI shows the active session, then shows it as done after exit.

Release:

- Commit and push the implementation branch.
- Open a PR.
- Merge after checks pass.
- Deploy the web/API path.
- Publish a CLI patch release because this adds a user-facing command.

## Risks and Mitigations

Codex internals may change.

- Mitigation: treat raw JSONL as canonical, keep parser tolerant, use filename scanning as baseline, and use SQLite only as an enhancement.

Codex writes large metadata/instruction payloads.

- Mitigation: store raw data, but exclude noisy metadata from human turn views and AI summary/chat prompt construction.

`sqlite3` is not guaranteed on every user's machine.

- Mitigation: do not add native npm dependencies in the first pass. Use filesystem scanning as the portable path.

False transcript detection when multiple Codex sessions start at once.

- Mitigation: filter by start time, cwd from `session_meta`, and state DB `threads.cwd` when available. If ambiguous, choose the newest matching cwd and log the selected path.

Existing parsing logic is duplicated.

- Mitigation: first make small pure parser modules with tests; after behavior is correct, consider moving shared parser logic into a workspace package.

## Recommended Implementation Order

1. Add shared tool metadata and make sync uploads tool-aware.
2. Add `orchid codex` live wrapper with filesystem detection.
3. Add Codex parser fixtures and make `data show --turns` work.
4. Update web parser and session viewer.
5. Add Codex bulk discovery.
6. Add Codex commit extraction.
7. Update docs and UI copy.
8. Run full validation and release.

The smallest valuable PR is phases 1 and 2 together. Live capture without readable turns technically stores data, but the first user impression will be poor if the web UI mostly shows Codex metadata instead of the conversation.
