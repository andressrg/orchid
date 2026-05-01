# MVP Plan

## Goal

A working product where a developer using Claude Code can see, in a web UI, the conversation that led to each commit in a PR.

## Non-Goals (for MVP)

- Codex CLI support (Phase 2)
- Cursor/Windsurf support (Phase 3)
- Browser extension (Phase 2)
- Team/org features (Phase 3)
- Self-hosted option (Phase 3)

---

## Phase 1: Local CLI + Git Notes (Week 1-2)

### Week 1: Core CLI

**`orchid init`**

- Detect Claude Code installation
- Install hooks into `~/.claude/settings.json`
- Create local SQLite database
- Detect current git repo, record remote URL

**`orchid capture-commit`** (PostToolUse hook handler)

- Read stdin JSON from Claude Code
- Check if `tool_input.command` matches `git commit`
- Extract commit SHA via `git rev-parse HEAD`
- Read current session's JSONL transcript
- Generate summary (first user prompt + files changed)
- Write git note at `refs/notes/ai-sessions`
- Record `(session_id, commit_sha)` in local SQLite

**`orchid show <commit>`**

- Read git note for the commit
- Find linked session in local SQLite
- Parse JSONL transcript
- Render conversation in terminal (simple formatted output)

**`orchid log`**

- Enhanced `git log` that shows conversation indicators
- `*` next to commits that have linked sessions
- Session summary inline

### Week 2: GitHub Action + Basic Sharing

**GitHub Action: `orchid/pr-conversations`**

- Triggered on `pull_request` events
- Reads git notes from commits in the PR
- Formats as collapsible markdown sections
- Posts as a PR comment:

```markdown
## AI Conversations

### Commit abc1234 - "Add JWT middleware"

<details>
<summary>Claude Code session (23 messages, 12 min)</summary>

**User**: Add JWT authentication middleware with refresh token rotation...
**Claude**: I'll implement this in three steps...
[truncated - click to expand full conversation]

</details>
```

---

## Phase 2: Cloud Sync + Web UI (Week 3-5)

### Week 3: Supabase Backend

- Set up Supabase project (Postgres + Storage + Auth)
- Implement schema (repos, sessions, commits, session_commits)
- GitHub OAuth flow
- **`orchid login`** - authenticate via browser
- **`orchid sync`** - push sessions + transcripts to cloud

### Week 4-5: Web UI

**Core Views:**

1. **Dashboard** (`/`) - List of repos with recent activity
2. **Repo View** (`/:repo`) - Commit timeline with session indicators
3. **Commit View** (`/:repo/commits/:sha`) - THE KEY VIEW:
   - Left panel: code diff (file-by-file)
   - Right panel: conversation that produced this commit
   - Linked scrolling between diff hunks and conversation turns
4. **PR View** (`/:repo/pulls/:number`) - All commits aggregated
5. **Session View** (`/:repo/sessions/:id`) - Full conversation replay

**Simplicity Principles:**

- Default view shows diff + conversation summary
- Click to expand full conversation
- No clutter - just code and conversation
- Dark mode by default (developers)

---

## Phase 3: Polish + Ecosystem (Week 6-8)

- Codex CLI support (filesystem watcher adapter)
- Browser extension for enhanced GitHub PR pages
- Conversation search across all sessions
- Team features (shared repos, access controls)
- Analytics (AI usage per repo, cost tracking)

---

## Tech Stack

```
CLI:        TypeScript + better-sqlite3 + simple-git
Backend:    Supabase (Postgres + Storage + Auth)
Frontend:   Next.js App Router + Tailwind
Diff:       TBD (react-diff-view or git-diff-view)
Deploy:     Vercel
CI:         GitHub Actions
```

## Success Metric

One developer (you) uses Orchid daily for 2 weeks and finds value in reviewing AI conversations alongside diffs.
