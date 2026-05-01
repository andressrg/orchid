# Plan v4: Pragmatic Codex CLI Support

## Goal

Add first-class OpenAI Codex CLI capture to Orchid while preserving the current Claude Code workflow.

Target user experience:

```bash
orchid codex
orchid codex "fix the failing tests"
orchid codex --search "review this module"
orchid sync --discover --tool codex
orchid sync --discover --tool all
orchid data show <codex-session-id> --turns
```

The first useful release should do three things well:

- Capture live Codex sessions without breaking `orchid claude`.
- Render Codex conversations as readable turns in CLI and web surfaces.
- Sync past Codex sessions with clear metadata and no Claude-only labeling.

Commit correlation, richer filters, and broad polish should follow after the capture and parser foundation is stable.

## Current State

The repo is close to supporting multiple tools, but Claude assumptions are spread through the capture and read paths.

- `cli/src/commands/claude.ts` owns process spawning, git metadata, transcript discovery, and signal handling.
- `cli/src/sync.ts` uploads transcripts every five seconds but hardcodes `tool: "claude-code"`.
- `cli/src/commands/sync.ts` only discovers `~/.claude/projects` and Claude `sessions-index.json` files.
- `cli/src/commands/data.ts`, `web/app/lib/api.ts`, and AI endpoints in `web/app/lib/api-app.ts` each parse transcript turns separately.
- `web/app/lib/extract-commits.ts` only understands Claude `Bash` `tool_use` and `tool_result` blocks.
- The database already has `orchid_session.tool`, so basic Codex support should not require a schema migration.

The main implementation risk is not launching `codex`; it is normalizing Codex's transcript format once and ensuring every downstream read path uses that normalization.

## Codex Storage Decision

Use Codex rollout JSONL as Orchid's storage source of truth for the first implementation.

Observed Codex CLI `0.128.0` stores:

- rollout files under `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- session metadata in `~/.codex/state_5.sqlite`, table `threads`
- recent prompt history in `~/.codex/session_index.jsonl` or history files, depending on version

Official docs also expose an experimental app-server protocol with thread and turn access. Do not build Phase 1 on app-server because it is still experimental and would introduce a running service dependency. Keep it as a tracked research path for later.

Source priority:

1. Rollout JSONL is canonical for uploaded raw transcript content.
2. `session_meta.payload.id` is canonical for Codex session ID when present.
3. `state_5.sqlite` is a read-only metadata hint for discovery and disambiguation when available.
4. Filesystem scanning is the portable fallback.
5. App-server is deferred until it is clearly stable enough or needed for better live streaming.

SQLite rules:

- Never add a native SQLite npm dependency in the first pass.
- Use the `sqlite3` binary only when present.
- Open local state read-only where possible.
- Treat SQLite rows as hints; validate that `rollout_path` exists before syncing.
- Fall back cleanly when the DB is missing, locked, or has a changed schema.

## Architecture

Split tool concerns into capture adapters and transcript parsers.

```ts
interface AiToolCaptureAdapter {
  readonly commandName: string;
  readonly binaryName: string;
  readonly displayName: string;
  readonly storageToolName: "claude-code" | "codex-cli";
  readonly transcriptFormat: "claude-jsonl" | "codex-rollout-jsonl";
  readonly findLiveTranscript: (params: FindLiveTranscriptParams) => TranscriptDetection | null;
  readonly discoverLocalSessions: (params: DiscoverLocalSessionsParams) => readonly LocalSession[];
  readonly deriveSessionId: (params: DeriveSessionIdParams) => string;
}

interface TranscriptFormatParser {
  readonly transcriptFormat: "claude-jsonl" | "codex-rollout-jsonl";
  readonly parseTurns: (params: ParseTranscriptParams) => readonly TranscriptTurn[];
  readonly extractCommits: (params: ExtractCommitsParams) => readonly ExtractedCommit[];
  readonly summarizeMetadata: (params: ParseTranscriptParams) => TranscriptMetadata;
}
```

Keep local capture code in the CLI. Keep parser behavior in small pure modules that can be copied or shared between CLI and web in this PR. Prefer sharing if the workspace structure makes that cheap; otherwise duplicate the pure parser with identical fixtures and defer package extraction.

Normalized turn shape:

```ts
interface TranscriptTurn {
  readonly role: "user" | "assistant" | "tool" | "system";
  readonly text: string;
  readonly timestamp: string | null;
  readonly sourceTool: "claude-code" | "codex-cli";
  readonly rawType: string;
  readonly rawRole: string | null;
  readonly callId: string | null;
}
```

Important rule: raw transcript storage remains unchanged. Normalization is only for display, AI prompts, message counts, search snippets, summaries, chat, decisions, review, explain, and commit extraction.

## Codex Parser Contract

Codex rollouts contain overlapping event streams. The parser must choose canonical user and assistant events to avoid duplicate turns.

Canonical display rules:

- User turns: prefer `event_msg.payload.type === "user_message"` and `payload.message`.
- Assistant turns: prefer `event_msg.payload.type === "agent_message"` and `payload.message`.
- Tool calls: use `response_item.payload.type === "function_call"` for call name, call ID, and arguments.
- Tool results: use `response_item.payload.type === "function_call_output"` for tool output.
- Shell command details: use `event_msg.payload.type === "exec_command_end"` when command, cwd, exit code, stdout, or stderr are needed.
- Metadata: use `session_meta.payload` and `turn_context.payload` only for metadata, never normal conversation turns.

Dedupe rules:

- Do not render both `event_msg.agent_message` and `response_item.message` for the same assistant text.
- Do not render both `event_msg.user_message` and `response_item.message` for the same user text.
- Ignore `response_item.payload.role === "developer"` in normal user-facing turns.
- Ignore `session_meta.payload.base_instructions`, `turn_context.payload.user_instructions`, and other large instruction/config fields in normal views and AI prompts.

Text extraction rules:

- Accept plain strings.
- Accept array content blocks with `type: "input_text"`, `type: "output_text"`, or `type: "text"`.
- For function-call arguments, parse JSON arguments when possible and render a compact command/tool summary.
- Truncate very large tool outputs for display and AI prompts, but keep raw JSONL intact.

Message count rule:

- `message_count` should eventually mean meaningful user + assistant turns, not raw JSONL line count.
- For the first release, do not change historical Claude counts unless the migration cost is justified. It is acceptable to compute improved counts on upload for new sessions and display parsed turn counts in the web session page.

## Phase 1: Tool-Aware Sync Foundation

Deliverable: existing Claude capture still works, and sync upload accepts tool metadata.

Tasks:

- Move git metadata collection out of `cli/src/commands/claude.ts`.
- Add a shared wrapper runner for interactive tools.
- Change `startSyncWatcher` to accept:
  - `tool`
  - `transcriptFormat`
  - `deriveSessionId`
  - transcript path
  - git metadata
- Stop importing `GitMetadata` from the Claude command.
- Preserve current `orchid claude` behavior and session IDs.
- Add unit tests for Claude path/session ID behavior before adding Codex behavior.

Acceptance checks:

- `orchid claude --help` still forwards to Claude.
- `orchid claude` still uploads `tool: "claude-code"`.
- CLI tests pass.

## Phase 2: Live Codex Capture

Deliverable: `orchid codex` launches Codex and syncs the active rollout to Orchid.

Tasks:

- Register `codex` in `cli/src/main.ts` help and dispatch.
- Spawn `codex` with inherited stdio, inherited env, and the correct cwd.
- Forward all args to Codex unless Orchid owns the flag before the subcommand.
- Support basic interactive and prompt mode:
  - `orchid codex`
  - `orchid codex "fix the failing tests"`
  - `orchid codex --search "review this module"`
  - `orchid codex --help`
- Detect live transcript using a two-step strategy:
  - First, inspect recent `state_5.sqlite` rows when `sqlite3` exists and match `cwd`, `created_at_ms` or `updated_at_ms`, and `rollout_path`.
  - Then fall back to scanning `~/.codex/sessions/**/*.jsonl` for `rollout-*.jsonl` files with birthtime or mtime after wrapper start.
- Confirm candidate files by reading early JSONL lines and matching `session_meta.payload.cwd` when available.
- Derive session ID from `session_meta.payload.id`; fall back to SQLite `threads.id`; fall back to parsing the rollout filename.
- Upload sessions with `tool: "codex-cli"` and `transcriptFormat: "codex-rollout-jsonl"` in local code, even if the API only stores `tool`.

Explicit Phase 2 boundaries:

- `codex resume` and `codex fork` are best-effort. They may append to an existing rollout whose birthtime is before wrapper start. Support them only when SQLite identifies the active updated thread. Document the limitation if unsupported.
- `codex --cd <dir>` should be supported by parsing forwarded args and matching the effective Codex cwd. If this is too much for Phase 2, warn when `--cd` is present and use best-effort detection.
- `codex exec` is not the primary target for live capture. It can work if it writes a rollout, but do not optimize Phase 2 around non-interactive exec.

Acceptance checks:

- `orchid codex --help` shows Codex help.
- `orchid codex "say hi"` creates or finds a Codex rollout and uploads it.
- The server row has `tool = "codex-cli"`, correct cwd, branch, remotes, status, and raw transcript.
- Concurrent unrelated Codex sessions do not obviously attach the wrong transcript when cwd differs.
- Existing `orchid claude` still works.

## Phase 3: Shared Transcript Parsing Across Read Paths

Deliverable: Codex sessions are readable everywhere Orchid currently reads transcripts.

Tasks:

- Add parser fixtures from real Codex rollouts and representative Claude JSONL.
- Implement parser functions for:
  - Claude user and assistant messages
  - Claude tool calls and tool results
  - Codex user and assistant messages
  - Codex function calls and outputs
  - Codex shell command end events
  - metadata extraction
- Replace local parsing in:
  - `cli/src/commands/data.ts`
  - `web/app/lib/api.ts`
  - `web/app/lib/api-app.ts` summary endpoint
  - `web/app/lib/api-app.ts` chat endpoint
  - `web/app/lib/api-app.ts` decisions endpoint
  - `cli/src/commands/review.ts`
  - `cli/src/commands/explain.ts`
- Ensure user-facing views exclude base instructions, developer messages, config payloads, token-count events, and noisy metadata.
- Use parsed turns for display and AI prompts.

Acceptance checks:

- `orchid data show <codex-session-id> --turns` shows the user's prompt and assistant replies.
- Web session page shows meaningful Codex turns, not metadata.
- Summary and chat prompts receive readable Codex turns.
- Decision extraction sees real user/assistant turns for Codex sessions.
- Claude parser tests still pass.

## Phase 4: Bulk Codex Discovery

Deliverable: users can sync past Codex sessions with the same TUI flow as Claude.

Tasks:

- Add `tool` and `transcriptFormat` to `LocalSession`.
- Add `orchid sync --discover --tool claude`, `--tool codex`, and `--tool all`.
- Default `orchid sync --discover` to `--tool all`.
- Discover Codex sessions from read-only SQLite metadata when available:
  - `id`
  - `rollout_path`
  - `created_at_ms` or `created_at`
  - `updated_at_ms` or `updated_at`
  - `cwd`
  - `title`
  - `first_user_message`
  - `git_branch`
  - `git_origin_url`
  - `cli_version`
  - `model`
  - `reasoning_effort`
- Fall back to scanning rollout files and parsing `session_meta`.
- Group Codex sessions by repo/cwd, not Claude project key.
- Preserve Claude `sessions-index.json` behavior.
- Make the TUI labels tool-aware.
- Show a concise privacy note before bulk syncing raw local transcripts.

Acceptance checks:

- `orchid sync --discover --tool codex` lists local Codex sessions.
- `orchid sync --discover --tool all` lists Claude and Codex sessions clearly.
- Already synced Codex sessions are marked synced.
- Syncing a Codex session uploads `tool: "codex-cli"`.
- Missing or locked SQLite does not break discovery.

## Phase 5: Codex Commit Extraction

Deliverable: Codex sessions populate commit correlation when Codex creates commits.

Tasks:

- Rename commit extraction internals from Claude-specific wording to tool-neutral wording.
- Keep the current Claude extractor behavior.
- Add Codex extraction:
  - identify `response_item.payload.type === "function_call"`
  - require `payload.name === "exec_command"` or another known shell-capable tool name
  - parse `payload.arguments` as JSON
  - inspect `arguments.cmd`
  - match `git commit`, `git merge`, `git cherry-pick`, and `git revert`
  - pair by `payload.call_id`
  - prefer `event_msg.exec_command_end` output for stdout/stderr/exit code
  - fall back to `function_call_output.payload.output`
- Reuse the existing git output parser for `[branch sha] message`.
- Add real Codex fixtures.

Acceptance checks:

- Existing Claude commit extraction tests pass.
- New Codex commit extraction tests pass.
- A Codex session that runs `git commit` shows commits in the web UI.

## Phase 6: UI and Docs

Deliverable: Codex support is visible without reading code.

Tasks:

- Update root README and CLI README:
  - `orchid claude`
  - `orchid codex`
  - `orchid sync --discover --tool all`
- Update dashboard/session copy where it implies Claude-only capture.
- Display friendly tool labels:
  - `claude-code` -> `Claude Code`
  - `codex-cli` -> `Codex CLI`
- Add a simple tool filter only if mixed sessions make the dashboard noisy.
- Add release notes for the CLI package.

Acceptance checks:

- `orchid --help` shows `codex`.
- New users can discover Codex capture from the README.
- Web UI never labels Codex sessions as Claude sessions.

## Testing

Automated tests:

- CLI tests for Codex session ID extraction.
- CLI tests for Codex live transcript detection using temp directories.
- CLI tests for `--cd` effective cwd parsing, or a documented unsupported-case test.
- CLI tests for Codex local discovery from SQLite-shaped rows and parsed `session_meta`.
- Parser tests for Claude and Codex formats.
- Parser dedupe tests proving Codex user/assistant turns are not duplicated.
- Parser tests proving developer/base instruction payloads are excluded from normal turns.
- Commit extraction tests for Claude and Codex.
- API upload smoke test with a fake Codex rollout transcript.

Manual validation:

- `pnpm --filter orchid-cli test`
- `pnpm --filter orchid-cli check`
- Web unit tests touching transcript parsing and commit extraction.
- `bash check.sh`
- Start the local web app and inspect a Codex session with the headed browser.
- Run a real `orchid codex` session against staging or production.
- Verify active status during the session and done status after exit.
- Verify a mixed Claude + Codex dashboard.

## Implementation Order

1. Add parser fixtures and define the normalized turn contract.
2. Make sync upload tool-aware without changing behavior.
3. Refactor Claude live capture onto the shared wrapper.
4. Add `orchid codex` live capture.
5. Replace read-path transcript parsing with the shared parser.
6. Add Codex bulk discovery.
7. Add Codex commit extraction.
8. Update docs and UI labels.
9. Run full validation and release.

The smallest PR worth merging is phases 1 through 3. Live capture without readable turns stores data but creates a bad first impression. Bulk discovery and commit extraction can land in follow-up PRs if the live capture and parser are solid.

## Risks

Codex internals may change.

- Mitigation: store raw rollout JSONL, keep parsing tolerant, use SQLite only as a hint, and track app-server as a future source when stable.

False transcript detection may attach the wrong rollout.

- Mitigation: match effective cwd, start/update time, filename pattern, `session_meta.payload.cwd`, and SQLite `threads.rollout_path` when available. If candidates are ambiguous, log the candidate list and choose the newest matching cwd.

Codex rollouts include sensitive or noisy content.

- Mitigation: raw upload is explicit Orchid behavior, but bulk discovery should warn before syncing. User-facing views and AI prompts must exclude base instructions and noisy config payloads.

Parser duplication can drift.

- Mitigation: prefer a shared parser module. If duplicated between CLI and web temporarily, keep fixtures identical and migrate to a shared workspace package after behavior stabilizes.

`sqlite3` is not installed everywhere.

- Mitigation: treat SQLite as optional and provide filesystem fallback.

Codex `resume` and `fork` are harder than new sessions.

- Mitigation: support them via SQLite updated-thread detection when possible and document any remaining limitation in Phase 2.

