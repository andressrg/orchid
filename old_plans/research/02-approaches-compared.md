# Approaches Compared

## Option 1: Fork OpenCode

> **CORRECTION**: Previous research was based on the wrong repository (opencode-ai/opencode, a small archived Go project). The correct OpenCode is [anomalyco/opencode](https://github.com/anomalyco/opencode) -- a massively popular, actively developed TypeScript project with 131k+ stars. Everything below replaces the previous analysis.

**What**: Fork [OpenCode](https://github.com/anomalyco/opencode) (TypeScript, MIT, ~220MB monorepo) and add conversation-per-commit tracking.

**Key Finding**: OpenCode is NOT archived -- it is one of the most active open-source AI coding agents, actively maintained by the team behind [terminal.shop](https://terminal.shop) and [SST](https://sst.dev). It positions itself as the open-source alternative to Claude Code, with 131k+ GitHub stars, 14k+ forks, and daily commits. This is a serious, production-grade project with a large community, not an abandoned experiment.

### Architecture

**Language & Runtime**: TypeScript on Bun. Monorepo managed by Turborepo with ~20 packages in `packages/`.

**Core packages**:

- `packages/opencode` - The CLI agent core (business logic, LLM streaming, tools, session management, server)
- `packages/app` - Shared web UI components (SolidJS)
- `packages/desktop` / `packages/desktop-electron` - Native desktop apps (Tauri + Electron)
- `packages/console` - Web console app
- `packages/plugin` - Plugin SDK (`@opencode-ai/plugin`)
- `packages/sdk` - Client SDK (`@opencode-ai/sdk`)
- `packages/web` - Marketing/landing site

**Paradigm**: Heavily functional, built on [Effect](https://effect.website/) (Effect-TS). Services are defined as Effect `ServiceMap.Service` classes with explicit dependency injection via `Layer`. This makes the codebase modular but imposes a steep learning curve for contributors unfamiliar with Effect.

**Client/Server Architecture**: OpenCode runs as a local HTTP server (Hono framework on port 4096). The TUI, desktop app, and web app are all just clients of this server. The server exposes a full REST/WebSocket API with OpenAPI specs. This means the TUI is decoupled from the core logic -- you can drive OpenCode from a mobile app or any HTTP client.

**Storage**: SQLite via Drizzle ORM. Sessions, messages, parts (tool calls, text chunks, reasoning), and todos are all stored relationally. Key tables:

- `session` - Conversation sessions with project/workspace references, titles, share URLs, summary stats (additions/deletions/files)
- `message` - Messages within sessions (user/assistant)
- `part` - Individual parts of messages (text, tool calls, reasoning, step-start/step-finish, patches)
- `todo` - Per-session task lists

**Agent System**: Built-in agents (`build`, `plan`, `general`, `explore`, `compaction`) with configurable permissions, tools, and prompts. Custom agents can be defined via Markdown files in `.opencode/agents/`. Each agent has a permission ruleset controlling which tools it can use.

**LLM Integration**: Uses Vercel's `ai` SDK (v6) with provider adapters for Anthropic, OpenAI, Google, Bedrock, Azure, Groq, Mistral, xAI, Cohere, and many more. Truly provider-agnostic.

### How It Handles Git

OpenCode has **deep, sophisticated git integration** -- far beyond just a bash tool:

1. **Snapshot System** (`packages/opencode/src/snapshot/index.ts`): A parallel git repository (stored in `$XDG_DATA_HOME/opencode/snapshot/<project_id>/`) that tracks file state independently of the user's git repo. Before and after each LLM "step", snapshots are taken via `git write-tree`. This enables:
   - Precise per-step diffs showing what the AI changed
   - Revert capability (restore any snapshot)
   - File-level patch tracking (which files changed in each step)

2. **Worktree Support** (`packages/opencode/src/worktree/index.ts`): Full git worktree management. OpenCode can create isolated worktrees (`opencode/<name>` branches), run tasks in them, reset them to remote HEAD, and clean them up. This is used for parallel task execution.

3. **Session-Level Diff Summaries**: Each session tracks `summary_additions`, `summary_deletions`, `summary_files`, and `summary_diffs` (an array of `FileDiff` objects with before/after content). The `SessionSummary` module computes these after each step.

4. **Step-Level Patches**: The `processor.ts` records `step-start` and `step-finish` parts with snapshot hashes, plus `patch` parts listing which files changed between snapshots. This is essentially conversation-per-change tracking already, just at the step level rather than the commit level.

5. **No Direct Git Commit Tracking**: OpenCode does NOT currently intercept or track `git commit` commands. Git commits happen via the bash tool like any other shell command. There is no mechanism to link a session to a commit SHA.

### How It Tracks Conversations

- Every conversation is a `Session` with a unique `SessionID` (ULID-based, descending for sort order)
- Sessions belong to a `Project` (identified by directory)
- Messages are stored as `MessageV2.Info` records with full metadata (model, provider, cost, tokens, timing)
- Each message contains `Part` records: text, tool calls (with input/output/timing), reasoning blocks, step boundaries, and patches
- Sessions can be forked, shared (via URL), archived, and compacted (context window management)
- The session processor (`processor.ts`) orchestrates the full lifecycle: snapshot before step -> stream LLM -> record parts -> snapshot after step -> compute patches -> summarize

### Plugin/Extension System

OpenCode has a **rich plugin system** that is highly relevant to our use case:

- **Plugin SDK** (`@opencode-ai/plugin`): npm packages that export a `server` function receiving a `PluginInput` (SDK client, project info, directory, server URL, Bun shell)
- **Hook points** include:
  - `event` - React to any event
  - `tool.*` - Before/after tool execution, modify tool definitions
  - `chat.message` - Intercept new messages
  - `chat.params` / `chat.headers` - Modify LLM request parameters
  - `permission.ask` - Override permission decisions
  - `shell.env` - Inject environment variables into bash commands
  - `command.execute.before` - Pre-process slash commands
  - `experimental.chat.messages.transform` / `experimental.chat.system.transform` - Transform messages/system prompts
  - `experimental.session.compacting` - Customize compaction behavior
  - `experimental.text.complete` - Post-process text output
- **Custom agents** via `.opencode/agents/*.md` Markdown files
- **Custom commands** via `.opencode/commands/*.md` Markdown files
- **Skills** - Discoverable capabilities loaded from `SKILL.md` files
- **MCP support** - Full Model Context Protocol integration

### Feasibility of Conversation-Per-Commit Tracking

**As a plugin (no fork required)**: HIGH feasibility. The `tool.execute.after` hook fires after every tool execution, including bash commands. A plugin could:

1. Detect `git commit` in the bash tool args
2. Extract the commit SHA from the output
3. Attach the current `sessionID` as a git note or trailer
4. Sync the session transcript to a backend

This would require **zero modifications to OpenCode itself**. The plugin SDK provides everything needed.

**As a fork**: Also feasible but likely unnecessary. The integration points are:

- `packages/opencode/src/session/processor.ts` (`tool-result` event) - add commit detection after bash tool completion
- `packages/opencode/src/snapshot/index.ts` - already tracks per-step diffs; could be extended to also create git notes
- `packages/opencode/src/session/session.sql.ts` - add a `commit_sha` column to the session or part table

**Difficulty assessment**:

- Plugin approach: 2-3 days to build a working prototype. No fork maintenance burden.
- Fork approach: 1-2 weeks. But maintaining a fork of a 131k-star project with daily commits is a **massive ongoing burden**. Effect-TS codebase is non-trivial to work in.

### Comparison to Claude Code and Codex CLI (Extensibility)

| Dimension            | OpenCode                                                                             | Claude Code                                                                       | Codex CLI                          |
| -------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------- |
| Extension model      | Plugin SDK (npm packages with typed hooks), custom agents/commands via Markdown, MCP | Hooks in settings.json (PreToolUse, PostToolUse, Stop, etc.), slash commands, MCP | Minimal (JSONL output, filesystem) |
| Hook granularity     | 15+ hook points covering tools, chat, permissions, system prompts, events            | 5-6 lifecycle hooks with stdin JSON                                               | None                               |
| Conversation access  | Full SDK client in plugin, direct DB access possible                                 | session_id + transcript_path in hook payload                                      | Raw JSONL files                    |
| Tool interception    | `tool.execute.before` / `tool.execute.after` with full args and output               | `PostToolUse` with tool name and input                                            | N/A                                |
| Custom tools         | Yes, plugins can register custom tools                                               | No custom tools                                                                   | No                                 |
| API/Server           | Full REST + WebSocket API (documented via OpenAPI)                                   | None (CLI only)                                                                   | None                               |
| Provider flexibility | 15+ providers, fully configurable                                                    | Anthropic only                                                                    | OpenAI only                        |
| Self-hostable        | Yes, fully open source                                                               | No (proprietary)                                                                  | Yes (open source)                  |

OpenCode is **significantly more extensible** than both Claude Code and Codex CLI. Its plugin system alone could support our conversation-per-commit feature without any forking.

| Pros                                                      | Cons                                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| Plugin system could support our feature with zero forking | 131k-star project = massive codebase, hard to fork-and-maintain        |
| Already tracks per-step diffs and file changes            | Effect-TS paradigm has steep learning curve                            |
| Client/server architecture + SDK enable external tooling  | Rapidly evolving -- fork would diverge quickly                         |
| MIT license, multi-provider, desktop + web + TUI clients  | Monorepo with ~20 packages, complex build system (Bun + Turbo)         |
| Full conversation history in SQLite with rich metadata    | No existing commit-level tracking (only step-level snapshots)          |
| Existing snapshot/revert system is 80% of what we need    | Huge community means PR expectations are high if contributing upstream |
| Active development means bugs get fixed upstream          | We would be a tiny fork of a massive project                           |

**Verdict**: The verdict changes significantly now that we know the correct project.

Forking is **not recommended** -- not because OpenCode is inadequate, but because it is _too much_. It is a 220MB monorepo with 131k stars, daily commits, Effect-TS throughout, and 20+ packages. Maintaining a fork would be an enormous distraction.

However, OpenCode is **highly relevant** in two other ways:

1. **Plugin approach** (best for OpenCode users): Build an OpenCode plugin that implements conversation-per-commit tracking. This requires zero forking, uses the official plugin SDK, and could be published to npm. This is the right answer for anyone who uses OpenCode as their AI coding agent.

2. **Architecture inspiration**: OpenCode's snapshot system (parallel git repo for tracking per-step diffs) and session data model (sessions -> messages -> parts with tool call metadata) are excellent reference implementations for our own capture + display layer.

**Bottom line**: Don't fork OpenCode. Either build an OpenCode plugin (if targeting OpenCode users) or learn from its architecture (if building our own system). The CLI Wrapper approach (Option 2) remains the best path for a tool-agnostic solution, but our capture layer should borrow ideas from OpenCode's snapshot and session models.

---

## Option 2: CLI Wrapper + Cloud Sync

**What**: Build an `orchid` CLI that uses Claude Code hooks + Codex filesystem watching to capture conversations, links them to commits, syncs to cloud, and serves a web UI.

**Key Insight**: We don't need to wrap or proxy the CLI tools. Claude Code's hooks system provides real-time events with `session_id` and `transcript_path` via stdin JSON. Codex writes structured JSONL we can watch.

**Capture Mechanism**:

- **Claude Code**: 3 hooks in `settings.json`:
  - `PostToolUse` matching `Bash` - detect `git commit`, record `(session_id, commit_sha)`
  - `Stop` - sync full session transcript
  - `SessionEnd` - mark session complete
- **Codex CLI**: Filesystem watcher on `~/.codex/sessions/` + periodic reads of `~/.codex/state_5.sqlite`

**Correlation Methods** (combine all three):

1. Git trailers: `Session-Id: <uuid>` in commit messages
2. Git notes: full/summarized transcript at `refs/notes/ai-sessions`
3. Hook-based: real-time `(session_id, commit_sha)` mapping via PostToolUse

| Pros                                          | Cons                                       |
| --------------------------------------------- | ------------------------------------------ |
| Zero manual effort (hooks fire automatically) | Claude Code hooks API could change         |
| No forking or maintaining an AI CLI           | Need separate integration per tool         |
| Data lives in git (notes) AND cloud           | Git notes not pushed by default            |
| Simplest architecture                         | Privacy: conversations may contain secrets |

**Verdict**: **Best approach.** Lightweight, composable, works with existing tools.

---

## Option 3: Git-Native (Notes + GitHub Action)

**What**: Store conversations as git notes, render via GitHub Action that posts PR comments.

**Fastest to MVP** (1-2 weeks). git-memento already does this.

| Pros                                | Cons                                  |
| ----------------------------------- | ------------------------------------- |
| Data travels with the repo forever  | GitHub doesn't display notes natively |
| Proven at scale (Gerrit uses notes) | Limited to ~1MB per note              |
| git-memento has working GH Action   | PR comments are basic markdown        |
| Lowest barrier to adoption          | No rich interactive UI                |

**Verdict**: Great as Phase 1 / foundation layer. Not sufficient alone for the vision.

---

## Option 4: Browser Extension

**What**: Chrome extension that injects a "Conversations" panel on GitHub PR pages.

| Pros                             | Cons                            |
| -------------------------------- | ------------------------------- |
| Highest UX quality potential     | Chrome-only, adoption barrier   |
| Works with existing GitHub repos | GitHub DOM changes break it     |
| No backend needed for rendering  | Only visible to extension users |

**Verdict**: Good as a Phase 2 enhancement on top of the core product.

---

## Option 5: Forgejo Fork

**What**: Fork Forgejo (Go, MIT) and add a native "Conversations" tab to PRs.

| Pros                           | Cons                             |
| ------------------------------ | -------------------------------- |
| Full control over UI/UX        | Requires switching git hosting   |
| Native git notes reading       | 4-8 week MVP, highest complexity |
| Could become major OSS project | Most teams won't leave GitHub    |

**Verdict**: Long-term vision, not MVP.

---

## Option 6: Companion Web App (Hybrid)

**What**: Standalone web app linked to GitHub via SHAs. Teams keep GitHub, Orchid provides the conversation layer.

| Pros                    | Cons                               |
| ----------------------- | ---------------------------------- |
| Works with any git host | Context-switching between two apps |
| Rich, purpose-built UI  | External service dependency        |
| SaaS business model     | Data not in repo if service dies   |

**Verdict**: This is essentially Option 2 with a web UI. **Our chosen path.**

---

## Recommendation: Layered Approach

### Phase 1 (Weeks 1-2): Git-Native + GitHub Action

- CLI tool that reads Claude Code / Codex JSONL, attaches as git notes
- GitHub Action posts conversation summaries on PRs
- Immediate team visibility, zero client-side install

### Phase 2 (Weeks 3-5): Cloud Sync + Web UI

- Supabase backend for sessions, commits, transcripts
- Next.js web app with diff + conversation views
- Auto-capture via Claude Code hooks

### Phase 3 (Weeks 6-8): Polish + Ecosystem

- Browser extension for enhanced GitHub experience
- Support for Cursor, Windsurf, Copilot
- Conversation search, analytics, team features
