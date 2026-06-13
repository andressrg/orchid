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
