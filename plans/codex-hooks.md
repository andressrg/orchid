# Codex Hooks Capture Plan

## Goal

Add automatic Codex conversation sync without requiring users to remember `orchid codex`.

The implementation should extend the merged Claude hooks work into a harness-neutral hook system. Claude is the first adapter, Codex is the second, and future tools like opencode, hermes, and openclawd should fit the same API without adding new top-level commands.

## User-Facing API

Use `orchid hooks` as the stable cross-harness surface:

```bash
orchid hooks install
orchid hooks install claude
orchid hooks install codex
orchid hooks install --all
orchid hooks install codex --mode auto
orchid hooks install claude --mode prompt

orchid hooks uninstall
orchid hooks uninstall claude
orchid hooks uninstall codex
orchid hooks uninstall --all

orchid hooks status
orchid hooks status claude
orchid hooks status codex
orchid hooks list
```

Defaults:

- `orchid hooks install` installs all locally available supported harnesses.
- `--mode auto` remains the default and syncs every supported conversation.
- `--mode prompt` starts disabled and lets the assistant ask the user whether to sync.
- Existing Claude behavior remains available as `orchid hooks install claude`.

Internal commands should be tool-aware:

```bash
orchid hooks _on-start --tool claude
orchid hooks _on-stop --tool claude
orchid hooks _on-end --tool claude

orchid hooks _on-start --tool codex
orchid hooks _on-prompt --tool codex
orchid hooks _on-stop --tool codex
orchid hooks _enable-sync <session-id> --tool codex
```

## Storage

Replace the current single-tool hook config shape with a versioned multi-tool config:

```json
{
  "version": 1,
  "tools": {
    "claude": {
      "installed": true,
      "mode": "auto",
      "configPath": "~/.claude/settings.json"
    },
    "codex": {
      "installed": true,
      "mode": "auto",
      "configPath": "~/.codex/hooks.json"
    }
  }
}
```

Store active session state by tool:

```text
~/.orchid/hooks/claude/<session-id>.json
~/.orchid/hooks/codex/<session-id>.json
```

State payload:

```json
{
  "tool": "codex",
  "sessionId": "019...",
  "cwd": "/path/to/repo",
  "transcriptPath": "/Users/name/.codex/sessions/2026/04/30/rollout-...jsonl",
  "enabled": true,
  "startedAt": "2026-05-01T00:00:00.000Z"
}
```

## Harness Adapter Design

Introduce a small adapter layer owned by the hooks command:

```ts
type HookTool = "claude" | "codex";
type HookMode = "auto" | "prompt";
type HookLifecycleEvent = "start" | "prompt" | "stop" | "end";

interface HookHarnessAdapter {
  readonly tool: HookTool;
  readonly displayName: string;
  readonly storageToolName: string;
  readonly supportedEvents: readonly HookLifecycleEvent[];
  readonly configPath: () => string;
  readonly isAvailable: () => boolean;
  readonly readInstalledConfig: () => JsonObject;
  readonly installHooks: (params: { readonly mode: HookMode }) => void;
  readonly uninstallHooks: () => void;
  readonly parseHookInput: (params: {
    readonly input: JsonObject;
    readonly fallbackCwd: string;
  }) => NormalizedHookInput;
  readonly resolveTranscriptPath: (input: NormalizedHookInput) => string | null;
}
```

Normalized hook input:

```ts
interface NormalizedHookInput {
  readonly tool: HookTool;
  readonly sessionId: string;
  readonly cwd: string;
  readonly transcriptPath: string | null;
  readonly event: HookLifecycleEvent;
}
```

Shared hook handlers should:

- Parse `--tool`.
- Load the matching adapter.
- Normalize stdin JSON.
- Read or write Orchid session state.
- Sync through the existing gzip session PUT path.
- Never fail the AI harness if Orchid sync fails.

## Claude Adapter

The Claude adapter should preserve the merged Claude hooks behavior:

- Writes Orchid-managed entries into `~/.claude/settings.json`.
- Installs Claude `SessionStart`, `Stop`, and `SessionEnd` hooks.
- Preserves non-Orchid hooks during install and uninstall.
- Finds transcripts from `transcript_path` when provided, then falls back to `~/.claude/projects/**/<session-id>.jsonl`.
- Uploads with `tool: "claude-code"`.

The existing Claude tests should continue to pass after the adapter refactor.

## Codex Adapter

Use native Codex hooks instead of a wrapper.

Codex hook support is available in current Codex and exposes these useful events:

- `SessionStart`
- `UserPromptSubmit`
- `Stop`

Codex hook input includes fields such as:

- `session_id`
- `cwd`
- `transcript_path`
- `hook_event_name`
- `turn_id`
- `model`
- `permission_mode`

Install Orchid-managed Codex hooks into Codex's hook config. Prefer `~/.codex/hooks.json` if supported by the installed Codex version; otherwise use the `[hooks]` config shape in `~/.codex/config.toml`.

Installed commands:

```json
{
  "SessionStart": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "orchid hooks _on-start --tool codex",
          "timeout": 10
        }
      ]
    }
  ],
  "UserPromptSubmit": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "orchid hooks _on-prompt --tool codex",
          "timeout": 10
        }
      ]
    }
  ],
  "Stop": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "orchid hooks _on-stop --tool codex",
          "timeout": 30
        }
      ]
    }
  ]
}
```

Behavior:

- `_on-start --tool codex` writes session state.
- `_on-prompt --tool codex` supports prompt mode by injecting context that tells Codex it can enable Orchid sync if the user agrees.
- `_on-stop --tool codex` syncs the transcript with `status: "active"` after each Codex response.
- Codex does not currently provide a clear `SessionEnd` equivalent, so v1 should leave active Codex sessions as active and rely on future stale-session cleanup or discover/backfill to mark them done.
- Uploads use `tool: "codex-cli"`.

Prompt-mode output should use Codex hook output JSON, not plain text, so the hook can add context without polluting stdout unexpectedly.

## Sync Payload

Both adapters should use the same session upload path:

```http
PUT /sessions/<session-id>
Content-Type: application/json
Content-Encoding: gzip
Authorization: Bearer <token>
```

Payload:

```json
{
  "user_name": "...",
  "user_email": "...",
  "working_dir": "...",
  "git_remotes": ["..."],
  "branch": "...",
  "tool": "codex-cli",
  "transcript": "...",
  "status": "active"
}
```

Metadata collection should keep Orchid's multi-repo intent:

- Git user name and email from config.
- Current branch for the hook `cwd`.
- Origin remote for `cwd`.
- Origin remotes for immediate child git repos.

## Implementation Phases

### Phase 1: Generic Hook API

- Rename Claude-specific hook internals to generic hook concepts.
- Add the adapter registry and route all internal commands through `--tool`.
- Migrate existing single-tool `hooks-config.json` to the versioned multi-tool shape.
- Keep old config compatibility during read so existing installs do not break.

### Phase 2: Claude Adapter Parity

- Move current Claude-specific settings merge, uninstall, state, input parsing, and transcript resolution behind the Claude adapter.
- Preserve current CLI output and behavior for `orchid hooks install` when only Claude is available.
- Ensure uninstall removes only Orchid-managed Claude hooks.

### Phase 3: Codex Adapter

- Add Codex hook config install, uninstall, status, and availability detection.
- Parse Codex hook input into `NormalizedHookInput`.
- Sync Codex transcripts on `Stop`.
- Add prompt-mode support through `UserPromptSubmit`.

### Phase 4: Backfill And Stale Sessions

- Extend `orchid sync --discover` to include Codex sessions from `~/.codex/sessions/YYYY/MM/DD/*.jsonl`.
- Mark old active Codex sessions as done when no transcript update has happened for a conservative inactivity window.
- Keep this separate from the initial hook install if needed to keep the first PR small.

## Tests

CLI unit tests:

- Generic config read/write for multi-tool installs.
- Migration from old Claude-only `hooks-config.json`.
- Adapter registry resolves Claude and Codex by tool name.
- Internal handlers reject missing or unsupported `--tool`.
- Claude merge/remove/idempotency tests still pass.
- Codex install writes only Orchid-managed hook entries and preserves unrelated Codex hooks.
- Codex uninstall removes only Orchid-managed hook entries.
- Codex hook input parser reads `session_id`, `cwd`, and `transcript_path`.
- Prompt-mode output returns valid hook-specific JSON.

Integration checks:

```bash
cd cli
pnpm run check
pnpm test
```

Manual validation:

- Run `orchid hooks install codex`.
- Start a normal `codex` session without `orchid codex`.
- Confirm Orchid creates `~/.orchid/hooks/codex/<session-id>.json`.
- Confirm the server receives an active session with `tool = "codex-cli"`.
- Run `orchid hooks uninstall codex`.
- Confirm non-Orchid Codex hooks remain intact.

## Open Questions

- Confirm whether Codex prefers `~/.codex/hooks.json`, `[hooks]` in `config.toml`, or both for user-managed hooks.
- Confirm Codex hook output shape for `UserPromptSubmit` before implementing prompt mode.
- Decide whether v1 should include stale-session done marking or leave all Codex hook sessions active until a follow-up.

## PR Boundaries

The smallest useful implementation PR should include:

- Generic `orchid hooks <tool>` API.
- Claude adapter parity.
- Codex adapter install/status/uninstall.
- Codex `Stop` sync with `status: "active"`.
- Tests for all new adapter behavior.

Backfill, stale-session cleanup, and richer Codex turn parsing can be follow-up PRs if the initial diff gets too large.
