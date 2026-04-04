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

**Infrastructure** (`infra/` — legacy DigitalOcean, being replaced by `infra-v2/`)
- Pulumi IaC for DigitalOcean droplet provisioning
- Cloud-init with Node.js 22, pnpm, Docker, Caddy, pm2

**CI/CD**
- GitHub Actions runs type checks on every push
- Web auto-deploys to Vercel on push to main
- Server deploys manually via `scripts/deploy.sh` (rsync + pm2 restart)

---

## Target Architecture

### Infrastructure

```
                         ┌─────────────┐
                         │   Vercel    │
                         │  (Next.js)  │
                         └──────┬──────┘
                                │ HTTPS
                                ▼
┌──────────┐       ┌──────────────────┐
│  CLI     │──────▶│   Cloudflare     │
│ (local)  │ HTTPS │   (proxy + TLS)  │
└──────────┘       └────────┬─────────┘
                            │ IPv6
                            ▼
                   ┌──────────────────┐       ┌──────────────┐
                   │  Hetzner VPS     │       │     S3       │
                   │  ┌────────────┐  │       │  (backups)   │
                   │  │  Kamal     │  │       └──────────────┘
                   │  │  Proxy     │  │              ▲
                   │  └─────┬──────┘  │              │
                   │        │         │              │
                   │  ┌─────▼──────┐  │       WAL-G  │
                   │  │  Express   │  │       stream  │
                   │  │  (app)     │  │              │
                   │  └─────┬──────┘  │              │
                   │        │         │              │
                   │  ┌─────▼──────┐  │              │
                   │  │ PostgreSQL ├──┼──────────────┘
                   │  │ + WAL-G    │  │
                   │  └────────────┘  │
                   └──────────────────┘
```

### Tech Stack

```
CLI:        TypeScript (wrapper + file watcher + HTTP sync)
Server:     Node.js + Express + PostgreSQL
Web:        Next.js 16 + Tailwind CSS
AI:         OpenAI GPT-4o-mini (summaries, reviews, decisions)
Infra:      Pulumi (Hetzner Cloud, S3 state backend)
Deploy:     Kamal v2 (zero-downtime Docker deploys)
Proxy:      Cloudflare (IPv4 gateway, TLS, DDoS protection)
DB Backup:  WAL-G → S3 (continuous WAL archiving + daily base backups)
CI:         GitHub Actions (type checks on push)
Web Host:   Vercel (auto-deploy on push to main)
Monorepo:   pnpm workspaces
```

### Environments

| Component | Production | Dev | Local |
|-----------|-----------|-----|-------|
| Web | orchidkeep.com (Vercel) | Vercel preview deploys | `pnpm dev` in web/ |
| Server | api.orchidkeep.com → Hetzner prod | api-dev.orchidkeep.com → Hetzner dev | `pnpm dev` in server/ |
| Database | PostgreSQL container (prod) | PostgreSQL container (dev) | Local PostgreSQL |
| Backups | WAL-G → S3 (daily base + continuous WAL) | WAL-G → S3 (daily) | None |

---

## Infrastructure Details

### Provisioning — Pulumi (`infra-v2/`)

Two Pulumi stacks (`dev`, `prod`) provision Hetzner Cloud servers:

- **Server type**: `cx22` (2 vCPU, 4 GB RAM, 40 GB NVMe) — ~€3.99/month EU
- **Region**: `nbg1` (Nuremberg) — cheapest
- **IPv6-only**: No IPv4 charge. Cloudflare proxy provides IPv4 access.
- **Firewall**: SSH (22), HTTP (80), HTTPS (443), ICMP. No direct API port exposure.
- **State backend**: AWS S3 bucket (`orchid-pulumi-state`)
- **Secrets**: Encrypted with shared passphrase via `PULUMI_CONFIG_PASSPHRASE` (stored in 1Password, loaded via `direnv`)

```bash
cd infra-v2
pulumi stack select dev && pulumi up     # provision dev server
pulumi stack select prod && pulumi up    # provision prod server
```

### Deployment — Kamal v2

Kamal handles Docker-based deploys to the Hetzner servers:

- **Zero-downtime deploys** via kamal-proxy (blue-green)
- **Secrets management** via `kamal secrets` (1Password integration)
- **PostgreSQL** runs as a Kamal accessory (Docker container, data on named volume)
- **WAL-G backup** runs as a second accessory (continuous WAL archiving + daily base backups to S3)

```bash
kamal deploy                           # deploy app (zero-downtime)
kamal accessory reboot postgres        # reboot database (brief downtime)
kamal app exec 'node dist/migrate.js'  # run migrations
```

### Network — Cloudflare

Cloudflare sits in front of both environments:

- `api.orchidkeep.com` → AAAA record → Hetzner prod IPv6 (proxy enabled)
- `api-dev.orchidkeep.com` → AAAA record → Hetzner dev IPv6 (proxy enabled)
- Provides: IPv4 access, automatic HTTPS/TLS, DDoS protection
- SSL mode: Full (Strict) with Cloudflare origin certificates on server
- Ports 80/443 on firewall restricted to Cloudflare IP ranges only

### Database Backups — WAL-G

PostgreSQL container includes WAL-G for continuous backup to S3:

- **WAL archiving**: Every WAL segment streams to S3 as it's written (~5 min intervals)
- **Base backups**: Daily via cron
- **Point-in-time recovery**: Restore to any second
- **Storage**: S3 bucket (`orchid-db-backups`)
- **Retention**: 30 days

```bash
# Restore to a specific point in time
wal-g backup-fetch /data LATEST
# Set recovery_target_time = '2026-04-04 14:30:00'
# Start postgres — replays WALs to that timestamp
```

### Secrets Management

| Secret | Where it lives | Who needs it |
|--------|---------------|-------------|
| Hetzner API token | Pulumi config (encrypted) | Infra deploys |
| DB password | Kamal secrets (1Password) | Server + Postgres containers |
| API key | Kamal secrets (1Password) | Server container + Vercel env |
| OpenAI API key | Kamal secrets (1Password) | Server container |
| AWS credentials (backups) | Kamal secrets (1Password) | WAL-G container |
| Pulumi passphrase | 1Password → direnv | Infra deploys |
| Vercel env vars | Vercel project settings | Web app build |

No secrets in cloud-init, no hardcoded defaults, no `.secrets` files.

---

## What needs to happen next

### Phase 1 — Infrastructure migration (in progress)

1. **Finish Pulumi Hetzner setup** — Fix security issues from assessment (remove cloud-init secrets, restrict firewall to Cloudflare IPs, add non-root user, configure Caddy)
2. **Set up Kamal** — Dockerize the Express server, configure `deploy.yml` with Postgres + WAL-G accessories
3. **Set up Cloudflare** — DNS records, proxy, origin certificates
4. **Deploy dev environment** — Validate the full stack works
5. **Migrate prod** — Move from DigitalOcean to Hetzner, update Vercel env vars
6. **Decommission old infra** — Remove DigitalOcean droplet, archive `infra/`

### Phase 2 — Cleanup & hardening

7. **Remove hardcoded defaults** — API URL and key should come from env vars only, fail loudly if missing
8. **Server deploy from CI** — GitHub Actions triggers `kamal deploy` on push to main
9. **Test database restore** — Full WAL-G restore drill to validate backups work

### Phase 3 — Product gaps

10. **PR view** — Show all conversations related to a PR, linked via timestamps + git history
11. **Commit view** — Full diff + conversation side-by-side
12. **GitHub PR auto-comment** — Post related conversations when a PR is opened
13. **`@orchid` PR bot** — Answer questions in PR comments using conversation context

### Phase 4 — Scale & polish

14. **Real authentication** — Replace shared API key with proper user auth
15. **Semantic search** — Embedding-based search alongside full-text
16. **Multi-tool support** — `orchid codex`, `orchid cursor`, etc.

---

## Repo structure

```
orchid/
├── cli/          — CLI tool (TypeScript)
├── server/       — Express API + migrations
├── web/          — Next.js frontend
├── infra/        — Legacy Pulumi IaC (DigitalOcean)
├── infra-v2/     — New Pulumi IaC (Hetzner)
├── scripts/      — Deploy scripts
├── check.sh      — Type check all packages
└── .github/      — CI workflows
```

## Deploy cheat sheet

```bash
# Provision infrastructure
cd infra-v2 && pulumi stack select dev && pulumi up

# Deploy application
kamal deploy

# Run migrations
kamal app exec 'node dist/migrate.js'

# Check logs
kamal app logs

# Database backup (manual)
kamal accessory exec postgres 'wal-g backup-push /var/lib/postgresql/data'

# Database restore (PITR)
kamal accessory exec postgres 'wal-g backup-fetch /data LATEST'
```
