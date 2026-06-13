# Stack & Access — what the orchestrator needs to ship everything

> Drop credentials into a local `.env` / `.secrets` (gitignored) and the droplet's env.
> Status legend: ✅ already have (authed locally) · 🔑 you provide · 🆕 to create · ⚙️ later

---

## Reality check (verified 2026-06-13)

Almost everything is already authed locally as Julian, so the orchestrator runs **local-first**:

| Need | Why | Status |
|------|-----|--------|
| `gh` CLI | git push / PRs / comments | ✅ authed — no token needed |
| `vercel` CLI | deploys / preview URLs | ✅ authed |
| `neonctl` CLI | migrations, FTS index, DB admin | ✅ authed |
| `claude`, `pulumi` | conductor + droplet IaC | ✅ present |
| Droplet SSH key | services-sandbox access | ✅ `~/.ssh/orchid-agent` + derived `.pub` |
| `ANTHROPIC_API_KEY` | app's Claude calls (summaries/review/Q&A) | ✅ provided (`.env.orchestrator`) |
| `DIGITALOCEAN_TOKEN` | `pulumi up` the droplet | ✅ provided (`.env.orchestrator`) |
| GitHub OAuth app (client id/secret) | "Sign in with GitHub" | ⚙️ register at Phase 7 |
| Claude GitHub App | PR-review gate | ⚙️ install at Phase 2 |

**How previews work:** pushing a branch to GitHub auto-updates its **Vercel preview + Neon
branch DB** — the orchestrator just pushes; nothing to provision. **Build env** = the local
dev DB (`docker compose up`, schema applied). Prod updates at **promotion** (humans merge
`orchestrator` → `main`).

**Background jobs:** **Vercel Workflows** (zero infra, app's on Vercel) for most async work;
**Temporal OSS** on the droplet for heavy/long-running orchestration.

### GitHub OAuth app (Phase 7 — end-user sign-in, not a PAT)
- github.com → Settings → Developer settings → OAuth Apps → New.
- Homepage `https://www.orchidkeep.com` · Callback `https://www.orchidkeep.com/api/auth/callback/github`
  (+ `http://localhost:3000/api/auth/callback/github` for dev).

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
| **Background jobs** | 5 — auto-summary on session end, profile builds, imports | **Vercel Workflows** for most async work; **Temporal OSS** on the droplet for heavy/long-running |
| **OG image generation** | 7 — shareable profile graph | `@vercel/og` (edge) renders the efficiency graph as a PNG at share time |
| **`claude agents --json` ingestion** | 1/6 — live cross-machine Agent View | a daemon/hook reads local Agent View state + streams to Orchid |
| **Domain/DNS** | already `orchidkeep.com` | confirm Vercel + any droplet subdomain (e.g. `rt.orchidkeep.com` for realtime) |

## Open questions for you (non-blocking — sensible defaults chosen)
- Object storage provider: **R2** (recommended) vs DO Spaces vs S3?
- Realtime transport for live sessions / remote control: SSE (simple, Vercel-friendly) vs WebSocket on the droplet?
- Billing (Stripe) — in scope for launch, or after? (PR #33 has a plan.)
- Secret redaction before storing transcripts (PR #40) — block launch on it, or fast-follow?
