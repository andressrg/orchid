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
        │ Implement → Verify → 2–3 ADVERSARIAL REVIEWERS →    │
        │   iterate until reviews are only nice-to-haves →    │
        │   open PR → Claude+Orchid reviews it on GitHub      │
        │                                                     │
        │  • Implement: agent(s) build in a git worktree      │
        │    (functional, SUPER SIMPLE, meet criteria)        │
        │  • Verify: bash check.sh + pnpm test + headed       │
        │    browser + exercise the CLI end-to-end            │
        │  • Review (parallel, adversarial — see below)       │
        │  • Loop: fix every blocking finding, re-review,     │
        │    repeat until only nice-to-haves remain           │
        │  • PR into `orchestrator`; the Claude GitHub app    │
        │    (with Orchid context) posts the final review     │
        │  • Output: structured verdict {green|red, summary}  │
        └─────────────────────────────────────────────────────┘
```

### Adversarial review gate (baked into EVERY task)

No task is "done" until it survives this. Each task spawns **2–3 reviewer agents in
parallel**, each with a distinct hostile lens, instructed to find reasons to reject:

| Reviewer | Lens | Must actually do |
|----------|------|------------------|
| **Security** | injection, authz/ACL leaks (esp. private-by-default), secret exposure, unsafe SQL | read the diff; probe the running app/CLI |
| **Performance** | extra DB round-trips, N+1, over-fetch, >200ms clicks, blocking AI calls | **spin up a browser**, click through, measure |
| **Quality & simplicity** | functional-style compliance, dead code, **is this the SIMPLEST possible version?** | **exercise the CLI**, read for over-engineering |

Rules:
- Reviewers **run the feature**: open a headed browser and click it, and run the affected
  `orchid` CLI commands — not just read the diff.
- The implementer **iterates** on each round, fixing every *blocking* finding, until the
  reviewers return **only nice-to-have** comments. Simplicity wins ties — always prefer the
  smaller, plainer implementation.
- Once green and merged-to-`orchestrator`, the PR is also reviewed **on GitHub by the Claude
  GitHub app wired to Orchid** (so it reviews with full conversation context — this is us
  dogfooding the 80% feature on our own PRs). Its findings feed the next iteration.

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

## How `/loop` works & how we prevent overlap

`/loop` is a bundled Claude Code skill that re-runs a prompt on a schedule. Two modes:
**fixed interval** (`/loop 15m …` → a cron job) or **dynamic** (`/loop …` with no interval →
Claude picks the next delay, 1–60 min, after each iteration, and can stop itself when done).
Within an iteration, a normal turn runs — so **yes, an iteration can call the Workflow tool
and spawn subagents** (that's exactly our per-task workflow). We use a custom default prompt
via **`.claude/loop.md`** (the conductor prompt).

**Can iterations run workflows?** Yes. Each `/loop` fire is a turn; the conductor calls
`Workflow` inside it. We make the conductor **await the workflow** so the turn doesn't end
until the task's workflow completes.

**Preventing overlap — three layers:**
1. **Turn-level (built-in):** the scheduler *"fires between your turns, not while Claude is
   mid-response. If Claude is busy when a task comes due, the prompt waits until the current
   turn ends."* And there is *no catch-up* for missed fires. So as long as the conductor
   **awaits its workflow within the turn**, the next iteration cannot start until the current
   one finishes. Iterations are serial by construction.
2. **Dynamic schedule, single conductor:** we run **one** `/loop` in **dynamic** mode (not a
   fixed cron), so the next wake is only scheduled *after* the current task is done + merged.
   Never run two conductors.
3. **Lock file (belt & suspenders):** each iteration acquires `launch/.orchestrator.lock`
   (pid + timestamp) at the start and releases it at the end. If a fresh, non-stale lock
   exists, the iteration exits immediately ("previous still running"). Guards against any
   edge case (e.g., a backgrounded workflow, an accidental second loop).

**Lifecycle caveats (from the docs):** `/loop` is **session-scoped** — it only fires while
the Claude Code session is **running and idle**, so the conductor must stay alive (run it in
`tmux` / a background session on the droplet). Recurring tasks **expire after 7 days** (fine
for a 12h run) and are restored on `claude --resume`. For runs that must survive the machine
being off, the durable alternatives are **Routines** (Anthropic cloud), **GitHub Actions**, or
**Desktop scheduled tasks** — out of scope for the droplet setup but noted.

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
