# Orchestrator Harness — design for 12h autonomous runs

> **Status: PROPOSAL — review together before launch.** This is the setup that drives
> `tasks.md` autonomously using Claude workflows (no bash loop). Open decisions are at the
> bottom; nothing launches until we agree on them.

---

## The shape: a Conductor that fans out per task

```
┌─────────────────────────────────────────────────────────────┐
│ CONDUCTOR  (one Claude Code session, /loop, on the droplet)   │
│  each iteration:                                              │
│   1. git fetch; checkout orchestrator; pull                  │
│   2. read goals.md + tasks.md + tail worklog.md (Patterns)   │
│   3. pick highest-priority task whose deps are met           │
│   4. run a WORKFLOW for that task  ───────────────┐          │
│   5. if verdict=green → merge PR into orchestrator │          │
│   6. append worklog.md; tick tasks.md; commit      │          │
│   7. loop (when tasks dry → run C-* audit tasks)   │          │
└────────────────────────────────────────────────────┼─────────┘
                                                       ▼
        ┌──────────────── PER-TASK WORKFLOW ─────────────────┐
        │ Implement → Verify → Review → open PR              │
        │  • Implement: agent(s) build in a git worktree      │
        │    (functional style, meet acceptance criteria)     │
        │  • Verify: bash check.sh + pnpm test + headed       │
        │    browser check for UI; capture pass/fail          │
        │  • Review: adversarial multi-lens (correctness,     │
        │    perf, style-compliance, security) — and dogfood  │
        │    Orchid's own review once P2 lands                │
        │  • Output: PR into `orchestrator` + structured      │
        │    verdict {green|red, summary, evidence}           │
        └─────────────────────────────────────────────────────┘
```

**Why this shape:** the loop driver is native Claude Code (`/loop` + background session,
which survives detach/sleep and shows live in `claude agents`). The *unit of work* is a
**Workflow** — that's the harness you asked for: deterministic fan-out, parallel verify,
adversarial review, structured verdicts. The conductor stays small and never holds large
context — it delegates each task to a fresh workflow.

## Where it runs

The **DO droplet** (`orchid-deploy`, 4 vCPU / 8 GB, Docker, Claude + Codex preinstalled),
so it keeps running for 12h regardless of your laptop. The repo is cloned there on the
`orchestrator` branch; the conductor runs under `tmux` (or as a background session) with
`bypassPermissions` (accepted once interactively).

## Execution model: serial tasks, parallel *within* a task

- **Serial across tasks** (recommended): one feature at a time → clean, conflict-free merges
  into `orchestrator`. The 12h throughput comes from each task's workflow fanning out
  internally (parallel edits, parallel verify, multi-agent review), not from many half-built
  features racing into one branch.
- **Optional 2-lane parallelism:** a backend lane and a UI-polish lane in separate worktrees,
  if we want more concurrency and accept occasional merge conflicts. Off by default.

## Guardrails (what makes 12h unattended safe)

| Risk | Guard |
|------|-------|
| Touching `main` | Prompt forbids it **+** a `pre-push` hook that rejects pushes to `main`. Only `orchestrator` and feature branches. |
| Merging broken code | No merge unless `check.sh` + tests + browser + self-review are green. |
| Looping forever on one task | Max 2–3 attempts; then mark task `blocked` in `tasks.md`, log why, move on. |
| Runaway cost | Token/$ budget cap per run; model tier per task (build vs. mechanical vs. summary); stop when budget hit. |
| Can't stop it | **Kill switch:** loop checks for `launch/STOP` each iteration and exits if present. Also `claude stop <id>` / `claude daemon stop`. |
| Corrupting the tree | Each task builds in its own `.claude/worktrees/` worktree. |
| Leaking secrets | `.env`/`.secrets` gitignored; never committed; transcripts' secret-redaction tracked separately (PR #40). |
| Flying blind | `worklog.md` is the human trace; Orchid captures the orchestrator's **own** sessions (dogfood — watch it in Orchid); `claude agents` shows live status + PR colors. |
| Process dies | Tasks are independent PRs; on restart the conductor re-reads `tasks.md` and continues. Stateless except git + docs. |

## Pre-launch checklist

- [ ] Secrets on droplet + Vercel: `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `DATABASE_URL`,
      GitHub OAuth, Resend (P0-5).
- [ ] Repo cloned on droplet, `orchestrator` branch, `pnpm install`, `bash check.sh` green.
- [ ] `bypassPermissions` accepted once on the droplet.
- [ ] Browser for headed UI tests installed (Playwright + Chromium; `xvfb` for headed on a
      headless server — or decide headless is acceptable server-side; see decisions).
- [ ] `pre-push` hook blocking `main` installed.
- [ ] Kill switch (`launch/STOP`) + budget cap configured.
- [ ] A first dry-run of ONE task end-to-end (build → verify → PR → merge) watched live.

## Open decisions (let's settle these together)

1. **Run location:** droplet (persistent, recommended) — confirm? Or local for the first
   supervised run, then move to droplet?
2. **Parallelism:** serial-with-in-task-fanout (recommended) vs. 2 parallel lanes?
3. **Model tier & budget:** which Claude model for building (Opus?) vs. mechanical edits vs.
   summaries (Haiku); and the $/token cap for the 12h run?
4. **Merge bar into `orchestrator`:** auto-merge on green = check.sh + tests + browser +
   self-review. Agree on that exact bar?
5. **Headed vs. headless browser on the server:** install `xvfb` to honor "always headed", or
   allow headless on the droplet (headed locally when you're watching)?
6. **Check-ins:** want a worklog summary / notification every N hours, or fully hands-off
   until you look?
7. **First-night scope:** restrict the first 12h run to Phase 0 + Phase 1 (foundation +
   privacy) so we validate the harness on lower-risk work before it touches the review loop?
