# Orchid — Feature Map (what exists · what's missing)

> Grounded in the actual code as of 2026-06-13 (branch `orchestrator`). Pairs with
> `feature-map.html` (visual). Status reflects *reality in the repo*, not marketing copy.

**What Orchid is:** a capture + query layer for AI coding conversations. The CLI installs
Claude Code hooks that sync each session's transcript to a Next.js/Hono API on Vercel,
stored in Neon Postgres. A web UI and CLI let humans and agents browse, search, summarize,
and link conversations to commits.

**The one feature that delivers 80% of the value (and is mostly NOT built yet):**
**conversation-aware code review for agents** — every commit knows its session(s), a
reviewing agent pulls the building sessions + intent, asks fast Claude follow-ups, and
posts a grounded review. The pieces exist in fragments; the loop does not.

**Legend:** ✅ shipped & working · 🟡 partial / fragile · ❌ missing · 📄 designed only (RFC/copy)

---

## 1. Capture & Sync
| Feature | Status | Reality in code | Gap |
|---|---|---|---|
| Claude Code hooks capture | ✅ | `orchid hooks install --mode auto/prompt` | — |
| `orchid claude` wrapper (legacy) | ✅ | spawns claude, polls `~/.claude/projects`, syncs every 5s | superseded by hooks |
| Transcript sync (gzip) | ✅ | full JSONL re-`PUT` every 5s; gzip for >4.5MB Vercel limit | re-uploads *entire* transcript each time (wasteful) |
| Backfill past sessions | ✅ | `orchid sync --discover` | — |
| Background daemon (auto-capture) | 📄 | PR #15 open | not merged |

## 2. Storage & Search (the speed problem)
| Feature | Status | Reality | Gap |
|---|---|---|---|
| Transcript storage | 🟡 | entire JSONL in one `orchid_session.transcript` TEXT column on Neon | bloats rows; pulled on reads that don't need it |
| Full-text search | 🟡 | `ilike '%q%'` on the transcript column | full table scan, **no FTS index**; slow at scale |
| List/detail reads | 🟡 | server components query DB directly (good), but `getSessionById`/`/sessions/:id` `SELECT *` incl. transcript | over-fetch; no pagination |
| Object storage for bodies | ❌ | — | transcripts never leave Postgres |
| Caching / live status | ❌ | no Redis; `live-refresh` polls | every poll hits Neon |

## 3. AI / Intelligence
| Feature | Status | Reality | Gap |
|---|---|---|---|
| Session summary | 🟡 | `GET /sessions/:id/summary` → OpenAI **gpt-4o-mini**, on-demand click, blocking, turns truncated to 500 chars | not Claude; not auto; not streamed; lossy |
| Session chat / ask | 🟡 | `POST /sessions/:id/chat` → gpt-4o-mini, full transcript in prompt, no streaming | not Claude; no windowing; blocks UI |
| Decision log | 🟡 | `GET /decisions` → gpt-4o-mini over ≤20 sessions, 12k-char cap; returns mock data with no key | not Claude; truncates; not precise |
| Auto-summary on session end | ❌ | — | **core launch goal — missing** |
| Claude as the model | ❌ | README claims "GPT-5.4-nano"; code is gpt-4o-mini | no Anthropic integration at all |

## 4. Privacy & Access (the "lawyer" layer)
| Feature | Status | Reality | Gap |
|---|---|---|---|
| Team scoping | 🟡 | `scopeConditions` + queries scope by `teamId` | **every teammate sees every team session** |
| Per-session ACL | ❌ | none | **#1 launch goal — missing** |
| Explicit share | ❌ | none | — |
| Handoff / takeover grant | ❌ | none | — |
| Aggregate-only team view | ❌ | dashboards show full session list | content leaks by default |

## 5. Code Review — THE 80% FEATURE
| Feature | Status | Reality | Gap |
|---|---|---|---|
| Commit → session resolution | ✅ | `orchid data sessions-for <shas>`, `GET /commits/sessions` | precise *for linked commits* |
| Commit ↔ session capture | 🟡 | `extractCommitsFromTranscript` = **regex over transcript text**, in `after()`, only on `done` | **lossy** — a SHA not echoed in the transcript is never linked; not git-verified; backfill inherits this |
| PR ↔ session link | ❌ | none stored; webhook only fuzzy-matches by branch/repo at PR-open | **no PR↔session relation exists** — needed for review + profile |
| `orchid review <branch>` | 🟡 | finds related sessions, gpt-4o-mini summary | branch/keyword match, not commit-precise; OpenAI |
| `orchid explain <sha>` | 🟡 | time/branch-correlated sessions + AI explain | correlation, not the linked session |
| PR webhook (Orchid review bot) | 🟡 | `POST /webhook/github` comments related sessions on PR open | fuzzy repo/branch match; lists sessions, doesn't *review* |
| Agent asks Orchid before reviewing | ❌ | skill describes it; no enforced loop, no Claude-grounded answer | **the spine — not wired end-to-end** |

## 6. Takeover · Handoff · Remote control · Portability
| Feature | Status | Reality | Gap |
|---|---|---|---|
| `orchid takeover <id>` | 📄 | **RFC #17 only** (open, unmerged) | command does not exist |
| Session rehydration + `--resume` | 📄 | RFC specifies it | not built |
| Remote control (drive live session) | 📄 | RFC; blocked by `stdio: 'inherit'` (no I/O interception) | not built |
| Bring session to another machine | ❌ | manual read of transcript only | no portability path |
| Soft handoff (read & continue) | 🟡 | skill workflow + `data show --turns` | lossy; no real session state transfer |

## 7. Multi-tool support
| Feature | Status | Reality | Gap |
|---|---|---|---|
| `tool` field on sessions | ✅ | column exists, set by CLI | — |
| Claude Code | ✅ | full hooks support | — |
| Codex | 🟡 | PR #47 merged (support), #36/#44 in-flight (hooks plan) | finish + verify |
| Cursor / opencode / Hermes | ❌ | — | no adapters |
| Normalized cross-tool thought format | ❌ | each parser handles formats ad hoc | no unified schema |

## 8. Web UI & Speed
| Feature | Status | Reality | Gap |
|---|---|---|---|
| Sessions dashboard | ✅ | server component, team stats, live status | refresh polls Neon |
| Session viewer (turns, timeline) | ✅ | markdown render, turn highlighter | over-fetches transcript |
| Commits tab | ✅ | `session-commits.tsx` | — |
| Search page | 🟡 | `ilike` search | slow; weak ranking |
| Decisions page | 🟡 | server-rendered, gpt-4o-mini | slow, OpenAI |
| Command palette / keyboard nav | ✅ | `command-palette.tsx`, `keyboard-nav.tsx` | — |
| Empty states everywhere | ❌ | inconsistent | **goal — missing** |
| Optimistic / instant nav | ❌ | full navigations, refetch on click | **goal — missing** |

## 9. Public profile / Virality (the flywheel)
| Feature | Status | Reality | Gap |
|---|---|---|---|
| Sign up with GitHub | ❌ | email/password + invitations only | needed for import + repos |
| Sessions ↔ commits ↔ merged PRs graph | ❌ | only session_commits exists | no PR/merge join |
| Public efficiency profile (PRs ÷ tokens) | ❌ | — | **growth engine — missing** |
| Share to X / LinkedIn + OG image | ❌ | — | no share surface |
| Token accounting | ❌ | CLI computes `totalTokens` for the TUI, but **server stores only `message_count`** — tokens never persisted | can't compute PRs ÷ tokens |

## 10. Auth · Teams · Billing
| Feature | Status | Reality | Gap |
|---|---|---|---|
| Better Auth (cookie + PAT) | ✅ | `orc_*` tokens, sessions | — |
| Orgs / members / invitations | ✅ | Resend email invites | roles unused for ACL |
| Personal access tokens | ✅ | `api_key` table, hashed | — |
| GitHub OAuth provider | ❌ | — | needed for profile |
| Stripe billing | 📄 | PR #33 plan | not built |
| Secret redaction before store | 📄 | PR #40 research | transcripts stored raw |

## 11. Infra · Background jobs · Realtime
| Feature | Status | Reality | Gap |
|---|---|---|---|
| Vercel web + API | ✅ | auto-deploy from main | — |
| Neon Postgres | ✅ | Drizzle, one migration | transcript bloat |
| DO droplet (Pulumi) | ✅ | `orchid-deploy` 4vCPU/8GB, Docker+Caddy+Claude+Codex | **idle** — repurpose for Redis/jobs/orchestrator |
| Background jobs | 🟡 | Next.js `after()` only (commit extraction) | no queue/cron; can't do heavy async |
| Redis / Temporal | ❌ | — | for cache, jobs, presence |
| Realtime transport | ❌ | polling only | needed for live/remote |

## 12. Agent interface (primary user)
| Feature | Status | Reality | Gap |
|---|---|---|---|
| `orchid-context` skill | ✅ | search/show/ask/review/explain workflows documented | strong base |
| CLI data commands | ✅ | list/show/search/summary/sessions-for | — |
| MCP server | ❌ | skill shells out instead (by design) | fine for now |
| Enforced "ask Orchid before review" | ❌ | guidance only | wire into review loop |

---

## The takeaway

Orchid today is a **solid capture + read layer** with a fragmented set of AI/review
features all running on the wrong model (OpenAI gpt-4o-mini), team-wide visible by default,
and slow at the edges. **None of the four things that make it magic exist yet:**

1. **Conversation-aware review wired end-to-end** (the 80% feature)
2. **Private-by-default + share/handoff/takeover** (the access layer)
3. **Fast Claude intelligence, auto-generated on session end**
4. **The viral public efficiency profile**

Everything in `tasks.md` ladders up to closing exactly these gaps.

## In-flight PRs to resolve
| PR | Title | Verdict |
|---|---|---|
| #47 | Codex CLI support | merged — **verify & extend** |
| #36 / #44 | Codex support / hooks plan | finish or supersede |
| #17 | RFC: Session takeover & remote control | **implement** (great spec) |
| #15 | Background daemon for auto-capture | evaluate vs hooks |
| #40 | Secret redaction research | decide: block launch or fast-follow |
| #33 | Stripe team billing | post-launch |
| #25 | Isolated local dev stack | nice for orchestrator dev |
| #4  | Remove web deploy from droplet | close (already on Vercel) |
