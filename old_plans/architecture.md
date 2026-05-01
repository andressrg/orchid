# Orchid Architecture

## What We're Building

A code review product where reviewers can ask questions about the AI conversations behind any PR. **Dumb write, smart read.**

1. **`orchid` CLI** — captures full conversations from Claude Code / Codex, dumps to cloud
2. **Cloud backend** — stores transcripts + metadata (Supabase) + AI query layer (Claude API)
3. **Web UI** — diff viewer + "Ask about this PR" (Next.js)

## Why This Approach

We evaluated 6 approaches (see `research/02-approaches-compared.md`). The winner: **CLI wrapper with cloud sync + web UI**. Key reasons:

- **Zero manual effort**: Claude Code hooks fire automatically on commits
- **No forking**: We don't maintain an AI CLI — we sit alongside existing tools
- **Data in git + cloud**: Git notes for portability, Supabase for rich queries
- **Existing tools prove the pieces work**: git-memento (notes), SpecStory (capture), clog (rendering)
- **OpenCode plugin**: For OpenCode users specifically, we can ship a plugin via their SDK (`tool.execute.after` hook) with zero forking. OpenCode's snapshot system (per-step diffs in a parallel git repo) and session data model are great architecture references for our capture layer.

## System Diagram

```
WRITE (simple):
  Claude Code hooks ──┐
                      ├──> orchid CLI ──> Supabase Cloud
  Codex fs watcher ───┘                  ├── Storage (full JSONL transcripts)
                                         ├── Postgres (metadata: sessions, commits, PRs)
                                         └── Auth (GitHub OAuth)

READ (smart):
  Reviewer opens PR ──> Next.js Web UI
                        ├── Diff viewer (standard code review)
                        ├── "Ask about this PR" input
                        │     └── Claude API (Sonnet/Opus)
                        │           ├── retrieves relevant transcripts
                        │           ├── answers question with citations
                        │           └── links back to specific messages
                        └── Raw conversation browser (fallback)
```

## Component Details

### 1. orchid CLI (TypeScript + Node.js)

**Commands:**

```
orchid init           Install hooks, create local DB, detect repo
orchid status         Active sessions + recent linked commits
orchid log            Git log with conversation indicators
orchid show <sha>     Conversation for a specific commit
orchid sync           Push to cloud
orchid login          GitHub OAuth
```

**Hooks installed in `~/.claude/settings.json`:**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "orchid capture-commit" }]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "orchid sync-session" }]
      }
    ]
  }
}
```

**`capture-commit` flow:**

1. Read stdin JSON from Claude Code hook
2. Check if `tool_input.command` contains `git commit`
3. If yes → `git rev-parse HEAD` to get SHA
4. Record `(session_id, commit_sha, timestamp)` in local SQLite
5. On session end (`sync-session`), upload full transcript to Supabase Storage

**`sync-session` flow:**

1. Read `session_id` and `transcript_path` from stdin
2. Parse JSONL transcript
3. Upload to Supabase Storage
4. Upsert session + commit mappings in Postgres

### 2. Cloud Backend (Supabase)

**Schema:**

```sql
repos (id, user_id, origin_url, name)
sessions (id, repo_id, tool, branch, started_at, ended_at,
          first_prompt, summary, transcript_storage_key)
commits (sha, repo_id, branch, message, author, committed_at)
session_commits (session_id, repo_id, commit_sha, capture_method)
```

Transcripts in Supabase Storage: `transcripts/<user_id>/<repo>/<session_id>.jsonl`

### 3. Web UI (Next.js + Tailwind)

**Views:**

- **Dashboard** `/` — repos with recent activity
- **Repo** `/:repo` — commit timeline with session indicators
- **PR** `/:repo/pulls/:number` — **THE KEY VIEW** (diff + Ask)
- **Session** `/:repo/sessions/:id` — raw conversation browser (fallback)

**The Key View (PR Review with Ask):**

```
+------------------------------------------------------------------+
| PR #42: Add user authentication                    [Merge] [Close]|
+------------------------------------------------------------------+
| [Diff] [Conversations] [Ask]                                     |
+------------------------------------------------------------------+

[Diff tab] — standard code diff, like GitHub

[Conversations tab] — raw conversation browser
  Session 1 (Claude, 23 messages, 12 min)
  Session 2 (Claude, 15 messages, 8 min)

[Ask tab] — THE KILLER FEATURE
  +--------------------------------------------------------------+
  | Ask anything about how this code was developed...            |
  +--------------------------------------------------------------+

  You: Why was Supabase chosen over PostgreSQL?

  Orchid: In Session 2, the developer initially asked for raw
  PostgreSQL with connection pooling:

    > User (2:15 PM): "Let's use raw PostgreSQL with pg
    > and pgBouncer for connection pooling"

  Claude suggested Supabase instead, citing faster setup:

    > Claude (2:16 PM): "Since you're also adding auth,
    > Supabase would give you both database and auth in
    > one service. It uses PostgreSQL under the hood."

  The developer agreed. No further PostgreSQL discussion.

    [View in Session 2 →]  [Jump to related diff →]
```

**Tech choices:**

- Diff: `diff2html` (MVP) → CodeMirror 6 (V2)
- Markdown: `react-markdown` + `remark-gfm` + `shiki`
- Layout: CSS Grid + `allotment` (resizable panels)
- Virtual scroll: `@tanstack/virtual`
- State: Zustand (scroll sync, panel visibility)

## Phased Delivery

| Phase | Weeks | Deliverable                                     |
| ----- | ----- | ----------------------------------------------- |
| 1     | 1-2   | CLI + git notes + GitHub Action (PR comments)   |
| 2     | 3-5   | Supabase backend + web UI (diff + conversation) |
| 3     | 6-8   | Codex support, browser extension, search, teams |

## Key Technical Risks

| Risk                            | Mitigation                                              |
| ------------------------------- | ------------------------------------------------------- |
| Git notes lost on squash/rebase | Pre-rebase hook to carry notes (git-memento's approach) |
| Secrets in conversations        | Regex scrubbing before cloud sync; per-session opt-out  |
| Claude Code hooks API changes   | Pin version; hooks API has been stable                  |
| Large transcripts (>1MB)        | Summaries in Postgres, full transcripts in blob storage |
