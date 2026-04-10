# orchid-cli

Code tells you *what*. Git tells you *when*. Orchid tells you **why**.

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

# 3. Wrap your AI tool — conversations sync automatically
orchid claude

# 4. Or bulk-sync past conversations you already had
orchid sync --discover
```

## Commands

### Capture

```bash
orchid claude [args]          # Launch Claude Code, sync conversation in real-time
orchid sync --discover        # Interactive TUI to find and sync past sessions
orchid sync <file.jsonl>      # Sync a single transcript file
```

`orchid claude` is a transparent wrapper — it launches Claude Code with full interactivity and periodically uploads the transcript to your Orchid server. When you're done, a final sync captures everything.

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

1. You run `orchid claude` instead of `claude`
2. Claude Code runs normally — you don't notice anything different
3. In the background, Orchid reads the JSONL transcript file and uploads it every 5 seconds
4. The conversation appears on your Orchid server in near real-time
5. Anyone on your team can read it, search it, or ask questions about it

For past conversations, `orchid sync --discover` reads both `.jsonl` files and Claude Code's `sessions-index.json` to find everything, including sessions whose transcripts have been cleaned up.

## Links

- **Web app**: [orchidkeep.com](https://www.orchidkeep.com)
- **Source**: [github.com/andressrg/orchid](https://github.com/andressrg/orchid)
