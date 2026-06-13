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
