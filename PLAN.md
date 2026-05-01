# Plan v2: Wrapper CLI + Periodic Sync

> **Note**: This is a spec for a **proof of concept**. The goal is to validate the core idea with the simplest possible implementation, not to build a production system. Cut corners where it makes sense — we can harden later.

## Problem

When AI writes code, the conversations behind it are invisible. A reviewer sees a PR diff but has no idea _why_ the AI made certain decisions — what the developer asked for, what alternatives were discussed, what tradeoffs were made. The context is lost.

## Goal

Code tells you what exists. Git tells you when it changed and who changed it. But neither tells you _why_. The conversations between developers and AI tools are the missing piece — they capture the reasoning, the tradeoffs, the decisions. We want to capture those conversations and make them available to anyone — or any agent — that needs them: a teammate reviewing a PR, a new developer trying to understand a module, or an agent picking up where someone left off.

## Key Principles

- **Dumb write, smart read**: The capture path just stores raw conversation data — no processing, no parsing. It's an immutable, append-only log. All intelligence (linking to commits, surfacing in PRs, answering questions) happens at read time.
- **Multi-repo by default**: A single conversation can span multiple repos and PRs. A developer working on a feature might touch backend and frontend in one session. The data model supports this from day one.
- **Periodic sync, not post-hoc**: Conversations stream to the server as they happen, not after the session ends. This makes the data crash-safe and enables live viewing.
- **Zero friction capture**: Just prefix your command with `orchid`. No config, no hooks, no setup.
- **Simplest thing that works**: No clever sync algorithms, no incremental diffs — if re-uploading the whole transcript every 5 seconds works, do that. Optimize later.

## Core Idea

Replace the hooks-based capture approach with a **command wrapper** inspired by [jai](https://jai.scs.stanford.edu/):

```
orchid claude
```

This launches Claude Code (or any AI tool) and periodically syncs the conversation transcript to the cloud in near-realtime.

## How It Works

1. User runs `orchid claude` in a **feature folder** (which may contain multiple repos as subfolders)
2. Orchid launches Claude Code as a child process
3. Orchid identifies the JSONL transcript file for **this specific session** (in `~/.claude/projects/`)
4. A background watcher periodically reads the transcript and pushes it to the Orchid server — the simplest approach that works (even if that means re-uploading the whole sessopm each time)
5. On exit, a final sync ensures everything is captured

### Multi-Repo Sessions

A common workflow: a developer creates a feature folder, clones the server and frontend repos into it, and runs `orchid claude` from the feature folder. That single conversation may produce commits in both repos, across multiple PRs.

```
feature-new-auth/
├── backend/      ← git repo, PR #42
├── frontend/     ← git repo, PR #18
└── notes.md
```

```
orchid claude      ← one session, two repos, two PRs
```

This means:

- **A session can touch multiple repos** — the conversation is the unit, not the repo
- **Links are semantic, not stored** — we don't maintain a mapping between sessions and PRs in the database. The session has timestamps, commits have timestamps, and git knows which commits belong to which PR. The read layer connects the dots at query time.
- **PR views aggregate** — when viewing PR #42 on the backend, the read layer finds conversations that overlap in time with the PR's commits and shows them, including parts that touched other repos

## Use Cases

- **Code review** — Reviewer opens a PR and sees the conversations that produced each commit. Instead of guessing why something was done a certain way, they read the actual discussion.
- **Agent-assisted review** — An agent reviews a PR for you, but instead of only reading the diff, it also reads the conversations behind it. It gives deeper feedback because it understands the intent, not just the code.
- **Picking up someone else's work** — A teammate started a feature, had a long conversation with Claude, then went on vacation. You read the conversation and understand exactly where they were and what decisions they made.
- **Agents continuing work** — An agent needs to finish a feature that another session started. It reads the previous conversations to understand what was tried, what failed, what the user actually wanted.
- **Onboarding** — New developer wants to understand why the auth system works the way it does. They find the conversations from when it was built — the requirements, the alternatives, the tradeoffs.
- **Debugging** — Something is broken and you're staring at weird code. You pull up the conversation that produced it and see the full context.
- **Team visibility** — Engineering lead wants to understand how AI is being used across the team. Which repos, how often, what kinds of tasks.

## Surfaces

### 1. CLI — `orchid data` (agent-friendly interface)

The CLI is not just for capture — it's also the way agents query conversation data. Any agent (Claude Code, Codex, custom scripts) can shell out to `orchid data` commands.

```
orchid data list                          — list stored sessions
orchid data search "why websockets"       — search across all conversations
orchid data show <session_id>             — dump a specific session
```

This means an AI-assisted code review is just:

```
> Review PR #42. Use `orchid data` to check the conversations behind it.
```

Claude Code runs the commands, reads the results, and gives a review that understands _why_ things were done. No MCP server, no special integration — the CLI is the agent interface.

### 2. Web UI — the home base

- See all your conversations and your teammates' conversations
- Browse by repo, by person, by time
- Click into any session and read the full conversation
- Live view when someone is actively working

### 3. GitHub PR comment — passive context

When a PR is opened, Orchid automatically posts a comment listing the related conversations, each linking back to the web UI:

```
🌸 Orchid: 3 AI conversations related to this PR

- Session by @andres (2h 14m, 47 messages) — View conversation
- Session by @julian (35m, 12 messages) — View conversation
- Session by @andres (10m, 6 messages) — View conversation
```

### 4. GitHub PR Q&A — the killer feature

Someone asks a question in a PR comment: "why did we go with WebSockets instead of SSE?"

Orchid detects the question (via `@orchid why WebSockets?`), reads the related conversations, finds the relevant parts, and replies with an answer citing specific messages. The reviewer gets an answer without leaving GitHub, without asking the author.

## Live Session Viewing

Because transcripts sync periodically, we get **live viewing for free**:

- A teammate opens the Orchid web UI and sees your session updating in realtime
- Useful for pair programming, mentoring, or just staying aware of what AI is doing
- No screen sharing needed — the conversation is the artifact

## Server Architecture

A dedicated **Node.js server** with **Postgres**, hosted on a single DigitalOcean droplet (or EC2).

### Dumb Write, Smart Read

The write path does **nothing clever** — it just appends timestamped transcript chunks to the database. No processing, no linking, no parsing. The raw conversation is immutable data.

All intelligence happens at **read time**: linking conversations to commits (via timestamps + git history), correlating with PRs, highlighting relevant sections, answering reviewer questions. This means we can keep building new read-time features without ever changing how data is captured.

## **CRITICAL: Test Everything, Use Everything**

After building any piece of functionality, stop and validate it. Don't move on to the next phase until the current one actually works — not just in theory, but by using it for real.

- **Use it manually**: Run `orchid claude`, have a real conversation, check that the data shows up on the server. Use `orchid data` to query it. Does it feel right? Is anything missing?
- **Automated tests**: Write tests as you go. E2E tests that simulate the full flow — CLI starts a session, syncs data, CLI queries it back. If the tests don't pass, the feature isn't done.
- **Think hard about validation**: For each feature, ask: how do I know this actually works? What could go wrong? What does "broken" look like? Build the test before moving on.
- **E2E testing sessions**: Regularly sit down and use the whole system end-to-end as a real user would. These sessions surface problems that unit tests and manual spot-checks miss.

Building without testing leads to a demo that falls apart on stage. Testing as you go means every phase is solid before the next one starts.

## Phases

### Phase 1: Capture + Store (the core loop)

The minimum to prove the idea works. After this phase, conversations are being captured and stored.

**Server**

- Node.js + Express/Fastify + Postgres
- REST endpoints: create session, push chunks
- No auth for POC — server is open / uses a simple API key
- Deploy on DigitalOcean (single droplet: Node.js + Postgres). You will have root access to this droplet

**CLI: `orchid claude`** (and `orchid codex`, etc.)

- Detect working directory
- Collect metadata: git remotes from the working directory and any subfolders, git user name/email, current branch(es)
- Launch the wrapped tool
- Watch for JSONL transcript file
- Periodic sync to server — each sync is an idempotent put (create or update the session, including metadata + transcript)
- Final sync on exit

### Phase 2: Query + Read (prove the data is useful)

After this phase, any agent can use the stored conversations. This is where value gets validated — a developer can already use Claude Code + `orchid data` to do conversation-aware code reviews.

**CLI: `orchid data`**

- `orchid data list` — list stored sessions, shows who started each one (from git user config), when, how many messages, and status

```
orchid data list
#12  andres   2h ago   "Add auth middleware"   (47 messages, active)
#11  julian   5h ago   "Fix payment flow"      (23 messages, done)
#10  andres   1d ago   "Refactor DB layer"     (89 messages, done)
```

- `orchid data show <session_id>` — dump a full conversation (raw JSONL by default)
- `orchid data search "why websockets"` — search across all conversations

**Output formatting (nice to have):**

- `orchid data show 12` — full raw output (default, best for agents to process)
- `orchid data show 12 --summary` — just user prompts + one-line summary of each AI response
- `orchid data show 12 --turns` — human-readable, turn by turn, trimmed

Raw output is the priority. Agents like Claude and Codex can handle raw data fine — they can dump it to files and search through it. Formatting helpers are polish for human use.

**Example workflow — agent-assisted review with just Phase 1 + 2:**

```
# Teammate works on a feature, conversation is captured
orchid claude

# Later, you're reviewing their PR
claude

> Review PR #42. Run `orchid data search` to find conversations
> related to the changes. Use that context to explain why decisions
> were made and flag anything that looks off.
```

No web UI, no GitHub integration — just two CLIs and a server. Already more useful than any code review tool today.

### Phase 3: Smart CLI (make the data useful without a UI)

Use the OpenAI API (via Codex SDK or CLI) to add intelligence on top of the raw conversation data. The CLI becomes a smart assistant, not just a data dump.

Some examples of what this could look like — but the goal is to think about what would be genuinely useful and delightful for a developer using this day to day:

- `orchid data search "authentication decisions"` — semantic search, not just text matching. Finds conversations about JWT, OAuth, session tokens even if those exact words aren't in your query
- `orchid data summary <session_id>` — summarize a long conversation: what was the goal, what decisions were made, what was built
- `orchid data summary --last-week` — summarize all AI activity across the team for the past week
- `orchid data related <pr-url>` — find conversations related to a PR and explain the connection
- `orchid data explain <commit-sha>` — look at the diff, find relevant conversations, explain why the changes were made
- `orchid review <pr-url>` — pull the PR diff, find related conversations, generate a review that understands the intent behind the code

These are starting points. With an LLM and the full conversation history, there's a lot of room to explore what else would be valuable. What questions do developers actually ask during review? What context do they wish they had? What would make them trust AI-generated code more?

Powered by OpenAI API / Codex SDK — configured via `OPENAI_API_KEY` or similar. The raw `orchid data` commands from Phase 2 still work without an API key.

### Phase 4: Web UI (make it visual)

**Core Views:**

1. **Session list** — all conversations, browsable by time / person ✅
2. **Session viewer** — full conversation replay ✅

- Live-updating if session is still active (polling to start, WebSocket later) ✅
- Tabbed interface: Conversation / Commits / Ask ✅

3. **Commits tab** — shows git commits from GitHub that happened during the session, with diff stats, file changes, and links to GitHub ✅
4. **Chat tab (Ask)** — ask questions about a session's conversation, AI reasons through the transcript with multi-turn history ✅
5. **Decision Log** — AI-extracted architectural decisions linked to exact conversation turns ✅
6. **PR view** — all conversations related to a PR (linked via timestamps + git history)
7. **Commit view** — full diff + conversation side-by-side

### Phase 5: GitHub Integration (connect to the workflow)

- Auto-post a PR comment listing related conversations with links to web UI
- `@orchid` bot: ask a question on a PR, get an answer sourced from the conversations
- Team features (shared repos, access controls)

### Phase 5.5: Decision Log (ADR Surface)

Every repo has a set of architectural decisions buried in AI conversations — "why Postgres over MongoDB", "why WebSockets instead of SSE", "why we rewrote the auth layer". These are invisible today.

**The feature:** Orchid scans all sessions for a repo and generates an **AI-powered Decision Log** — a structured list of key architectural decisions, each linked back to the exact moment in the conversation where it was decided.

**How it works:**

1. `GET /repos/:repo/decisions` — server sends all transcripts for the repo to the LLM with a prompt: *"Extract every architectural decision made in these conversations. For each decision: title, the chosen option, alternatives that were rejected, and the reason. Return the turn index where the decision was made."*

2. Each decision stores a `session_id` + `turn_index` so we can link directly to it.

3. **Web UI — Decision Log page** (`/repos/:repo/decisions`):
   - List of ADR-style cards: `✅ Chose Postgres over MongoDB — "Supabase gives us auth + DB in one service"`
   - Each card has a **"See the moment →"** link that opens the session viewer scrolled to that exact turn
   - Session viewer supports deep-linking via `?turn=42` — scrolls to and highlights that message

4. **CLI:** `orchid decisions [repo]` — prints the decision log to stdout, with links to the web UI for each item.

**Deep-link format:** `/sessions/:id?turn=42` — the session viewer highlights turn 42 and scrolls it into view on load.

**Why this is valuable:** A new developer (or agent) joining a repo can read the Decision Log and understand *why* the codebase is the way it is — in 2 minutes instead of 2 hours of archaeology.

### Phase 6: Polish

- Browser extension to embed conversation context in GitHub PR pages
- Analytics (AI usage, session duration, cost estimates)
- `orchid sync <session>` — manually push a past session (fallback for "I forgot to use orchid")

## Tech Stack

```
CLI:        TypeScript (wrapper + file watcher + HTTP sync client)
Server:     Node.js + Express or Fastify
Database:   Postgres
Realtime:   Polling for POC (WebSockets later)
Frontend:   Next.js App Router + Tailwind
Hosting:    Single DigitalOcean droplet (everything on one box)
```

**POC deployment**: Everything runs on a single droplet with root access — Node.js server, Postgres, frontend, all on the same box. Nginx as a reverse proxy if needed, open whatever ports are necessary. Keep it simple — no containers, no separate services, no CI/CD. SSH in, deploy, done.

---

## **Reminder: Test and use everything as you build it.**

This cannot be overstated. Every feature you build, you use immediately. Every command you add to the CLI, you run it yourself. Every endpoint on the server, you hit it. If something feels off, fix it before moving on. The goal is a product that works, not a codebase that compiles. The only way to know it works is to use it — constantly, critically, as a real user would.

## Notes

- Use the agent-browser skill to test your app. Always use the headed browser mode.
- Push every change. Create prs and merge them as you go
- Remember to always deploy to digital ocean as well
- Use the production ui frequently to check its quality
- If you finished everything -> reason again on the main goal and the phases and either add more functionality, add more testing, improve UX ui, make it cleaner, make it smarter
- For design of interfaces I like linear
- For design of the cli -> I like the tui of claude code
- Remember to commit everything, except the secrets file (it’s already in GitHub ignore)
