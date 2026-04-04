# Orchid — Plan

> Code tells you what. Git tells you when. Orchid tells you **why**.

Orchid captures AI coding conversations and makes them available to anyone who needs context — reviewers, teammates, and agents.

## Problem

When AI writes code, the conversations behind it are invisible. A reviewer sees a PR diff but has no idea _why_ the AI made certain decisions — what the developer asked for, what alternatives were discussed, what tradeoffs were made. The context is lost.

## Core Idea

```
orchid claude
```

This launches Claude Code (or any AI tool) and periodically syncs the conversation transcript to the cloud in near-realtime. The conversations become searchable, browsable, and queryable by humans and agents alike.

## Key Principles

- **Dumb write, smart read**: Capture raw conversation data. All intelligence (linking to commits, surfacing in PRs, answering questions) happens at read time.
- **Multi-repo by default**: A single conversation can span multiple repos and PRs.
- **Periodic sync, not post-hoc**: Conversations stream as they happen, not after the session ends.
- **Zero friction capture**: Just prefix your command with `orchid`.

---

## Current State

### What's built and working

**CLI** (`cli/`)
- `orchid claude` — wraps Claude Code, syncs transcript every 5s
- `orchid data list|show|search|summary` — query stored sessions
- `orchid review <branch>` — conversation-aware code review
- `orchid explain <commit>` — explain why a commit was made
- Config stored in `~/.orchid/config.json`

**Server** (`server/`)
- Express.js + PostgreSQL on a DigitalOcean droplet (`24.144.97.81`)
- REST API: sessions CRUD, full-text search, AI summaries, commit history, decision log, GitHub webhook
- Auto-run migrations on startup
- Managed by pm2

**Web UI** (`web/`)
- Next.js 16 + Tailwind, deployed on **Vercel** (orchidkeep.com)
- Sessions dashboard, conversation viewer, commits tab, chat/ask, AI summaries, decision log, search, team activity

**Infrastructure** (`infra/`)
- Pulumi IaC for DigitalOcean droplet provisioning
- Cloud-init with Node.js 22, pnpm, Docker, Caddy, pm2

**CI/CD**
- GitHub Actions runs type checks on every push
- Web auto-deploys to Vercel on push to main
- Server deploys manually via `scripts/deploy.sh` (rsync + pm2 restart)

### Architecture

```
                    ┌─────────────┐
                    │   Vercel    │
                    │  (Next.js)  │
                    └──────┬──────┘
                           │ HTTPS
                           ▼
┌──────────┐       ┌──────────────┐       ┌──────────┐
│  CLI     │──────▶│   Server     │──────▶│ Postgres │
│ (local)  │ HTTP  │  (Express)   │       │  (local) │
└──────────┘       │  droplet:3000│       └──────────┘
                   └──────────────┘
```

### Tech Stack

```
CLI:        TypeScript (wrapper + file watcher + HTTP sync)
Server:     Node.js + Express + PostgreSQL
Web:        Next.js 16 + Tailwind CSS
AI:         OpenAI GPT-4o-mini (summaries, reviews, decisions)
Infra:      DigitalOcean droplet + Pulumi
CI:         GitHub Actions (type checks on push)
Deploy:     Vercel (web) + rsync/pm2 (server)
Monorepo:   pnpm workspaces
```

---

## What needs to happen next

### Immediate — Infrastructure & quality

1. **HTTPS for the API** — Vercel serves the web app over HTTPS, but the API is plain HTTP. Browsers block mixed content. Caddy is already installed on the droplet — configure it with a domain to get automatic TLS.

2. **Remove hardcoded defaults** — The API URL (`24.144.97.81`) and API key (`orchid-poc-api-key-2024`) are hardcoded as fallbacks in ~10 files across web and CLI. These should come from environment variables only, failing loudly if missing. Set them in Vercel project settings for the web app.

3. **Server deploy from CI** — Currently manual rsync. Add a GitHub Actions workflow that deploys the server on push to main (rsync or Docker).

### Short-term — Product gaps

4. **PR view** — Show all conversations related to a PR, linked via timestamps + git history. This is the core value prop for code review.

5. **Commit view** — Full diff + conversation side-by-side. Currently the commits tab shows metadata but not the actual diff alongside the conversation.

6. **GitHub PR auto-comment** — The webhook endpoint exists but needs to be wired up. When a PR is opened, Orchid posts a comment listing related conversations with links.

7. **`@orchid` PR bot** — Someone asks a question in a PR comment, Orchid reads related conversations and replies with an answer. The killer feature from the original plan.

### Medium-term — Scale & polish

8. **Managed database** — Move PostgreSQL off the droplet to a managed service (DigitalOcean Managed DB or similar). Single point of failure right now.

9. **Real authentication** — The current API key is a shared secret visible in the browser bundle. Add proper user auth if this goes beyond a small team.

10. **Semantic search** — Current search is full-text (Postgres `tsvector`). Add embedding-based search for "find conversations about authentication decisions" even if the word "authentication" isn't used.

11. **Multi-tool support** — `orchid codex`, `orchid cursor`, etc. The wrapper pattern generalizes, but each tool stores transcripts differently.

---

## Repo structure

```
orchid/
├── cli/          — CLI tool (TypeScript)
├── server/       — Express API + migrations
├── web/          — Next.js frontend
├── infra/        — Pulumi IaC
├── scripts/      — Deploy scripts
├── check.sh      — Type check all packages
└── .github/      — CI workflows
```

## Environments

| Component | Production | Dev |
|-----------|-----------|-----|
| Web | orchidkeep.com (Vercel) | `pnpm dev` in web/ |
| Server | 24.144.97.81:3000 (droplet) | `pnpm dev` in server/ |
| Database | PostgreSQL on droplet | Local PostgreSQL |

## Deploy

- **Web**: Auto-deploys to Vercel on push to main
- **Server**: `bash scripts/deploy.sh` (rsync to droplet + pm2 restart)
- **Infra**: `cd infra && pulumi up`
