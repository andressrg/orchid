---
name: orchid-context
description: Query AI coding conversation history captured by Orchid. Use when the user wants to understand why code was written, review a PR with conversation context, explain a commit, search past AI sessions, list recent coding sessions, view architectural decisions, ask questions about a session, set up Orchid capture, or install and verify Orchid Claude Code hooks.
---

# Orchid Context

Use the `orchid` CLI to capture, search, review, and explain AI coding sessions. Prefer the narrowest command that answers the user's question, and cite session IDs or commit SHAs when returning context.

## Setup And Capture

Current Claude Code capture uses hooks:

```bash
orchid config
orchid login
orchid hooks install --mode auto
orchid hooks status
```

Use `auto` to sync every conversation automatically. Use `prompt` when the user wants Claude to ask at the start of each conversation:

```bash
orchid hooks install --mode prompt
```

Maintenance commands:

```bash
orchid hooks status
orchid hooks uninstall
orchid hooks --help
```

Treat `orchid claude` as a legacy/manual wrapper, not the primary setup recommendation.

## Query Commands

List recent sessions:

```bash
orchid data list
```

Show a session:

```bash
orchid data show <session-id>
orchid data show <session-id> --turns
orchid data show <session-id> --summary
```

Search conversations:

```bash
orchid data search "<query>"
```

Ask about one session:

```bash
orchid data ask <session-id> "why did we choose this approach?"
orchid data ask <session-id>
```

Summarize or extract decisions:

```bash
orchid data summary <session-id>
orchid data decisions
orchid data decisions <repo-name>
```

Review or explain code changes:

```bash
orchid review <branch-or-topic>
orchid review <branch-or-topic> --no-ai
orchid explain <commit-sha>
orchid explain HEAD~1
```

Backfill local Claude Code history:

```bash
orchid sync --discover
orchid sync <file.jsonl>
```

## Workflows

When the user asks why code exists or how a decision was made:

1. Search with terms from the code, branch, file path, or feature name.
2. Read the most relevant session with `orchid data show <session-id> --turns`.
3. Use `orchid data ask <session-id> "<question>"` when a direct answer is faster than reading the full transcript.

When reviewing a PR:

1. Run `orchid review <branch-name>` first.
2. Open specific sessions only if the review needs deeper evidence.
3. Combine conversation context with the actual code diff before giving findings.

When continuing previous work:

1. Run `orchid data list` to find recent sessions.
2. Read the likely session with `--turns`.
3. Ask the session what remains unfinished if the handoff is unclear.

## Output Guidance

- Session IDs are UUIDs; partial IDs usually work when unambiguous.
- Prefer `--turns` for human-readable evidence and raw `orchid data show` for machine processing.
- Keep summaries tied to concrete sessions, commits, branches, or search terms.
- If Orchid auth or hooks are not configured, guide the user through `orchid config`, `orchid login`, `orchid hooks install --mode auto`, and `orchid hooks status`.
