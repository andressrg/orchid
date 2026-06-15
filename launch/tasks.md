# Orchid — Launch Task List

> The orchestrator's backlog. Read top-to-bottom; pick the **highest-priority task whose
> deps are met**, ship it as one PR → **squash-merge to `main`** → deploy prod, update
> `worklog.md`, then check the box here. One bounded task per agent.
> Reference `goals.md` for the why. `[ ]` = todo · `[~]` = in progress · `[x]` = done.

**Definition of a shippable task:** typechecks (`bash check.sh`), tests pass, UI changes
verified in a headed browser, the affected CLI exercised end-to-end, functional style (no
loops/mutation/`any`), table-qualified SQL — and it **survives the adversarial review gate**
(2–3 reviewer agents for security / performance / quality+simplicity; iterate until only
nice-to-haves remain; then the Claude GitHub app reviews the PR with Orchid context). See
`orchestrator-harness.md`. Each task lists **acceptance criteria** — meet all of them.
**Simplicity is a hard requirement: ship the simplest version that meets the criteria.**

---

## Phase S — Hardening from the adversarial review _(do alongside Phase 0; iterate live)_

> Captured from the plan's adversarial review so we don't lose them. Hackathon mode: the loop
> fixes these as it ships. **Phase T decision (written):** land T-2 deterministic redaction
> early/high-priority; don't run real external/customer sessions through the loop until it's
> in — our own repo's sessions are accepted short-term while T-2 lands fast.

- [x] **S-0 · Make the verify gate real.** Previews must boot a **migrated** DB or "green" is
      fake: add automatic migration on Vercel build (a `db:migrate` build/postinstall step, or
      boot-time migrate-with-lock) and confirm `ANTHROPIC_API_KEY` is in Vercel **preview** env
      (`vercel env add`). Until then, also verify locally against the migrated docker DB.
      **ALSO (found 2026-06-13, PR #51):** authed browser login **fails on every preview** with
      **"Invalid origin"** — Better Auth (`web/app/lib/auth.ts`) only trusts the configured
      `baseURL`; preview hosts aren't in `trustedOrigins`. Add Vercel preview hosts to
      `trustedOrigins` (scope to our project, e.g. `https://orchid-web-*-frecuenti.vercel.app` + the per-deploy `VERCEL_URL`) so dashboard/sessions/chat can be verified on previews, not
      just prod. This is the real blocker to "verify on the preview URL."
      **DONE 2026-06-14 (#71, `f230773`)** — migrate-on-build was already in `build`; `trustedOrigins`
      now derived from Vercel system envs (`resolveAuthUrls`, scoped exact hosts, no wildcard).
      **Verified: preview login works** (redirects to dashboard, no Invalid origin) **and prod login
      unbroken**. Remaining sub-item: confirm `ANTHROPIC_API_KEY` in Vercel **preview** env — check on
      the next PR's preview (login now works there, so AI features are directly testable).
- [ ] **S-1 · Authenticate the GitHub webhook.** Verify `X-Hub-Signature-256` HMAC on
      `/webhook/github` (unauthenticated today — api-app.ts:63 skips it) and `escapeLike` the
      repo name (api-app.ts:783).
- [ ] **S-2 · Rate-limit + validate inputs.** Rate-limit the AI endpoints; add size/type
      validation on `PUT /sessions/:id` (reject oversized transcripts; sanitize `user_name`);
      drop the silent OpenAI fallback (return 503 if Claude unconfigured).
- [ ] **S-3 · Accuracy fixes for P0-3/P0-4.** `/sessions` LIST already selects explicit columns
      (leave it). Real over-fetch is `GET /sessions/:id` `select()` (api-app.ts:201). FTS has
      **two** `ilike` sites to switch: api-app.ts:168 **and** queries.ts:124.

## Phase 0 — Foundation & quick speed wins _(unblocks everything; do first)_

- [x] **P0-1 · Claude provider abstraction.** Create `web/app/lib/ai.ts` with a typed
      `askClaude({system, messages, stream})` using `ANTHROPIC_API_KEY` and the best available
      Claude model. _Accept:_ one module, typed, streaming-capable; no endpoint calls OpenAI
      directly anymore after P0-2. ✅ PR #51 (`a7b9f0b`) — `askClaude`/`streamClaude`, typed
      readonly, injection-safe (`system` ≠ message); 271-line unit suite.
- [x] **P0-2 · Swap summary/chat/decisions to Claude.** Replace the three `fetch`
      `gpt-4o-mini` calls in `api-app.ts` with `askClaude`. _Accept:_ summary/chat/decisions
      run on Claude; README/`stack-and-access.md` updated; OpenAI is optional fallback only.
      ✅ PR #51 — single `generateAiText` helper (Claude-first, OpenAI fallback); Claude
      failures map to 502 (+regression test); README + stack-and-access updated. Key wired
      into Vercel prod by Julian 2026-06-13 (P0-5 prod portion).
- [x] **P0-3 · Stop over-fetching transcripts.** Remove `transcript` from `SELECT *` in
      `getSessionById`/`/sessions/:id` list paths where the body isn't rendered; add a
      dedicated transcript fetch. _Accept:_ list/detail metadata reads don't pull the JSONL.
      ✅ PR #53 (`d1733c5`) — `getSessionById` metadata-only + `getSessionTranscriptById`;
      conversation streamed via `<Suspense>`; count from `message_count`. (Also shipped PR #52:
      fixed the prod AI 502 — Claude Code transcripts nest turns under `obj.message`; the
      summary/decisions parser sent empty content. AI on Claude verified live in prod, 200.)
- [x] **P0-4 · Postgres FTS index + search.** Add a `tsvector` generated column +
      GIN index on transcript; rewrite `searchSessions` to use it (ranked) instead of `ilike`.
      Migration via `pnpm db:generate`. _Accept:_ search uses FTS, returns ranked results,
      `< 300ms` on a few hundred sessions; falls back gracefully.
- [ ] **P0-5 · Wire secrets.** Land `ANTHROPIC_API_KEY` (+ GitHub OAuth, DO token) into
      Vercel + droplet + local `.env`; document in `stack-and-access.md`. _Accept:_ AI works
      in prod on Claude.
- [ ] **P0-6 · Dumb-simple, blazing-fast write path (all processing server-side).** Today the
      CLI re-uploads the **entire** gzipped transcript every 5s. Redesign so the **client is
      dumb**: append/stream **deltas**, the server durably stashes them and **acks immediately**.
      ALL processing (parse, redact, index, link commits/PRs, summarize) runs **async on the
      server**, off the write path — _the agent chooses the mechanism_ (append-only log,
      direct-to-object-storage staging, edge ingest + queue, etc.). _Accept:_ client sends only
      new turns/bytes; ingest ack is fast (small p50); no full re-upload; crash-safe; writing
      never blocks the user's agent; processing happens entirely server-side. Spike + decision
      doc, then implement.

## Phase 1 — Privacy & the access layer _(#1 goal — depends: none)_

- [ ] **P1-1 · Per-session owner + visibility.** Add `visibility` (`private`|`team`) to
      `orchid_session`, default `private`; backfill existing rows to `team` (so we don't
      surprise current users) but new sessions default `private`. Migration. _Accept:_ column
      exists, indexed; default private for new captures.
- [ ] **P1-2 · Scope reads by owner + visibility + shares.** Update `scopeConditions` and
      `queries.ts` so a user sees: their own sessions, `team`-visible sessions, and sessions
      explicitly shared with them. _Accept:_ a teammate can NOT load another user's private
      session (404); covered by tests.
- [ ] **P1-3 · Share grants table + API.** `session_share (session_id, grantee_user_id,
capability: read|continue, created_by, expires_at)`. `POST /sessions/:id/share`,
      `DELETE`. _Accept:_ owner can grant/revoke; grantee gains scoped access.
- [ ] **P1-4 · Aggregate-only team dashboard.** Team activity shows counts/stats, not other
      users' session content, unless shared/team-visible. _Accept:_ dashboard leaks no private
      content; empty/locked states shown.
- [ ] **P1-5 · Share UI.** A "Share" affordance on a session (copy link / pick teammate).
      _Accept:_ Linear-style, instant, generates a working share.

## Phase T — Secret redaction (TRUST — do early) _(depends: none; land before raw transcripts pile up)_

> "We never store your secrets." Users _will_ paste API keys into prompts. Today the CLI
> uploads the raw JSONL and the server stores it verbatim — every downstream feature (search,
> AI, webhook) then handles secrets. Per the **dumb-client / all-processing-server-side**
> decision, redaction runs **server-side at ingest, before canonicalization** (PR #40's
> deterministic, redacted-canonical-storage approach, minus the client-side step). Raw lands
> only in secured, auto-purged staging. Selling point that makes "capture everything" safe →
> feeds the flywheel.

- [ ] **T-1 · Transcript-aware parsing (server).** On ingest, parse incoming delta JSONL into
      typed fragments (model text, tool input/output, command output, diffs, env dumps, MCP
      config) before scanning. _Accept:_ a fragment model the scanner runs over; tests on real
      transcripts.
- [ ] **T-2 · Deterministic redaction on ingest (server, before canonicalization).** Scan
      fragments for provider tokens (`sk-…`, `ghp_…`, AWS `AKIA…`, GCP, Slack), private keys,
      JWTs, connection strings with passwords, `KEY=secret` env lines; context-bound entropy for
      the rest. Replace with typed placeholders (`[REDACTED:aws_key]`). Persist **only redacted**
      canonical text + a **manifest** (span coords, detector, rule version, HMAC fingerprint —
      **never the raw secret**); **auto-purge** raw staging after redaction. _Accept:_ known
      secrets never reach canonical storage; raw staging is access-controlled + purged; fast.
- [ ] **T-3 · Server ingestion gate + schema.** Add `redaction_status`, `scanner_version`,
      and a findings table. Do not persist to canonical / expose transcript until
      `redaction_status = passed`. Search/AI/webhook read only redacted canonical text.
      _Accept:_ unredacted content is quarantined in staging, never canonical; existing rows
      flagged for re-scan.
- [ ] **T-4 · AI prompt-boundary hardening.** Put transcript in an explicitly-untrusted data
      section, never in the system prompt; run AI features only after redaction passes; use
      structured outputs for extraction. _Accept:_ chat/summary/decisions stay safe from
      transcript-borne injection; verified with an injection probe. (Pairs with P0-2.)
- [ ] **T-5 · (optional) Preventive hook + MCP scan.** Optional Claude Code `PreToolUse` hook
      that warns/blocks secret-printing commands (`cat .env`, `env`, `kubectl get secret -o yaml`);
      scan `.mcp.json`/`.claude/settings.json` when they enter transcript context. _Accept:_ opt-in;
      documented.

## Phase 2 — The 80% feature: conversation-aware review _(depends: P0, P1-3)_

- [ ] **P2-1 · Harden commit↔session capture.** Today linking is **regex over transcript
      text only** (lossy — a SHA not echoed in the transcript is never linked). Capture via a
      git post-commit hook (CLI `orchid hooks install` adds it) that posts `{sha, session_id}`.
      _Accept:_ commits made during a session are linked without relying on transcript parsing.
- [x] **P2-1b · Backfill links commits & PRs from git/GitHub.** `orchid sync --discover` must
      resolve a session's commits from **git** (by repo + author + time window + branch) and its
      PRs from **GitHub**, not from transcript regex. _Accept:_ backfilled sessions show their
      real commits and PRs even when SHAs/PR numbers never appeared in the conversation text.
- [ ] **P2-6 · PR ↔ session linking.** New `session_pr (session_id, repo, pr_number, url,
state, merged_at)`. Populate from the webhook (PR commits → sessions) and from
      `sessions-for`. _Accept:_ a PR maps to all sessions that built it; a session lists its PRs.
      (Prereq for review and the efficiency profile.)
- [ ] **P2-7 · Claude GitHub app reviews PRs _with_ Orchid.** Install the Claude GitHub app /
      Action so `@claude` reviews PRs, and give it Orchid context (the orchid-context skill +
      a PR comment from `/webhook/github` that resolves commits→sessions→intent). _Accept:_
      opening a PR triggers a Claude review that cites the building sessions' intent; this is the
      same gate the orchestrator's own PRs pass through.
- [x] **P2-2 · `orchid review` on Claude, commit-precise.** Rewrite `review` to resolve PR
      commits → sessions (`sessions-for`) and synthesize a Claude review-context brief (intent,
      decisions, risks, what to watch). _Accept:_ given a branch/PR, returns grounded context
      citing session+turn; runs on Claude.
- [x] **P2-3 · `orchid ask-context <pr|branch>`.** A single CLI call a reviewing agent makes
      _before_ reviewing: returns the building sessions' intent + a Q&A handle. _Accept:_
      documented in the skill as a required pre-review step.
- [ ] **P2-4 · PR webhook actually reviews.** Upgrade `/webhook/github`: resolve PR commits
      → sessions, generate a Claude-grounded review comment (intent + flags), not just a list.
      Commit-precise match (not fuzzy branch). _Accept:_ opening a PR posts a useful,
      intent-aware comment.
- [x] **P2-5 · Skill: enforce ask-before-review.** Update `skills/orchid-context/SKILL.md`
      so reviewing agents must run `ask-context` first. _Accept:_ skill workflow updated; sample
      transcript demonstrates it.

## Phase 3 — Fast Claude intelligence _(depends: P0)_

- [x] **P3-1 · Auto-summary on session end.** When a session flips to `done`, enqueue a
      background job (**Vercel Workflows**, or **Temporal OSS** on the droplet) that generates a
      Claude summary + key moments and stores them on the row. _Accept:_ finished sessions have a
      summary without a click; generated in `< 2s` typical. **DONE 2026-06-14 (#70, `625d203`)** —
      server-side `after()` on `done` (idempotent) + cache-read endpoint + SSR `initialSummary`;
      summary stored on `orchid_session.summary` (migration 0007); verified live on prod (generate →
      reload → instant, no click). Key-moments extraction is its own task → **P3-2**.
- [ ] **P3-2 · Key moments / turnover extraction.** Store structured "important moments"
      (decisions, blockers, file/area touched) per session at end. _Accept:_ viewer shows them
      instantly (precomputed, not on-click).
- [ ] **P3-3 · Streaming chat.** Stream `POST /sessions/:id/chat` responses (SSE) on Claude;
      window long histories. _Accept:_ tokens stream into the UI; no full-blocking wait.

## Phase 4 — Speed everywhere _(depends: P0-3/P0-4)_

- [ ] **P4-1 · Instant navigation.** Prefetch + optimistic transitions between dashboard /
      session / tabs; no full reloads. _Accept:_ p95 click-to-paint `< 200ms` on warm cache.
- [ ] **P4-2 · Real empty states everywhere.** Every list/page has a designed empty state
      (no sessions, no commits, no results, locked/private). _Accept:_ audited list, all covered.
- [ ] **P4-3 · Redis cache for hot reads + live status.** Stand up Redis on the droplet;
      cache session lists/stats and presence; replace polling-hits-Neon. _Accept:_ dashboard
      refresh doesn't hit Postgres on every tick.

## Phase 5 — Takeover · handoff · portability _(implements RFC #17; depends: P1-3)_

- [ ] **P5-1 · `orchid takeover <id>`.** Implement RFC approach A: verify access via Orchid,
      download JSONL, write to `~/.claude/projects/<project>/<id>.jsonl`, `git fetch`+checkout
      the session's branch/commit, launch `claude --resume`. _Accept:_ a shared session resumes
      locally with full history; original marked `handed-off`; chain recorded.
- [ ] **P5-2 · `orchid share --takeover` one-liner.** Generate a `orchid takeover <code>`
      command + web button. _Accept:_ a blocked teammate shares one line; recipient continues.
- [ ] **P5-3 · Handoff chain UI.** Show who built / took over / when on a session.
- [ ] **P5-4 · (stretch) Remote control.** Investigate intercepting `stdio` (PTY) to drive a
      live session across machines via the droplet. _Accept:_ spike + decision doc.

## Phase 6 — Multi-tool capture _(depends: P0)_

- [ ] **P6-1 · Verify & finish Codex.** Confirm PR #47 capture works end-to-end; resolve
      #36/#44. _Accept:_ a Codex session syncs + appears with `tool=codex`.
- [ ] **P6-2 · Normalized thought schema.** One internal session/turn shape all adapters map
      to. _Accept:_ parsers for Claude/Codex emit the same shape.
- [ ] **P6-3 · Cursor adapter.** Capture Cursor sessions. _Accept:_ `tool=cursor` sessions sync.
- [ ] **P6-4 · opencode adapter.** _Accept:_ `tool=opencode` sessions sync.

## Phase 7 — Virality: the public efficiency profile _(the flywheel; depends: P0-5)_

- [x] **P7-1 · Sign up with GitHub.** Add GitHub OAuth to Better Auth. _Accept:_ GitHub
      signup/login works; stores GitHub identity + token scopes for repo/PR reads.
- [x] **P7-2 · Token accounting (persist).** Today the CLI computes `totalTokens` from
      transcript `usage` only for the local TUI — **the server never stores tokens** (schema has
      `message_count` only). Add token columns to `orchid_session`, send them on sync, and
      backfill. _Accept:_ sessions carry persisted input/output token totals queryable for the
      PRs-÷-tokens metric.
- [ ] **P7-3 · Sessions ↔ commits ↔ merged PRs.** Join GitHub PR/merge data to sessions via
      commits. _Accept:_ a merged PR maps to its building sessions + tokens.
- [x] **P7-4 · Efficiency profile page.** Public `/u/<handle>`: PRs shipped ÷ tokens,
      contribution-graph style, beautiful (Linear-grade). _Accept:_ renders from imported data;
      proud-to-share.
- [ ] **P7-5 · Share + OG image.** `@vercel/og` renders the graph as a PNG; share-to-X/
      LinkedIn buttons. _Accept:_ sharing a profile produces a rich card image.
- [ ] **P7-6 · Bulk import.** Let a new user import all past local sessions (all tools) at
      signup. _Accept:_ one command/flow imports history into the profile.

## Phase 8 — Storage phase 2 & infra _(depends: P0-4)_

- [ ] **P8-1 · Transcripts → object storage.** Move JSONL bodies to R2/Spaces; Neon keeps
      metadata + FTS index + a pointer. Stream/sign reads. _Accept:_ new transcripts stored in
      object storage; reads work; Neon rows shrink; migration for existing.
- [ ] **P8-2 · Background job orchestration.** Use **Vercel Workflows** (app's already on
      Vercel, zero infra) for most async work; stand up **Temporal OSS** on the droplet for
      heavy/long-running orchestration (bulk imports, profile builds, the redaction pipeline).
      _Accept:_ heavy jobs run off the request path with durability + retries; choice documented
      per workload.
- [x] **P8-3a · Close unneeded ports.** Firewall now allows **only 22 / 80 / 443 + ICMP**
      (port 3000 removed). Applied via `infra/index.ts` + `pulumi up`. Only necessary ports open.
- [ ] **P8-3 · Lock down the droplet (infra-only).** It must be reachable **only by the Vercel
      app and the admin/agent — nobody else**. **For today, a shared bearer token is enough:**
      every service sits behind **Caddy on 443 with TLS + a bearer token** (the token lives in
      Vercel env), so the open 443 is useless without the secret. _Accept (today):_ services
      reject any request lacking the token; only 22/80/443 open; token documented in
      `stack-and-access.md`. _Hardening follow-ups:_ allowlist SSH (22) to admin IP(s); add a
      Vercel dedicated-egress-IP allowlist or a private tunnel (Tailscale/Cloudflare). Keep the
      admin's own access intact — don't lock ourselves out.

## Phase 9 — Landing page & first impression _(end of each run; depends: features exist to show)_

- [ ] **P9-1 · Redesign the landing page.** Make it more beautiful and more _attractive to
      both agents and humans_: lead with "the repository of agents' thoughts" + the review/
      takeover demos; show a real efficiency-profile graph; Linear-grade polish. Before-state is
      captured in `screenshots/before/`. _Accept:_ side-by-side before/after screenshots in
      `screenshots/`; faster, clearer, more striking than the current page; mobile-clean.
- [ ] **P9-2 · Agent-facing quickstart.** A section/page that sells the CLI + skill to agents
      (copy-paste setup, "your agent can shell out to orchid"). _Accept:_ an agent could onboard
      from this page alone.
- [ ] **P9-3 · Capture after-screenshots of every improved surface.** _Accept:_
      `screenshots/after/` mirrors `before/` for dashboard, session viewer, search, decisions,
      landing — for the before/after story.

## Continuous — orchestrator self-improvement _(always-on, lowest priority when others pending)_

- [ ] **C-1 · Speed audit loop.** Periodically browse the app headed, measure click latency,
      file the worst offender as a new P4 task in this list. _Accept:_ worklog records findings.
- [ ] **C-2 · Beauty/UX audit.** Compare against Linear; file polish tasks.
- [ ] **C-3 · Bug sweep.** Run flows, capture errors/console, file fixes.
  - _Open finding (2026-06-14):_ session/dashboard pages log **React #418 (hydration text
    mismatch)** in prod console — almost certainly the time renderers (`toLocaleString()` /
    `timeAgo()` / `formatDuration`) computing different values server vs client. Non-breaking
    but noisy. Fix: render times client-only or with `suppressHydrationWarning` / a stable
    server-formatted string. (Not a P3-1 regression — summary text is identical SSR/client.)
- [ ] **C-4 · Dogfood review loop.** Use Orchid's own review on its own PRs into
      `orchestrator`; record whether context helped.

---

### Sequencing note

Phases 0→1→2 are the critical path to the headline demo (fast Claude + private + review
loop). **Phase T (secret redaction) runs in parallel and must land early** — every day
without it adds raw transcripts we'd have to re-scan. 3/4 run alongside. 5 (takeover) and 7
(virality) are the two most _shareable_ demos — prioritize one early for momentum once the
critical path is green.
