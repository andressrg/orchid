# Orchestrator Harness — design for 12h autonomous runs

> **Status: PROPOSAL — review together before launch.** This is the setup that drives
> `tasks.md` autonomously using Claude workflows (no bash loop). Open decisions are at the
> bottom; nothing launches until we agree on them.

---

## The shape: a Conductor that fans out per task

```
┌─────────────────────────────────────────────────────────────┐
│ CONDUCTOR  (one Claude Code session, /loop, local Mac)        │
│  each iteration:                                              │
│   0. rebuild orchid CLI (dogfood latest)                     │
│   1. git fetch; checkout main; pull; branch task/<slug>      │
│   2. read goals.md + tasks.md + tail worklog.md (Patterns)   │
│   3. pick highest-priority task whose deps are met           │
│   4. build it; fan out workflow / subagents ──────┐          │
│   5. full-gate green → squash-merge PR → main      │          │
│      → Vercel deploys prod; confirm health         │          │
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
        │  • Verify on the VERCEL PREVIEW (always): check.sh  │
        │    + tests + headed browser + CLI vs the preview URL│
        │  • Review (parallel, adversarial — see below)       │
        │  • Loop: fix every blocking finding, re-review,     │
        │    repeat until only nice-to-haves remain           │
        │  • PR → squash-merge to `main` → deploy prod; the   │
        │    Claude GitHub app reviews with Orchid context    │
        │  • Output: structured verdict {green|red, summary}  │
        └─────────────────────────────────────────────────────┘
```

### Adversarial review gate (baked into EVERY task)

No task is "done" until it survives this. Each task spawns **2–3 reviewer agents in
parallel**, each with a distinct hostile lens, instructed to find reasons to reject:

| Reviewer                 | Lens                                                                               | Must actually do                                |
| ------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Security**             | injection, authz/ACL leaks (esp. private-by-default), secret exposure, unsafe SQL  | read the diff; probe the running app/CLI        |
| **Performance**          | extra DB round-trips, N+1, over-fetch, >200ms clicks, blocking AI calls            | **spin up a browser**, click through, measure   |
| **Quality & simplicity** | functional-style compliance, dead code, **is this the SIMPLEST possible version?** | **exercise the CLI**, read for over-engineering |

Rules:

- Reviewers **run the feature against the Vercel preview deployment**: open a headed browser
  and click it on the preview URL, and run the affected `orchid` CLI commands — not just read
  the diff.
- The implementer **iterates** on each round, fixing every _blocking_ finding, until the
  reviewers return **only nice-to-have** comments. Simplicity wins ties — always prefer the
  smaller, plainer implementation.
- Once green and merged-to-`orchestrator`, the PR is also reviewed **on GitHub by the Claude
  GitHub app wired to Orchid** (so it reviews with full conversation context — this is us
  dogfooding the 80% feature on our own PRs). Its findings feed the next iteration.

**Why this shape:** the loop driver is native Claude Code (`/loop` + background session,
which survives detach/sleep and shows live in `claude agents`). The _unit of work_ is a
**Workflow** — that's the harness you asked for: deterministic fan-out, parallel verify,
adversarial review, structured verdicts. The conductor stays small and never holds large
context — it delegates each task to a fresh workflow.

## Where it runs (two separate things — don't conflate)

- **Conductor → local (this Mac), local-first.** All the tooling is already here and authed:
  `claude`, `gh`, `vercel`, `neonctl`, `pulumi`, Docker (`docker-compose.yml`), the browser.
  The conductor builds against a **local dev DB**, runs under `tmux` with `bypassPermissions`
  (accepted once), and stays alive for the full run (sleep is already disabled on this Mac).
- **GitHub drives previews.** The orchestrator commits with `gh` (no token) and **pushes
  branches to GitHub**; each push **auto-updates that branch's Vercel preview + a Neon branch
  DB**. That preview is what every task is verified against. Nothing to set up — just push.
- **Droplet (`orchid-deploy`) → the agent's services sandbox.** Where the agent freely
  installs/runs whatever it needs: Redis (cache/presence), **Temporal OSS** / a job queue,
  object storage (MinIO), scratch DBs. SSH via `~/.ssh/orchid-agent`. Docker + Caddy ready.
- **Prod** is updated at **promotion** — humans merge `orchestrator` → `main`, Vercel deploys.

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

1. **Turn-level (built-in):** the scheduler _"fires between your turns, not while Claude is
   mid-response. If Claude is busy when a task comes due, the prompt waits until the current
   turn ends."_ And there is _no catch-up_ for missed fires. So as long as the conductor
   **awaits its workflow within the turn**, the next iteration only starts after the current
   one finishes. Iterations are serial by construction.
2. **Dynamic schedule, single conductor:** we run **one** `/loop` in **dynamic** mode (not a
   fixed cron), so the next wake is only scheduled _after_ the current task is done + merged.
   Never run two conductors.
3. **Lock file (belt & suspenders):** each iteration acquires `launch/.orchestrator.lock`
   (pid + timestamp) at the start and releases it at the end. If a fresh, non-stale lock
   exists, the iteration exits immediately ("previous still running"). Guards against any
   edge case (e.g., a backgrounded workflow, an accidental second loop).

**Lifecycle notes (from the docs):** `/loop` is **session-scoped** — it only fires while
the Claude Code session is **running and idle**, so the conductor must stay alive (run it
**locally in `tmux`**; sleep is already disabled on this Mac). Recurring tasks **expire after
7 days** (fine for a 12h run) and are restored on `claude --resume`. If we ever need it to
survive the machine being off, the durable alternatives are **Routines** (Anthropic cloud),
**GitHub Actions**, or **Desktop scheduled tasks**.

## Execution model: serial tasks, parallel _within_ a task

- **Serial across tasks** (recommended): one feature at a time → clean, conflict-free merges
  into `orchestrator`. The 12h throughput comes from each task's workflow fanning out
  internally (parallel edits, parallel verify, multi-agent review), not from many half-built
  features racing into one branch.
- **Optional 2-lane parallelism:** a backend lane and a UI-polish lane in separate worktrees,
  if we want more concurrency and accept occasional merge conflicts. Off by default.

## Guardrails (what makes 12h unattended safe)

| Risk                       | Guard                                                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shipping broken prod       | No squash-merge to `main` unless the **full gate** is green: `check.sh` + tests + **CI green** + headed browser + CLI + 2–3 adversarial reviewers. **Babysit the PR** — wait for CI, fix failures, run bg review/test agents — until green. |
| A bad deploy reaching prod | After merge, **curl `/api/health`** on prod; if it breaks, `git revert` + redeploy fast. The human is monitoring.                                                                                                                           |
| One task resisting         | Keep trying fresh approaches; if it isn't cracking now, **park it** (log approaches tried + next idea), pick another task, revisit later. Never declare it undoable.                                                                        |
| Runaway cost               | **Budget is not a constraint** (decision) — use Opus/best models freely.                                                                                                                                                                    |
| Stopping it                | **Kill switch:** loop checks for `launch/STOP` each iteration and exits if present. Also `claude stop <id>` / `claude daemon stop`.                                                                                                         |
| Corrupting the tree        | Each task builds in its own `.claude/worktrees/` worktree.                                                                                                                                                                                  |
| Leaking secrets            | `.env*`/`.secrets` gitignored; never committed; transcript redaction is server-side at ingest (Phase T).                                                                                                                                    |
| Flying blind               | `worklog.md` is the human trace; Orchid captures the orchestrator's **own** sessions (dogfood — watch it in Orchid); `claude agents` shows live status + PR colors.                                                                         |
| Process dies               | Tasks are independent PRs; on restart the conductor re-reads `tasks.md` and continues. Stateless except git + docs.                                                                                                                         |

## Pre-launch checklist

- [x] `ANTHROPIC_API_KEY` + `DIGITALOCEAN_TOKEN` in `.env.orchestrator` (gitignored). `vercel`/
      `neonctl`/`gh` already authed locally.
- [x] Local dev DB up (`docker compose up`, schema applied); `bash check.sh` green.
- [x] Kill switch (`launch/STOP`) + lock file ready. (Loop squash-merges to `main` via `gh`.)
- [x] Browser ready for headed UI tests (Playwright working here).
- [ ] Droplet recreated via `pulumi up` (DO token present); reachable as the services sandbox.
- [ ] `bypassPermissions` accepted once locally (sleep already disabled, so it stays alive).
- [ ] First dry-run of ONE task end-to-end (build → push → preview → review → merge) watched live.

## Settled decisions (2026-06-13)

1. **Conductor location:** **local** (this Mac; sleep already disabled). Builds locally,
   tests on Vercel preview (below). Droplet = services sandbox.
2. **Parallelism:** **serial tasks + in-task fan-out** (clean merges).
3. **Model & budget:** **Opus for everything** (Fable not available on the account); best
   models freely. **No budget cap** — budget is not a constraint.
4. **Merge bar:** **full gate** — `check.sh` + tests + **CI green** + headed browser + CLI +
   2–3 adversarial reviewers (only nice-to-haves remain) → **squash-merge the PR into `main`**
   → Vercel deploys prod. **Babysit the PR** until CI is green (fix failures, run bg
   review/test agents). The user gave explicit permission to merge + deploy; the human
   monitors and reverts fast. **Always squash-merge.**
5. **Browser:** headed, runs **locally** (conductor is local), pointed at the preview URL.
6. **Check-ins:** **ping on a decision/blocker, wait ~2 min; if no reply, proceed with the
   best assumption and log it** to `worklog.md`. Otherwise hands-off.
7. **Scope:** **full send** — run the whole `tasks.md` top-to-bottom (highest priority first).

### Always test the Vercel preview (decision 4 detail)

Every task's verify + adversarial review runs against the **Vercel preview deployment** of
the branch — the real deployed app, not localhost. Flow: build locally → **push the task
branch to GitHub** → that push **auto-builds a Vercel preview + a Neon branch DB** → headed
browser + CLI tests + reviewers hit the **preview URL**; **babysit the PR** (wait for CI, fix
failures, run bg review/test agents) → on full-gate green, **squash-merge into `main`** →
Vercel deploys prod. Nothing to provision — the repo↔Vercel↔Neon wiring updates on push.

## Remaining to unblock the first run

- [x] `ANTHROPIC_API_KEY` + `DIGITALOCEAN_TOKEN` provided (in `.env.orchestrator`).
- [ ] **Recreate the droplet:** `pulumi up` (one open item — which Pulumi org: the existing
      `snappr/orchid-infra/dev` stack, or a personal org?).
- [ ] Confirm `bypassPermissions` accepted, then run the supervised dry-run task.
