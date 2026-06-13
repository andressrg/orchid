# Stack & Access — what the orchestrator needs to ship everything

> Drop credentials into a local `.env` / `.secrets` (gitignored) and the droplet's env.
> Status legend: ✅ have · 🔑 you provide · 🆕 to create · ⚙️ to set up

---

## You already agreed to provide these (top priority — unblocks the most)

| Need | Why | Where it goes | Status |
|------|-----|---------------|--------|
| **Anthropic API key** | Claude becomes the brain (summaries, review context, Q&A), replacing `gpt-4o-mini` | `ANTHROPIC_API_KEY` (Vercel env + droplet) | 🔑 |
| **DO droplet SSH + API token** | Redis (cache/live status), background jobs, object storage option, and running the orchestrator for hours | `~/.ssh/orchid-agent`, `DIGITALOCEAN_TOKEN` | 🔑 (droplet exists in Pulumi) |
| **Vercel access (token)** | Deploys, env vars, preview URLs end-to-end | `VERCEL_TOKEN` (local for CLI) | 🔑 |
| **Neon access (connection + admin)** | Run migrations, add the FTS index, manage DB | `DATABASE_URL` | 🔑 |
| **GitHub OAuth app + token** | "Sign up with GitHub", PR-review webhook, read repos/PRs for the public profile | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_TOKEN` | 🆕 app + 🔑 token |

### Exact GitHub OAuth app setup
- Create at github.com → Settings → Developer settings → OAuth Apps → New.
- Homepage: `https://www.orchidkeep.com` · Callback: `https://www.orchidkeep.com/api/auth/callback/github`
  (and `http://localhost:3000/api/auth/callback/github` for dev).
- `GITHUB_TOKEN` for the webhook bot: fine-grained PAT, **Contents: read**, **Pull requests: write**, **Issues: write** (PR comments are issue comments).

---

## Current stack (confirmed in code)

| Layer | Tech | Notes |
|-------|------|-------|
| Web + API | Next.js 16 + Hono (`/api`) on Vercel | auto-deploys from `main` |
| DB | Neon Postgres + Drizzle ORM | transcript stored as one big TEXT column ⚠️ |
| Auth | Better Auth (cookie sessions + PATs) + orgs/members/invitations | add GitHub OAuth provider |
| AI | ⚠️ OpenAI `gpt-4o-mini` via raw fetch, on-demand, blocking | → migrate to Claude, auto + streamed |
| Email | Resend | `RESEND_API_KEY`, `EMAIL_FROM` |
| CLI | TypeScript, published as `orchid-cli` on npm | hooks-based capture |
| Skill | `skills/orchid-context` | the agent-facing read interface |
| Infra | Pulumi → DO droplet `orchid-deploy` (s-4vcpu-8gb, Docker, Caddy, Claude + Codex preinstalled) | currently idle; repurpose |

## To create / set up

| Item | For which pillar | Decision |
|------|------------------|----------|
| **Object storage** (Cloudflare R2 / DO Spaces / S3) | 8 — transcripts off the hot path | R2 cheapest egress; Spaces simplest if staying in DO. *Phase 2.* |
| **Redis on droplet** | 4/6 — cache, live session status, presence | `docker run redis` on droplet behind firewall |
| **Background jobs** | 5 — auto-summary on session end, profile builds, imports | Start with Vercel `after()` + cron; graduate heavy/long jobs to the droplet (BullMQ on Redis, or Temporal if needed) |
| **OG image generation** | 7 — shareable profile graph | `@vercel/og` (edge) renders the efficiency graph as a PNG at share time |
| **`claude agents --json` ingestion** | 1/6 — live cross-machine Agent View | a daemon/hook reads local Agent View state + streams to Orchid |
| **Domain/DNS** | already `orchidkeep.com` | confirm Vercel + any droplet subdomain (e.g. `rt.orchidkeep.com` for realtime) |

## Open questions for you (non-blocking — sensible defaults chosen)
- Object storage provider: **R2** (recommended) vs DO Spaces vs S3?
- Realtime transport for live sessions / remote control: SSE (simple, Vercel-friendly) vs WebSocket on the droplet?
- Billing (Stripe) — in scope for launch, or after? (PR #33 has a plan.)
- Secret redaction before storing transcripts (PR #40) — block launch on it, or fast-follow?
