# Orchid

**Code tells you what. Git tells you when. Orchid tells you why.**

Orchid captures AI coding conversations and makes them available to anyone who needs context — reviewers, teammates, and agents. When AI writes code, the conversations behind it are invisible. Orchid changes that.

## Live Demo

- **Web UI**: [orchid-web.vercel.app](https://orchid-web.vercel.app)

![Sessions Dashboard](web/public/screenshot-sessions.png)

## How It Works

1. **Capture**: Run `orchid claude` instead of `claude`. The conversation syncs to the cloud in real-time.
2. **Store**: Conversations are stored with git metadata — branches, remotes, users.
3. **Review**: See the full conversation behind any code change. Search, browse, or let AI summarize.

## Features

### CLI

```bash
orchid claude                          # Launch Claude + capture conversation
orchid data list                       # List all sessions
orchid data show <id> [--turns]        # View full transcript
orchid data search "why websockets"    # Search across all conversations
orchid data summary <id>               # AI-generated session summary
orchid data decisions [repo]           # AI-extracted architectural decision log
orchid data ask <id> [question]        # Ask questions about a session (interactive if no question)
orchid review <branch>                 # AI-powered conversation-aware review
orchid explain <commit-sha>            # Explain why a commit was made
```

### Web UI

![Conversation Viewer](web/public/screenshot-conversation.png)

- **Sessions Dashboard** — See all conversations, live status, team stats
- **Session Viewer** — Full conversation replay with timeline, markdown rendering
- **Commits Tab** — See git commits that happened during the session, with diff stats and file changes
- **Chat (Ask)** — Ask questions about a session's conversation, AI reasons through the transcript
- **AI Summary** — Click-to-generate AI summaries of any conversation
- **Decision Log** — AI-extracted architectural decisions across sessions, linked to exact conversation turns
- **Search** — Full-text search across all conversations
- **Team Activity** — Per-user session cards, active indicators

### API

- Create/update/delete sessions
- Full-text search
- AI-powered summaries (OpenAI)
- Session chat Q&A (`POST /sessions/:id/chat`)
- Commit history per session (`GET /sessions/:id/commits`)
- Decision log extraction (`GET /decisions`)
- GitHub PR webhook (auto-comment with related conversations)

## Tech Stack

```
CLI:        TypeScript (wrapper + file watcher + HTTP sync), published as orchid-cli on npm
API:        Hono routes inside the Next.js app
Frontend:   Next.js 16 + Tailwind CSS
Database:   PostgreSQL on Neon (serverless)
Auth:       Better Auth (cookie sessions + personal access tokens)
ORM:        Drizzle ORM
Billing:    Stripe Checkout + Customer Portal through Better Auth
AI:         OpenAI GPT-5.4-nano for summaries and reviews
Hosting:    Vercel (web + API) + Neon (database)
```

## Quick Start

```bash
# Install CLI from npm
npm install -g orchid-cli

# Login to your Orchid account
orchid login

# Start coding with conversation capture
orchid claude
```

## Infrastructure

| Service       | Provider | Details                                               |
| ------------- | -------- | ----------------------------------------------------- |
| **Web + API** | Vercel   | Next.js app with API routes, auto-deploys from `main` |
| **Database**  | Neon     | Serverless PostgreSQL                                 |
| **CLI**       | npm      | Published as `orchid-cli`                             |

## Deploying

### Web + API (Vercel)

Deploys are automatic — push to `main` and Vercel builds and deploys. Preview deployments are created for every PR.

### Database migrations

```bash
cd web
pnpm db:generate   # Generate migration from schema changes
pnpm db:migrate    # Apply migrations to Neon
```

### Stripe billing

Billing is configured in the Next.js app through the Better Auth Stripe plugin. Teams are the billing entity.

Required production env vars:

```bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_TEAM_PRICE_ID=price_...
NEXT_PUBLIC_URL=https://orchidkeep.com
```

Optional env vars:

```bash
STRIPE_TEAM_ANNUAL_PRICE_ID=price_...
STRIPE_TEAM_LOOKUP_KEY=orchid_team_monthly
STRIPE_TEAM_ANNUAL_LOOKUP_KEY=orchid_team_annual
STRIPE_TEAM_SEAT_PRICE_ID=price_...
STRIPE_BILLING_ENFORCEMENT=true
```

Stripe webhook URL:

```text
https://<app-domain>/api/auth/stripe/webhook
```

Subscribe the webhook to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`.

### CLI releases

See [RELEASING.md](RELEASING.md) for the full CLI release process. In short:

```bash
cd cli
npm version patch   # bumps version, creates git tag
git push && git push --tags   # CI publishes to npm
```

## Development

```bash
# Install dependencies (pnpm workspace)
pnpm install

# Start local postgres (run in foreground to monitor logs)
docker compose up

# Set database URL
export DATABASE_URL="postgresql://orchid:orchid@localhost:5432/orchid"

# Run migrations
cd web && pnpm db:migrate

# Run the web app
cd web && pnpm dev

# Install CLI locally (for dev, instead of npm)
cd cli && pnpm install && pnpm build && npm link

# Run tests
cd web && pnpm test           # Unit tests
cd cli && pnpm test           # CLI tests

# Type check all packages
bash check.sh
```

---

_See [PLAN.md](PLAN.md) for the full spec and [DOCS.md](DOCS.md) for CLI documentation._
