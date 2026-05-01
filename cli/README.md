# orchid

Code tells you _what_. Git tells you _when_. Orchid tells you **why**.

Orchid captures the conversations between developers and AI tools (Claude Code, etc.) and makes them searchable, reviewable, and useful. The context behind every commit, PR, and architectural decision — preserved instead of lost.

## Install

```bash
npm install -g orchid-cli
```

This gives you the `orchid` command.

## Quick start

```bash
# 1. Point to your Orchid server
orchid config

# 2. Authenticate
orchid login

# 3. Install Claude Code hooks — conversations sync automatically
orchid hooks install --mode auto

# 4. Confirm hooks and auth are ready
orchid hooks status

# 5. Or bulk-sync past conversations you already had
orchid sync --discover
```

## Commands

### Capture

```bash
orchid hooks install          # Install hooks with auto-sync
orchid hooks install --mode auto
orchid hooks install --mode prompt
orchid hooks status           # Show hook installation and auth status
orchid hooks uninstall        # Remove Orchid hooks from Claude Code
orchid sync --discover        # Interactive TUI to find and sync past sessions
orchid sync <file.jsonl>      # Sync a single transcript file
orchid claude [args]          # Legacy wrapper for launching Claude Code
```

`orchid hooks install` is the recommended Claude Code integration. It writes Orchid lifecycle hooks into `~/.claude/settings.json` and installs a launcher at `~/.orchid/hooks/orchid-hook`, so you can keep using `claude` normally.

Use `--mode auto` to sync every conversation automatically. Use `--mode prompt` when you want Claude to ask at the start of each conversation before enabling sync. `orchid hooks status` shows whether hooks are installed, which mode is active, whether auth is configured, and whether any sessions are currently syncing.

`orchid claude` is still available as a legacy wrapper. It launches Claude Code with full interactivity and periodically uploads the transcript to your Orchid server. Hooks are preferred because they work with your normal Claude Code launch flow.

`orchid sync --discover` scans `~/.claude/projects/` for all your local sessions (including archived ones), shows them in a vim-style browser, and lets you select which to upload. Supports `j/k` navigation, space to select, `s` to sync.

### Query

```bash
orchid data list              # List all stored sessions
orchid data show <id>         # Full transcript (raw JSONL)
orchid data show <id> --turns # Human-readable conversation
orchid data search "query"    # Search across all conversations
orchid data ask <id>          # Chat with a session (AI-powered)
orchid data summary <id>      # AI-generated session summary
orchid data decisions         # Architectural decisions extracted from conversations
```

### Review

```bash
orchid review <branch>        # Conversation-aware code review
orchid explain <commit-sha>   # Why was this commit made?
```

These find relevant conversations and use AI to explain the reasoning behind code changes. Feed them to your code review workflow or just satisfy your curiosity about that weird refactor from last Tuesday.

## For agents

Orchid is designed to be called by other AI tools. Any agent can shell out to `orchid data` commands to get context:

```bash
# An agent reviewing PR #42 can do:
orchid data search "authentication middleware"
orchid data show <session-id> --turns
orchid explain abc123f
```

No MCP server, no special integration. The CLI is the agent interface.

### Agent skill

This repo includes an agent skill at `skills/orchid-context`. Install it with:

```bash
npx skills add andressrg/orchid
```

The CLI detects your installed agents and installs the skill in the right place. Add `-g` to install it globally. From a checked-out repo, you can also install the local skill:

```bash
npx skills add ./skills/orchid-context
```

Restart your agent if it does not detect the new skill immediately.

## Configuration

```
~/.orchid/config.json    # API URL and auth token (created by orchid config + orchid login)
```

Environment variables override the config file:

```bash
ORCHID_API_URL=https://your-server.com/api
ORCHID_TOKEN=orc_your_token_here
```

## How it works

1. You run `orchid hooks install --mode auto` once
2. Claude Code runs normally
3. Claude Code calls Orchid on `SessionStart`, `Stop`, and `SessionEnd`
4. Orchid reads the JSONL transcript file and syncs active and completed sessions
5. The conversation appears on your Orchid server for search, review, and Q&A

For past conversations, `orchid sync --discover` reads both `.jsonl` files and Claude Code's `sessions-index.json` to find everything, including sessions whose transcripts have been cleaned up.

## Links

- **Web app**: [orchidkeep.com](https://www.orchidkeep.com)
- **Source**: [github.com/andressrg/orchid](https://github.com/andressrg/orchid)
