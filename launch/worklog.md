# Orchid — Worklog

> Append-only. Newest at top. Every orchestrator iteration and every meaningful human change
> gets an entry. Format below. This is the shared memory across iterations — read the
> **Patterns** section before starting work.

## Patterns (consolidated learnings — read first)

- Harness is **Claude workflows**, not a bash loop. Bounded agents return; the workflow
  sequences. (ralph harness removed 2026-06-13.)
- Each task: branch off **`main`** → PR → **squash-merge to `main`** (`gh pr merge --squash --delete-branch`) → Vercel auto-deploys prod. Previews are **PR-driven** — never the `vercel` CLI (read-only babysitting only).
- AI must run on **Claude** (`web/app/lib/ai.ts`, once P0-1 lands), not OpenAI.
- Sessions are **private by default** after P1-1 — don't reintroduce team-wide reads.
- SQL columns are **table-qualified**; code is **functional** (no loops/mutation/`any`).
- Quality gate per task: `bash check.sh` + tests + headed-browser verify for UI.
- **Authed preview verify is blocked by "Invalid origin"** (Better Auth `trustedOrigins`); until S-0 fixes it, verify authed flows on **prod** (login works) with revert-ready discipline. `bash check.sh` does NOT run web vitest — run `cd web && pnpm test` separately.

---

## Entry format

```
## YYYY-MM-DD HH:MM — [TASK-ID or topic]
- What changed / shipped
- Files touched · PR link
- Result: pass/fail, metrics if relevant
- Learnings (promote reusable ones to Patterns above)
```

---

## 2026-06-14 — Profile polish shipped (#66): year-aware range + #63 recovered

- **#66 live + verified on prod:** (1) heatmap range label now shows the year on multi-year
  spans — `/u/juliankmazo` reads **"Jun 12, 2025 – Jun 13, 2026"** (was the confusing year-less
  "Jun 12 – Jun 13"). (2) **Recovered #63** (the bad-rebase-closed Link-GitHub settings) via
  cherry-pick of `c12c9b6`: Settings → Account → Connected accounts shows **"Connected as
  @juliankmazo" + Unlink**; `account.accountLinking` (trustedProviders github, allowDifferentEmails)
  enables the logged-in different-email merge path. Deleted the `recover/github-link-settings` branch.
- **Virality profile thread COMPLETE:** real GitHub PRs (215), 0.8 PR/MTok LEAN, full-year
  contribution heatmap (256 active days), year-aware range, GitHub sign-in + account linking/merge.
- **Next priority (backlog):** **P2-1 / P2-1b commit↔session linking** — the flagship review
  (`/api/review-context`) returns empty in prod because `session_commits` is unpopulated; a git
  post-commit hook (`orchid hooks install`) + backfill from git/GitHub would make the review brief
  (and per-session commits) real. Then P1 privacy, P0-6 write path, P3 auto-summary, P9 landing.

## 2026-06-14 — Full-year GitHub contribution heatmap (#65) + handoff

- **#65 shipped + verified live:** the profile heatmap now reflects the user's REAL GitHub
  contribution calendar (GraphQL `viewer.contributionsCollection.contributionCalendar`, via the
  linked token), not just Orchid sessions. `/u/juliankmazo` → **256 active days** filling the full
  year (was 47), 215 PRs / 0.8 PR-MTok LEAN. Fails safe to Orchid sessions when unlinked.
- **Next-tick / open items (not blocking):**
  1. **Range-label cosmetic:** the heatmap header shows "Jun 12 – Jun 13" — the formatter
     (`monthDay` in `web/app/u/[handle]/page.tsx`) drops the year, so a Jun-2025→Jun-2026 span
     reads like one day. Show the year (or relabel "Last year") when first/last span different years.
  2. **Recover #63 (Settings → Account → "Link GitHub" + accountLinking config).** A bad
     rebase/force-push collapsed the branch to main's HEAD and auto-CLOSED PR #63; the work is
     preserved at commit **c12c9b6** on branch **`recover/github-link-settings`**. Re-create a
     branch off current main from it (resolve any queries.ts/auth.ts overlap with #62/#65) + new PR.
  3. Backlog still open: P2-1/P2-1b commit↔session linking (unlocks the review brief + real
     per-session commits), P1 privacy, P0-6 write path, P3 auto-summary, P9 landing.

## 2026-06-14 — NEXT TICK PICK UP HERE (handoff)

**Shipped + live on prod this session:** #59 flagship conversation-aware review, #60 GitHub
sign-in + real PRs, #61 resilient migrator, #62 real merged-PR count after merge (profile shows
214 PRs / 0.8 PR-MTok LEAN), #64 heatmap colors by sessions+commits.

**Next actions (highest value first):**

1. **Heatmap from REAL GitHub contributions (Julian's ask).** The profile "Shipping activity"
   only lights ~2 months because it's sourced from Orchid SESSIONS (Orchid usage started Apr).
   Julian's GitHub shows 1,325 contributions all year. Now that GitHub is linked, fetch the
   user's **contribution calendar** via GitHub GraphQL (`viewer.contributionsCollection.
contributionCalendar { weeks { contributionDays { date contributionCount } } }`) with the
   linked `account.accessToken` (add `fetchContributionCalendar` to `web/app/lib/github.ts`,
   timeout-bounded, never throws). In `getPublicEfficiencyProfile`: when GitHub-linked, build
   the heatmap `days` (+ activeDays + first/lastActiveDay range) from the GitHub calendar so the
   grid matches GitHub's green graph (full year). Fall back to Orchid sessions when unlinked.
   Update the heatmap tooltip wording ("contributions"). Then verify on prod /u/juliankmazo.
2. **Merge PR #63** (Settings → Account → "Link GitHub" + accountLinking config; rebased onto
   main, gate green). Build #1 off the post-#63 main to avoid queries.ts conflicts.
3. (Noted, non-urgent) The efficiency metric (PRs ÷ Orchid tokens) rewards NOT using AI — Julian
   flagged it half-jokingly. Revisit framing later.

## 2026-06-14 — Real merged PRs after GitHub merge (#62)

- Signing in with GitHub on a same-email account merged correctly but the profile still showed
  "0 PRs" + `@julian`: Better Auth runs `mapProfileToUser` only on user CREATION, not on LINK,
  so `user.githubLogin` stayed empty and the real-PR path was skipped. Fixed: derive the login
  from the linked account's token (GitHub `/user`) when `githubLogin` is empty, backfill it,
  then count merged PRs by that login. **Verified live: `/u/julian` now shows 213 PRs merged,
  0.8 PR/MTok, LEAN tier** (was 0). Self-heals already-merged accounts, no re-login.
- Pattern: Better Auth `mapProfileToUser` does NOT run on account LINK — recover/backfill
  provider profile fields (login/id) lazily from the stored token, or via a link-time hook.

## 2026-06-14 — Flagship review + GitHub sign-in + deploy-hang incident (#59 #60 #61)

- **Flagship: conversation-aware code review for agents (#59, P2-2/P2-3/P2-5)** — `POST
/api/review-context` resolves a PR/branch's commit SHAs → the sessions that built them →
  a Claude-grounded brief (intent · decisions · risks · what the diff won't reveal). CLI
  rewritten: `orchid ask-context`/`orchid review <branch|pr>` (commit-precise, server-side
  Claude, OpenAI removed); skill enforces ask-before-review. Injection boundary tested
  (untrusted transcript only in `messages`, never `system`); tenant-scoped. **Live on prod**
  (`/api/review-context` → 200). Lean review caught + I fixed a real **command-injection**
  blocker: the branch path interpolated an unvalidated branch name into `execSync` →
  switched all git/gh calls to `execFileSync` argv (no shell).
- **GitHub sign-in + real merged-PR counts (#60, P7-1 + partial P7-3)** — Better Auth
  `socialProviders.github` (+ githubLogin/githubId columns, migration `0005`), "Continue with
  GitHub" button, and the profile's `prsMerged` now uses the real GitHub merged-PR count (via
  the linked token, 3s-budget, fails safe to the commit proxy). Answers Julian's "why 0 PRs":
  the proxy = empty `session_commits`; real PRs need the GitHub link. **Needs `GITHUB_CLIENT_ID`
  /`SECRET` in Vercel Prod+Preview env** for sign-in to complete on the deploy.
- **Deploy-hang incident + fix (#61)** — concurrent preview builds (previews share the PROD
  DB) all hit the build-time migrate's blocking `pg_advisory_lock`; a build died holding it
  (Neon pooler kept the connection) → **orphaned lock → every new deploy hung "Building"**
  19–38 min. Prod stayed healthy (nothing shipped). Hardened the migrator: bounded
  `pg_try_advisory_lock` (90s budget) + `statement_timeout` + connect-timeout + self-heal
  (no pending → proceed, pending → fail-fast). The lock later freed (pooler reap); shipped
  #61 → #59 → #60 **sequentially** to avoid re-contending.
- Learnings (→ Patterns):
  - **Build-time migrate + a blocking advisory lock + previews-share-prod-DB = deploy-hang
    risk.** Use a bounded try-lock that self-heals; never an unbounded `pg_advisory_lock` in a
    build step. Real fix later: give previews their own Neon branch DB (stop sharing prod).
  - **The review feature + the profile PR count both depend on `session_commits` being
    populated** — it's empty in prod (commit↔session linking is lossy transcript-regex only).
    P2-1 (git post-commit hook) / P2-1b (backfill from git+GitHub) is the next unlock for both.
  - **Don't merge on a non-green Vercel check** (the #55 lesson) — but a check stuck PENDING on
    a zombie build (vs FAILURE) can be a lock-hang, not a code failure; diagnose via the build log.

## 2026-06-13 — Auto-migrate pipeline + parallel ships (#54 #55 #56 #57 #58)

- **Auto-migrate on deploy (#57)** — modeled on nanosas (`build: "pnpm db:migrate && next build"`
  - `web/scripts/migrate.ts` with a pg advisory lock + a **baseline** shim for the drifted prod).
    Confirmed live: prod build runs the migrator; new migrations self-apply on deploy. Nothing
    auto-migrated before (CI = check.sh, build = next build, `runMigrations()` was dead code; prod
    schema had been `drizzle push`-managed → drift). Julian chose "set up auto-migrate first".
- **P7-4 efficiency profile (#56)** — public `/u/<handle>` (Orchid Efficiency Score = PRs ÷ tokens
  as PR/MTok + tiers, contribution heatmap). **Live on prod**, `/u/julian` → 200.
- **P7-2 token accounting (#54)** — persisted input/output token columns; CLI sends them; backfill.
  Verified in prod: `/api/sessions` returns `input_tokens`/`output_tokens` (proves auto-migrate
  applied the `0003` ALTER to prod).
- **P0-4 FTS (#55 + #58)** — tsvector generated column + GIN index + ranked `websearch_to_tsquery`.
  #55's first prod build FAILED (`to_tsvector` rejects >1MB input; a 2.4MB transcript) — caught by
  the migrator (rolled back, build failed, **prod stayed healthy on the prior deploy**). #58 fixed
  it: `left(coalesce(transcript,''), 250000)` (byte-safe, ~537KB worst-case vector). Deploys
  unblocked.
- Learnings (→ Patterns):
  - **The auto-migrate baseline was too coarse** at first: it baselined ALL migrations when
    `orchid_session` existed, but `session_commits` (0001) had never actually been created on the
    drifted DB → the CREATE was skipped → `/u/<handle>` 500'd ("relation session_commits does not
    exist"). Healed with a corrective **idempotent** `0002_ensure_session_commits` (CREATE IF NOT
    EXISTS). Lesson: a coarse "schema exists → baseline everything" shim can skip a genuinely-missing
    object; corrective idempotent migrations are the safe heal.
  - **CI `check` passes don't prove a migration deploys** — generated-column ALTERs only fail when a
    real row violates a limit (empty test DBs pass). The migrator + a >1MB-transcript scratch DB is
    the real test. **Previews run against the prod DB** (no per-PR Neon branch) — additive migrations
    are safe but worth isolating later.
  - **Parallel worktree agents must each use a unique test DB** (globalSetup drops `orchid_test`'s
    schema). Rebasing parallel migration PRs: take main's `web/drizzle/`, drop the agent's stray
    migration, regenerate via `db:generate` (renumbers cleanly).

## 2026-06-13 22:10 — AI live on Claude in prod (#52) + P0-3 (#53) + parallel push

- **PR #52 (urgent prod fix):** prod AI returned 502 for every session. Root cause (found by a
  bg diagnosis agent reading prod runtime logs): Anthropic 400 "user messages must have non-empty
  content" — the `/summary` + `/decisions` parsers read `obj.content`, but Claude Code transcripts
  nest turns under `obj.message` (`{role, content[]}`). Zero turns → empty payload → 400 → 502.
  OpenAI tolerated it; the Claude swap exposed it. Fixed with a shared `extractTranscriptText`
  helper + `obj.message` parsing + empty-content guard; regression test. Merged → **verified in a
  real headed browser on prod: AI Summary now returns 200 with real Claude output.** Headline goal
  (AI on Claude, working in prod) is live.
- **PR #53 (P0-3):** `getSessionById` metadata-only + `getSessionTranscriptById`; session-detail
  conversation streamed via `<Suspense>` so metadata/AI-summary paint without the JSONL. Lean
  reviewer: SHIP. Merged (`d1733c5`).
- **Parallel push (user: "go fasterrr", prioritize virality + backend in parallel):** launched 3
  **bg worktree agents**, each → its own PR: **P7-2** token accounting (data foundation), **P7-4**
  public efficiency profile page (the shareable flywheel demo), **P0-4** Postgres FTS search.
  Each uses an isolated test DB (`orchid_test_p72/p74/p04`) to avoid clobbering the shared one.
- Learnings (→ Patterns):
  - **Parallel agents must NOT share the `orchid_test` DB** — globalSetup drops/recreates its
    schema, so concurrent `pnpm test` runs corrupt each other. Give each worktree agent a unique
    DB (createdb + point globalSetup/vitest.config at it in-worktree, revert before commit).
  - **CI's `check` job does NOT run web vitest** (only tsc+eslint+CLI tests) — DB-backed web tests
    are a local-only gate, so validate them locally/in-agent before merge.
  - **P7-1 (Sign up with GitHub) is blocked on a GitHub OAuth app** — `GITHUB_CLIENT_ID/SECRET` are
    empty in `.env.orchestrator`. Needs Julian to register the OAuth app (homepage + callback URLs
    in stack-and-access.md) before the virality front door can be built.

## 2026-06-13 21:45 — P0-1 + P0-2: AI on Claude (PR #51)

- Shipped the typed Claude provider (`web/app/lib/ai.ts`: `askClaude` + `streamClaude`,
  readonly typed shapes, injection-safe — `system` is top-level, never a message) and swapped
  summary/chat/decisions to it via one `generateAiText` helper (Claude-first, OpenAI fallback).
- Lean adversarial review caught one real blocker: Claude-path failures fell through to **HTTP
  500** instead of **502** (the OpenAI path threw `AiServiceError`). Wrapped the Claude call so
  both providers map uniformly to 502; added a regression test (`__tests__/api/ai-error-mapping.test.ts`)
  that stubs the key + a failing Anthropic fetch and asserts 502. Updated README + stack-and-access.
- PR #51 → squash-merged to `main` (`a7b9f0b`); branch deleted. CI green; 63 web + 79 CLI tests pass.
- Result: prod `/api/health` → ok. Verified the headline goal in a **real headed browser on prod**
  (logged in with `ORCHID_TEST_EMAIL`): "Generate AI Summary" initially returned **503** because
  `ANTHROPIC_API_KEY` wasn't in Vercel prod env yet (P0-5). **Julian then set the key + redeployed.**
- Learnings (→ Patterns):
  - **Previews aren't browser-verifiable today**: Better Auth `trustedOrigins` only trusts the
    configured `baseURL`, so logging into a preview deploy fails with **"Invalid origin."** That's
    the core of **S-0 (make the verify gate real)** — fix `trustedOrigins` to include Vercel preview
    hosts so authed flows can be tested on previews, not just prod. Until then, verify authed flows
    on **prod** (login works there) with revert-ready discipline.
  - AI features **fail safe**: no key → 503 (summary) / mock (decisions), never a crash. No regression.
  - `generateAiText` reads `ANTHROPIC_API_KEY` at module load → to test the Claude branch, `vi.stubEnv`
    - `vi.resetModules()` + dynamic `import()` of `api-app`.

## 2026-06-13 — docs: PR-driven previews (user correction)

- Clarified across `.claude/loop.md`, `orchestrator-harness.md`, `stack-and-access.md` that previews are created by **opening a PR** (GitHub→Vercel auto-builds preview + Neon branch DB) — **never** the `vercel` CLI. Recorded the real prod Vercel project (`frecuenti/orchid-web`); gitignored `.vercel`. Deleted a stray empty `orchid` Vercel project a bad `vercel link --yes` had created.
- PR #50 — squash-merged to `main`. Docs-only; prod unaffected.
- Result: CI green; prod `/api/health` → `{"status":"ok"}`.
- Learnings (promoted to Patterns): previews & prod deploys are **100% PR/branch-driven**; the `vercel` CLI is read-only babysitting only. Delegate legwork to background agents/workflows to keep the conductor's context clean (user guidance).

## 2026-06-13 — Launch planning & foundation

- Mapped the entire codebase (12-agent deep-map workflow): API/AI, DB/perf, auth/ACL, CLI,
  web UI, infra, skills, in-flight PRs.
- Confirmed key realities: AI on OpenAI gpt-4o-mini (on-demand/blocking); sessions
  team-wide visible (no per-session ACL); transcript in one Neon TEXT column with
  `ilike` search; DO droplet idle; takeover is RFC #17 only (not built).
- Removed the ralph/watchdog harness; switched to Claude workflows (`e819288`).
- Wrote launch docs: `goals.md`, `stack-and-access.md`, `feature-map.md` + `.html`,
  `tasks.md`, `worklog.md`.
- Result: foundation set on branch `orchestrator`. Next: provision secrets (P0-5), then
  execute Phase 0.

## 2026-06-13 — Orchestrator setup

- Settled all run decisions (local conductor, serial + in-task fan-out, Opus/no cap, full
  send, full adversarial-review gate verified on Vercel preview, ping-then-2min-assume).
- Conductor scaffolding: `.claude/loop.md`, `.husky/pre-push` (main-guard), kill switch + lock.
- Validated local build env: docker Postgres up + schema applied (`bash check.sh` baseline).
- Positivity pass across all docs; "everything is possible" mindset added to `AGENTS.md`.
- Captured before-screenshots (landing, login, dashboard, session, search, activity).
- Opened **PR #49** (`orchestrator` → `main`) so progress is reviewable.
- Droplet: Pulumi `dev` stack created in the **personal org** (`juliankmazo/orchid-infra`),
  preview clean (SSH key + droplet + firewall). `pulumi up` returned **401 from DO** — the
  provided token is well-formed but rejected; next attempt uses a freshly generated DO token,
  then the droplet comes up.
- Next: fresh DO token → `pulumi up`; accept `bypassPermissions`; supervised dry-run of one task.
