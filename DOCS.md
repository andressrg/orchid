# Orchid CLI Documentation

Orchid captures AI coding conversations and makes them queryable. Wrap your AI tool with `orchid`, and every conversation is stored, searchable, and available for code review.

## Installation

```bash
cd cli
npm install
npm run build
npm link        # makes `orchid` available globally
```

## Configuration

Set these environment variables before using the CLI:

| Variable | Required | Description |
|----------|----------|-------------|
| `ORCHID_API_URL` | Yes | API endpoint (e.g. `https://www.orchidkeep.com/api`) |
| `ORCHID_TOKEN` | Yes | Personal access token from the web app |
| `ORCHID_WEB_URL` | No | Web UI URL used when printing session links |
| `OPENAI_API_KEY` | No | Enables local AI-powered review and explain commands |

## Commands

### `orchid claude` — Capture a session

Launches Claude Code and syncs the conversation to the Orchid server in real-time.

```bash
orchid claude
```

Any extra arguments are forwarded to Claude Code:

```bash
orchid claude --model opus
```

**What happens under the hood:**

1. Collects git metadata (user, branch, remotes, working directory)
2. Spawns `claude` as a child process
3. Detects the JSONL transcript file in `~/.claude/projects/`
4. Syncs the transcript to the server every 5 seconds
5. Performs a final sync on exit and marks the session as `done`

All Orchid output goes to stderr so it doesn't interfere with Claude's UI.

---

### `orchid data list` — List sessions

Shows all stored sessions in a table.

```bash
orchid data list
```

```
ID              USER              DIR                   TIME        MESSAGES      STATUS
────────────────────────────────────────────────────────────────────────────────────────────────
a1b2c3d4e5f6    andres            orchid-hackaton       5m ago      47            active
f6e5d4c3b2a1    julian            payment-service       2h ago      23            done
```

---

### `orchid data show <session-id>` — View a session

Display a session's content. Accepts a full or partial session ID.

**Raw output** (default — best for piping to agents):

```bash
orchid data show a1b2c3d4e5f6
```

**Formatted turns** — human-readable conversation:

```bash
orchid data show a1b2c3d4e5f6 --turns
```

```
[user]
Add authentication middleware to the API

[assistant]
I'll add JWT-based auth middleware. Let me start by...
```

**Summary** — metadata + first/last messages:

```bash
orchid data show a1b2c3d4e5f6 --summary
```

```
Session: a1b2c3d4e5f6
User: andres andres@example.com
Branch: feature/auth
Dir: /home/andres/project
Status: done
Started: 2026-03-28T10:00:00Z
Updated: 2026-03-28T12:14:00Z

--- First user message ---
Add authentication middleware to the API

--- Last assistant message ---
All done. The JWT middleware is in place and all routes are protected.
```

---

### `orchid data search <query>` — Search conversations

Full-text search across all stored sessions.

```bash
orchid data search "websocket"
```

```
a1b2c3d4e5f6  andres              5m ago
  ...decided to use WebSocket instead of SSE because...

f6e5d4c3b2a1  julian              2h ago
  ...the WebSocket connection drops when the client...
```

---

### `orchid data summary <session-id>` — AI summary

Generate an AI-powered summary of a session. Requires `OPENAI_API_KEY` on the server.

```bash
orchid data summary a1b2c3d4e5f6
```

```
🌸 Generating AI summary...

This session focused on adding JWT authentication middleware to the API.
Key decisions: chose RS256 over HS256 for token signing, added
refresh token rotation, and implemented role-based access control on three
protected routes.
```

---

### `orchid data sessions-for <sha1>,<sha2>,<sha3>` — Find sessions for commits

Given one or more commit SHAs (comma-separated), find the AI sessions that produced them. This is the key command for PR review — an agent can resolve every commit in a PR to its originating conversation in a single call.

```bash
# Single commit
orchid data sessions-for abc123f

# Multiple commits (comma-separated)
orchid data sessions-for abc123f,def456a,789bcd0

# Typical PR review workflow — pipe all PR commits at once
orchid data sessions-for $(git log main..HEAD --format="%H" | paste -sd,)
```

**Output:**

```
🌸 3 sessions for 5 commits

9764166e-11ea-4fa9-8f9e-4a4b0d55c25a
  User: andres
  Branch: feat/sync-discover
  Status: done | Started: 3d ago
  Commit: f289a29 Add orchid sync --discover
  Commit: 955dce7 Refactor sync.ts to functional style
  https://www.orchidkeep.com/sessions/9764166e-11ea-4fa9-8f9e-4a4b0d55c25a

3df7f610-78c1-4c05-8307-80459c40b992
  User: andres
  Branch: feat/cli-hooks
  Status: done | Started: 1d ago
  Commit: cf14a7a Add hooks command
  https://www.orchidkeep.com/sessions/3df7f610-78c1-4c05-8307-80459c40b992
```

Sessions are deduplicated — if multiple commits came from the same session, the session appears once with all matched commits listed.

---

### `orchid review <branch-or-topic>` — Conversation-aware code review

Finds conversations related to a branch or topic and summarizes them for code review context.

```bash
orchid review feature/auth
orchid review "payment bug fix"
```

Use `--no-ai` to skip the AI summary and just see raw excerpts:

```bash
orchid review feature/auth --no-ai
```

**Output:**

```
🌸 Orchid Review
Searching for conversations related to: feature/auth

Found 2 related conversation(s)

━━━ Session: a1b2c3d4e5f6 ━━━
  By: andres | Branch: feature/auth | 24 user + 23 AI messages
  Status: done | Started: 2026-03-28
  Web: https://www.orchidkeep.com/sessions/a1b2c3d4e5f6

  Key points from the conversation:
  Developer: Add JWT auth middleware...
  Claude: I'll implement RS256 signing with refresh token rotation...

🤖 AI Review Summary
  Built JWT auth middleware with RS256 signing. Key tradeoff: chose
  refresh token rotation over long-lived tokens for security. Watch
  for: token revocation not yet implemented.

━━━ End of Orchid Review ━━━
```

---

### `orchid explain <commit-sha>` — Explain a commit

Finds conversations that happened around the time of a commit and explains the motivation behind the changes.

```bash
orchid explain abc123f
orchid explain HEAD~1
```

**Output:**

```
🌸 Orchid Explain
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Commit: abc123f0 — Add refresh token rotation
Author: andres | Date: 2026-03-28T11:30:00Z | Branch: feature/auth
 3 files changed, 142 insertions(+), 12 deletions(-)

Searching for related conversations...
Found 1 related conversation(s)

  Session: a1b2c3d4e5f6
  By andres on feature/auth

  Developer: Should we use long-lived tokens or refresh rotation?
  Claude: Refresh rotation is more secure because...

🤖 AI Explanation
  This commit adds refresh token rotation, chosen over long-lived tokens
  after discussing the security implications. The conversation shows the
  developer explicitly opted for the more secure approach despite added
  complexity.

━━━ End of Orchid Explain ━━━
```

---

## Typical Workflows

### Capture a coding session

```bash
orchid claude
# ... work normally in Claude Code ...
# conversation is synced automatically
```

### Review a teammate's PR with full context

```bash
orchid review feature/new-auth
# or ask Claude to do it:
# > Review PR #42. Run `orchid review feature/new-auth` for context.
```

### Understand unfamiliar code

```bash
orchid explain abc123f
# or search for the topic:
orchid data search "why we chose websockets"
```

### Review a PR with full conversation context (agent workflow)

```bash
# An agent reviewing a PR can resolve all commits to sessions in one call:
orchid data sessions-for $(git log main..HEAD --format="%H" | paste -sd,)

# Then read the relevant sessions:
orchid data show <session-id> --turns
```

### Let an agent use conversation history

```bash
claude
> Run `orchid data search "auth middleware"` to find past conversations
> about how auth was implemented, then use that context to continue
> the work on the rate limiting feature.
```

### Browse sessions in the web UI

Visit the web UI at the server URL to browse, search, and read sessions visually with live-updating active sessions.

---

## Flags Reference

| Command | Flag | Description |
|---------|------|-------------|
| `orchid` | `--help`, `-h` | Show help |
| `orchid` | `--version`, `-v` | Show version |
| `orchid data show` | `--turns` | Format as conversation turns |
| `orchid data show` | `--summary` | Show metadata + first/last messages |
| `orchid review` | `--no-ai` | Skip AI summary, show excerpts only |
