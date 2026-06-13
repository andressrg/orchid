# Stack & Access — what the orchestrator needs to ship everything

> Drop credentials into a local `.env` / `.secrets` (gitignored) and the droplet's env.
> Status legend: ✅ already have (authed locally) · 🔑 you provide · 🆕 to create · ⚙️ later

---

## Reality check (verified 2026-06-13)

Most CLIs are **already authed locally as Julian** — so the orchestrator runs **local-first**
and we need far less than first thought:

| Need | Why | Status |
|------|-----|--------|
| `vercel` CLI | deploys / env / preview URLs | ✅ authed (julian) |
| `neonctl` CLI | migrations, FTS index, DB admin | ✅ authed (julian) |
| `gh` CLI | git ops, PRs, webhooks | ✅ authed (julian) |
| `claude`, `pulumi` | conductor + droplet IaC | ✅ present |
| Droplet SSH key | services sandbox access | ✅ `~/.ssh/orchid-agent` present (need IP) |
| **Anthropic API key** | the app's Claude calls (summaries/review/Q&A) — the one true must-have | 🔑 **provide** → `ANTHROPIC_API_KEY` |
| Droplet IP / reachability | confirm `ssh -i ~/.ssh/orchid-agent root@<ip>` works | 🔑 confirm |
| **Prod DB + Vercel ownership** | Orchid's Vercel project + Neon DB appear to be under **Andres**, not Julian (no `orchid` Vercel project here; only Neon project visible is `el-topo-diamantina`). Needed only at **promotion**, not for build work | ⚙️ confirm with Andres |
| GitHub OAuth app | "Sign up with GitHub" + public profile | 🆕 later (Phase 7) |
| Claude GitHub app + `GITHUB_TOKEN` | PR-review gate / webhook bot | ⚙️ later (Phase 2) |
| ~~Resend~~ | invite/verification email only — **not a blocker** | skip |

**Build env = local:** the conductor uses a **local dev DB** (`docker compose up` +
`pnpm db:migrate`) and never needs prod creds. Prod deploy/migrations happen at promotion,
gated by you + Andres.

### GitHub OAuth app setup (Phase 7)
- Create at github.com → Settings → Developer settings → OAuth Apps → New.
- Homepage: `https://www.orchidkeep.com` · Callback: `https://www.orchidkeep.com/api/auth/callback/github`
  (and `http://localhost:3000/api/auth/callback/github` for dev).
- `GITHUB_TOKEN` for the webhook bot: fine-grained PAT, **Contents: read**, **Pull requests: write**, **Issues: write**.

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
