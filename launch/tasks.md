# Orchid — Launch Task List

> The orchestrator's backlog. Read top-to-bottom; pick the **highest-priority task whose
> deps are met**, ship it as one PR **into the `orchestrator` branch**, update
> `worklog.md`, then check the box here. One bounded task per agent. Never touch `main`.
> Reference `goals.md` for the why. `[ ]` = todo · `[~]` = in progress · `[x]` = done.

**Definition of a shippable task:** typechecks (`bash check.sh`), tests pass, UI changes
verified in a headed browser, the affected CLI exercised end-to-end, functional style (no
loops/mutation/`any`), table-qualified SQL — and it **survives the adversarial review gate**
(2–3 reviewer agents for security / performance / quality+simplicity; iterate until only
nice-to-haves remain; then the Claude GitHub app reviews the PR with Orchid context). See
`orchestrator-harness.md`. Each task lists **acceptance criteria** — meet all of them.
**Simplicity is a hard requirement: ship the simplest version that meets the criteria.**

---

## Phase 0 — Foundation & quick speed wins  *(unblocks everything; do first)*

- [ ] **P0-1 · Claude provider abstraction.** Create `web/app/lib/ai.ts` with a typed
  `askClaude({system, messages, stream})` using `ANTHROPIC_API_KEY` and the best available
  Claude model. *Accept:* one module, typed, streaming-capable; no endpoint calls OpenAI
  directly anymore after P0-2.
- [ ] **P0-2 · Swap summary/chat/decisions to Claude.** Replace the three `fetch`
  `gpt-4o-mini` calls in `api-app.ts` with `askClaude`. *Accept:* summary/chat/decisions
  run on Claude; README/`stack-and-access.md` updated; OpenAI is optional fallback only.
- [ ] **P0-3 · Stop over-fetching transcripts.** Remove `transcript` from `SELECT *` in
  `getSessionById`/`/sessions/:id` list paths where the body isn't rendered; add a
  dedicated transcript fetch. *Accept:* list/detail metadata reads don't pull the JSONL.
- [ ] **P0-4 · Postgres FTS index + search.** Add a `tsvector` generated column +
  GIN index on transcript; rewrite `searchSessions` to use it (ranked) instead of `ilike`.
  Migration via `pnpm db:generate`. *Accept:* search uses FTS, returns ranked results,
  `< 300ms` on a few hundred sessions; falls back gracefully.
- [ ] **P0-5 · Wire secrets.** Land `ANTHROPIC_API_KEY` (+ GitHub OAuth, DO token) into
  Vercel + droplet + local `.env`; document in `stack-and-access.md`. *Accept:* AI works
  in prod on Claude.

## Phase 1 — Privacy & the access layer  *(#1 goal — depends: none)*

- [ ] **P1-1 · Per-session owner + visibility.** Add `visibility` (`private`|`team`) to
  `orchid_session`, default `private`; backfill existing rows to `team` (so we don't
  surprise current users) but new sessions default `private`. Migration. *Accept:* column
  exists, indexed; default private for new captures.
- [ ] **P1-2 · Scope reads by owner + visibility + shares.** Update `scopeConditions` and
  `queries.ts` so a user sees: their own sessions, `team`-visible sessions, and sessions
  explicitly shared with them. *Accept:* a teammate can NOT load another user's private
  session (404); covered by tests.
- [ ] **P1-3 · Share grants table + API.** `session_share (session_id, grantee_user_id,
  capability: read|continue, created_by, expires_at)`. `POST /sessions/:id/share`,
  `DELETE`. *Accept:* owner can grant/revoke; grantee gains scoped access.
- [ ] **P1-4 · Aggregate-only team dashboard.** Team activity shows counts/stats, not other
  users' session content, unless shared/team-visible. *Accept:* dashboard leaks no private
  content; empty/locked states shown.
- [ ] **P1-5 · Share UI.** A "Share" affordance on a session (copy link / pick teammate).
  *Accept:* Linear-style, instant, generates a working share.

## Phase 2 — The 80% feature: conversation-aware review  *(depends: P0, P1-3)*

- [ ] **P2-1 · Harden commit↔session capture.** Today linking is **regex over transcript
  text only** (lossy — a SHA not echoed in the transcript is never linked). Capture via a
  git post-commit hook (CLI `orchid hooks install` adds it) that posts `{sha, session_id}`.
  *Accept:* commits made during a session are linked without relying on transcript parsing.
- [ ] **P2-1b · Backfill links commits & PRs from git/GitHub.** `orchid sync --discover` must
  resolve a session's commits from **git** (by repo + author + time window + branch) and its
  PRs from **GitHub**, not from transcript regex. *Accept:* backfilled sessions show their
  real commits and PRs even when SHAs/PR numbers never appeared in the conversation text.
- [ ] **P2-6 · PR ↔ session linking.** New `session_pr (session_id, repo, pr_number, url,
  state, merged_at)`. Populate from the webhook (PR commits → sessions) and from
  `sessions-for`. *Accept:* a PR maps to all sessions that built it; a session lists its PRs.
  (Prereq for review and the efficiency profile.)
- [ ] **P2-7 · Claude GitHub app reviews PRs *with* Orchid.** Install the Claude GitHub app /
  Action so `@claude` reviews PRs, and give it Orchid context (the orchid-context skill +
  a PR comment from `/webhook/github` that resolves commits→sessions→intent). *Accept:*
  opening a PR triggers a Claude review that cites the building sessions' intent; this is the
  same gate the orchestrator's own PRs pass through.
- [ ] **P2-2 · `orchid review` on Claude, commit-precise.** Rewrite `review` to resolve PR
  commits → sessions (`sessions-for`) and synthesize a Claude review-context brief (intent,
  decisions, risks, what to watch). *Accept:* given a branch/PR, returns grounded context
  citing session+turn; runs on Claude.
- [ ] **P2-3 · `orchid ask-context <pr|branch>`.** A single CLI call a reviewing agent makes
  *before* reviewing: returns the building sessions' intent + a Q&A handle. *Accept:*
  documented in the skill as a required pre-review step.
- [ ] **P2-4 · PR webhook actually reviews.** Upgrade `/webhook/github`: resolve PR commits
  → sessions, generate a Claude-grounded review comment (intent + flags), not just a list.
  Commit-precise match (not fuzzy branch). *Accept:* opening a PR posts a useful,
  intent-aware comment.
- [ ] **P2-5 · Skill: enforce ask-before-review.** Update `skills/orchid-context/SKILL.md`
  so reviewing agents must run `ask-context` first. *Accept:* skill workflow updated; sample
  transcript demonstrates it.

## Phase 3 — Fast Claude intelligence  *(depends: P0)*

- [ ] **P3-1 · Auto-summary on session end.** When a session flips to `done`, enqueue a
  background job (Vercel `after()`/cron now; droplet queue later) that generates a Claude
  summary + key moments and stores them on the row. *Accept:* finished sessions have a
  summary without a click; generated in `< 2s` typical.
- [ ] **P3-2 · Key moments / turnover extraction.** Store structured "important moments"
  (decisions, blockers, file/area touched) per session at end. *Accept:* viewer shows them
  instantly (precomputed, not on-click).
- [ ] **P3-3 · Streaming chat.** Stream `POST /sessions/:id/chat` responses (SSE) on Claude;
  window long histories. *Accept:* tokens stream into the UI; no full-blocking wait.

## Phase 4 — Speed everywhere  *(depends: P0-3/P0-4)*

- [ ] **P4-1 · Instant navigation.** Prefetch + optimistic transitions between dashboard /
  session / tabs; no full reloads. *Accept:* p95 click-to-paint `< 200ms` on warm cache.
- [ ] **P4-2 · Real empty states everywhere.** Every list/page has a designed empty state
  (no sessions, no commits, no results, locked/private). *Accept:* audited list, all covered.
- [ ] **P4-3 · Redis cache for hot reads + live status.** Stand up Redis on the droplet;
  cache session lists/stats and presence; replace polling-hits-Neon. *Accept:* dashboard
  refresh doesn't hit Postgres on every tick.

## Phase 5 — Takeover · handoff · portability  *(implements RFC #17; depends: P1-3)*

- [ ] **P5-1 · `orchid takeover <id>`.** Implement RFC approach A: verify access via Orchid,
  download JSONL, write to `~/.claude/projects/<project>/<id>.jsonl`, `git fetch`+checkout
  the session's branch/commit, launch `claude --resume`. *Accept:* a shared session resumes
  locally with full history; original marked `handed-off`; chain recorded.
- [ ] **P5-2 · `orchid share --takeover` one-liner.** Generate a `orchid takeover <code>`
  command + web button. *Accept:* a blocked teammate shares one line; recipient continues.
- [ ] **P5-3 · Handoff chain UI.** Show who built / took over / when on a session.
- [ ] **P5-4 · (stretch) Remote control.** Investigate intercepting `stdio` (PTY) to drive a
  live session across machines via the droplet. *Accept:* spike + decision doc.

## Phase 6 — Multi-tool capture  *(depends: P0)*

- [ ] **P6-1 · Verify & finish Codex.** Confirm PR #47 capture works end-to-end; resolve
  #36/#44. *Accept:* a Codex session syncs + appears with `tool=codex`.
- [ ] **P6-2 · Normalized thought schema.** One internal session/turn shape all adapters map
  to. *Accept:* parsers for Claude/Codex emit the same shape.
- [ ] **P6-3 · Cursor adapter.** Capture Cursor sessions. *Accept:* `tool=cursor` sessions sync.
- [ ] **P6-4 · opencode adapter.** *Accept:* `tool=opencode` sessions sync.

## Phase 7 — Virality: the public efficiency profile  *(the flywheel; depends: P0-5)*

- [ ] **P7-1 · Sign up with GitHub.** Add GitHub OAuth to Better Auth. *Accept:* GitHub
  signup/login works; stores GitHub identity + token scopes for repo/PR reads.
- [ ] **P7-2 · Token accounting (persist).** Today the CLI computes `totalTokens` from
  transcript `usage` only for the local TUI — **the server never stores tokens** (schema has
  `message_count` only). Add token columns to `orchid_session`, send them on sync, and
  backfill. *Accept:* sessions carry persisted input/output token totals queryable for the
  PRs-÷-tokens metric.
- [ ] **P7-3 · Sessions ↔ commits ↔ merged PRs.** Join GitHub PR/merge data to sessions via
  commits. *Accept:* a merged PR maps to its building sessions + tokens.
- [ ] **P7-4 · Efficiency profile page.** Public `/u/<handle>`: PRs shipped ÷ tokens,
  contribution-graph style, beautiful (Linear-grade). *Accept:* renders from imported data;
  proud-to-share.
- [ ] **P7-5 · Share + OG image.** `@vercel/og` renders the graph as a PNG; share-to-X/
  LinkedIn buttons. *Accept:* sharing a profile produces a rich card image.
- [ ] **P7-6 · Bulk import.** Let a new user import all past local sessions (all tools) at
  signup. *Accept:* one command/flow imports history into the profile.

## Phase 8 — Storage phase 2 & infra  *(depends: P0-4)*

- [ ] **P8-1 · Transcripts → object storage.** Move JSONL bodies to R2/Spaces; Neon keeps
  metadata + FTS index + a pointer. Stream/sign reads. *Accept:* new transcripts stored in
  object storage; reads work; Neon rows shrink; migration for existing.
- [ ] **P8-2 · Background job queue on droplet.** Stand up a durable queue (BullMQ on Redis)
  for summaries/imports/profile builds beyond `after()`. *Accept:* heavy jobs run off the
  request path with retries.

## Phase 9 — Landing page & first impression  *(end of each run; depends: features exist to show)*

- [ ] **P9-1 · Redesign the landing page.** Make it more beautiful and more *attractive to
  both agents and humans*: lead with "the repository of agents' thoughts" + the review/
  takeover demos; show a real efficiency-profile graph; Linear-grade polish. Before-state is
  captured in `screenshots/before/`. *Accept:* side-by-side before/after screenshots in
  `screenshots/`; faster, clearer, more striking than the current page; mobile-clean.
- [ ] **P9-2 · Agent-facing quickstart.** A section/page that sells the CLI + skill to agents
  (copy-paste setup, "your agent can shell out to orchid"). *Accept:* an agent could onboard
  from this page alone.
- [ ] **P9-3 · Capture after-screenshots of every improved surface.** *Accept:*
  `screenshots/after/` mirrors `before/` for dashboard, session viewer, search, decisions,
  landing — for the before/after story.

## Continuous — orchestrator self-improvement  *(always-on, lowest priority when others pending)*

- [ ] **C-1 · Speed audit loop.** Periodically browse the app headed, measure click latency,
  file the worst offender as a new P4 task in this list. *Accept:* worklog records findings.
- [ ] **C-2 · Beauty/UX audit.** Compare against Linear; file polish tasks.
- [ ] **C-3 · Bug sweep.** Run flows, capture errors/console, file fixes.
- [ ] **C-4 · Dogfood review loop.** Use Orchid's own review on its own PRs into
  `orchestrator`; record whether context helped.

---

### Sequencing note
Phases 0→1→2 are the critical path to the headline demo (fast Claude + private + review
loop). 3/4 run alongside. 5 (takeover) and 7 (virality) are the two most *shareable* demos —
prioritize one of them early for momentum once the critical path is green.
