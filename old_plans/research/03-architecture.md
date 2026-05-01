# Architecture

## System Overview

```
+------------------+     +------------------+     +------------------+
| Claude Code      |     | Codex CLI        |     | Cursor / Other   |
| (hooks)          |     | (fs watcher)     |     | (adapters)       |
+--------+---------+     +--------+---------+     +--------+---------+
         |                         |                        |
         v                         v                        v
+---------------------------------------------------------------+
|                     orchid CLI daemon                          |
|  - Receives hook events (stdin JSON)                          |
|  - Watches JSONL files for Codex                              |
|  - Reads git state (branch, SHA, remote)                      |
|  - Writes git notes (refs/notes/ai-sessions)                  |
|  - Writes git trailers (Session-Id: <uuid>)                   |
|  - Syncs to cloud backend                                     |
+---------------------------------------------------------------+
         |                    |                    |
         v                    v                    v
+----------------+   +------------------+   +------------------+
| Git Notes      |   | Local SQLite     |   | Supabase Cloud   |
| (in repo,      |   | (index +         |   | - Postgres (meta)|
|  portable)     |   |  cache)          |   | - Storage (JSONL)|
+----------------+   +------------------+   | - Auth (GitHub)  |
                                            +------------------+
                                                     |
                                                     v
                                            +------------------+
                                            | Next.js Web UI   |
                                            | - Diff viewer    |
                                            | - Conversation   |
                                            |   replay         |
                                            | - PR aggregation |
                                            +------------------+
```

## Capture: How Conversations Get Linked to Commits

### Claude Code (Primary)

Three hooks installed in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "orchid capture-commit"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "orchid sync-session"
          }
        ]
      }
    ]
  }
}
```

**`orchid capture-commit`** (PostToolUse handler):

1. Reads stdin JSON from Claude Code hook
2. Checks if `tool_input.command` contains `git commit`
3. If yes: runs `git rev-parse HEAD` to get new SHA
4. Records `(session_id, commit_sha, branch, timestamp)` in local SQLite
5. Attaches summary as git note: `git notes --ref=refs/notes/ai-sessions add`

**`orchid sync-session`** (Stop handler):

1. Reads stdin JSON to get `session_id` and `transcript_path`
2. Copies/indexes the full JSONL transcript
3. Pushes to Supabase in background

### Codex CLI

Filesystem watcher on `~/.codex/sessions/` detects new rollout JSONL files. Periodic reads of `~/.codex/state_5.sqlite` get thread metadata including `git_sha` and `git_branch`.

## Storage: Three Layers

### Layer 1: Git Notes (Portable, In-Repo)

```bash
git notes --ref=refs/notes/ai-sessions add -m '{
  "session_id": "89fb3dac-...",
  "tool": "claude_code",
  "branch": "feature/auth",
  "summary": "Added JWT middleware with refresh token rotation",
  "model": "claude-opus-4-6",
  "timestamp": "2026-03-28T17:17:39Z"
}' abc1234
```

Pushed with: `git push origin 'refs/notes/ai-sessions'`

### Layer 2: Local SQLite (Fast Index)

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  repo_path TEXT,
  branch TEXT,
  started_at TEXT,
  ended_at TEXT,
  transcript_path TEXT,
  synced_at TEXT
);

CREATE TABLE session_commits (
  session_id TEXT REFERENCES sessions(id),
  commit_sha TEXT NOT NULL,
  captured_at TEXT DEFAULT (datetime('now')),
  capture_method TEXT, -- 'hook' | 'heuristic'
  PRIMARY KEY (session_id, commit_sha)
);
```

### Layer 3: Supabase Cloud (Rich Queries, Web UI)

```sql
CREATE TABLE repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  origin_url TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE(user_id, origin_url)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  repo_id UUID REFERENCES repos(id),
  tool TEXT NOT NULL,
  tool_version TEXT,
  branch TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  first_prompt TEXT,
  summary TEXT,
  transcript_storage_key TEXT, -- path in Supabase Storage
  token_count INTEGER,
  cost_estimate_usd NUMERIC(10,4)
);

CREATE TABLE commits (
  sha TEXT NOT NULL,
  repo_id UUID REFERENCES repos(id),
  branch TEXT,
  message TEXT,
  author TEXT,
  committed_at TIMESTAMPTZ,
  PRIMARY KEY (repo_id, sha)
);

CREATE TABLE session_commits (
  session_id TEXT REFERENCES sessions(id),
  repo_id UUID,
  commit_sha TEXT,
  captured_at TIMESTAMPTZ DEFAULT now(),
  capture_method TEXT,
  PRIMARY KEY (session_id, repo_id, commit_sha),
  FOREIGN KEY (repo_id, commit_sha) REFERENCES commits(repo_id, sha)
);
```

Transcripts stored in Supabase Storage: `transcripts/<user_id>/<repo>/<session_id>.jsonl`

## CLI Commands

```bash
orchid init              # Install hooks, create local DB
orchid status            # Show active sessions + recent linked commits
orchid log               # Enhanced git log with conversation indicators
orchid show <commit>     # Display conversation that produced a commit
orchid sessions          # List all sessions with metadata
orchid sync              # Push sessions + mappings to cloud
orchid login             # GitHub OAuth via Supabase
```

## Tech Stack

| Component       | Choice                    | Why                                                 |
| --------------- | ------------------------- | --------------------------------------------------- |
| CLI             | TypeScript (Node.js)      | Same ecosystem as Claude Code; shares JSONL parsers |
| Local DB        | SQLite (better-sqlite3)   | Fast, portable, no server                           |
| Cloud DB        | Supabase (Postgres)       | Auth + DB + Storage in one; free tier               |
| Blob Storage    | Supabase Storage (S3)     | Keeps Postgres lean                                 |
| Web Framework   | Next.js App Router        | Server components, Supabase SSR integration         |
| Diff Rendering  | TBD (see UI research)     |                                                     |
| Auth            | GitHub OAuth via Supabase | Natural for developers                              |
| Deployment      | Vercel                    | Trivial with Next.js + Supabase                     |
| Git Integration | Git notes + trailers      | Non-invasive, portable                              |
