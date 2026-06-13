# Orchid — Worklog

> Append-only. Newest at top. Every orchestrator iteration and every meaningful human change
> gets an entry. Format below. This is the shared memory across iterations — read the
> **Patterns** section before starting work.

## Patterns (consolidated learnings — read first)
- Harness is **Claude workflows**, not a bash loop. Bounded agents return; the workflow
  sequences. (ralph harness removed 2026-06-13.)
- Work lands on the **`orchestrator`** branch via PRs; **never `main`**.
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
