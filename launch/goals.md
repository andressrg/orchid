# Orchid — Goals, Guidelines & Constraints

> Living document. The orchestrator and the team both read and update this.
> Last set by Julian + Claude, 2026-06-13.

---

## North Star

**Orchid is the repository of agents' thoughts — and the layer that lets a Claude
orchestrator read every one of them.**

Today, an AI agent's reasoning is invisible the moment it finishes. Claude Code's
Agent View (`claude agents`) is a glimpse of the future — one screen for every
session — but it is **local, single-user, single-tool, and ephemeral**: sessions live
in `~/.claude/jobs/`, stop when the machine shuts down, and no teammate or other agent
can read them.

Orchid is the cloud-native, **org-wide, cross-tool, persistent, access-controlled
Agent View**. We already capture transcripts via hooks. The endgame:

1. **Capture every agent's thoughts** — Claude Code, Codex, Cursor, opencode, Hermes —
   normalized into one session/thought stream, across every machine and teammate.
2. **A Claude orchestrator is the main brain** that can read every agent's thoughts and
   reason, review, and coordinate across all of them — the thing Agent View can't do
   because it's stuck on one laptop.
3. **Orchid is the authority ("the lawyer")** that governs *which* thoughts an
   orchestrator or teammate may read. Private by default; access is brokered, granted,
   shared, and handed off through Orchid. The orchestrator's omniscience is *policy-gated*,
   not a free-for-all.

### The flywheel (this is the moat)

```
   people share their efficiency graphs  ─┐
                                           │  (virality)
   more people sign up & import sessions  ─┤
                                           │
   more agents' thoughts land in Orchid   ─┤  (data network effect)
                                           │
   the orchestrator has richer context    ─┤
                                           │
   reviews / handoffs / answers get better─┘
                  ↑                         │
                  └─────  more value  ──────┘
```

Virality is **not a side feature** — it is the growth engine that makes Orchid *the*
canonical repository of agents' thoughts. The public **efficiency profile** (PRs shipped
÷ tokens burned, traces.com-style but for *shipping*, not for burning tokens) is how we
recruit thoughts at scale. Every shared graph is a billboard that pulls in more sessions.

---

## The one feature that delivers 80% of the value

**Conversation-aware code review for agents.**

A reviewing agent, before it writes a single review comment, asks Orchid:
*who built this, across which sessions, and why?* — then reviews against intent, not just
the diff.

```
agent opens / reviews a PR
  → orchid sessions-for <all PR commits>      (every commit knows its session)
  → reads WHY each change was made            (the building agents' thoughts)
  → asks Orchid fast follow-ups               (Claude, < 2s)
  → can rewind / take over a building session (the CLI is for agents)
  → posts a review grounded in intent
```

This single loop forces us to ship almost everything that matters:

- **commit ↔ session links** (a PR is many sessions from many agents)
- **private-by-default + explicit share/handoff/takeover** (the ACL / "lawyer" layer)
- **fast Claude summaries generated automatically when a session ends**
- **a polished CLI + agent skill** (the agent-facing surface — primary user)
- **the PR webhook** (Orchid's own review bot) *and* the skill your agents invoke

> **Primary user = agents. Humans are the secondary user.** The CLI and skill are the
> product surface; the web UI is for humans to observe, share, and govern.

---

## Flagship workflows (the demos people remember)

### 1. Conversation-aware review (the 80% feature, above)

### 2. Session takeover / handoff — "I'm blocked, take it from here"

A teammate is stuck mid-session. They send a **one-line command**. You run it on **your**
machine and continue *exactly* where they left off — full context, right branch, right
state — because Orchid has the thoughts and brokers the access.

```
# Blocked teammate (or a button in the web UI) generates a share+takeover link:
$ orchid share <session-id> --takeover
  → "Send this:  orchid takeover ab12cd"

# You, on your computer:
$ orchid takeover ab12cd
  ↳ verifying access (Orchid is the authority)        ✓
  ↳ pulling 47 turns of context                       ✓
  ↳ git fetch + checkout feat/payments @ a39f1c        ✓
  ↳ rehydrating local session…                         ✓
  ↳ launching claude --resume — you have the wheel.
```

What it does under the hood: Orchid grants you read+continue access, downloads the
transcript, reconstructs the local Claude Code session (`~/.claude/projects/.../<id>.jsonl`
+ `claude --resume`), fetches/checks out the exact branch and commit, and hands you a live
session. The original is marked **handed-off** (chain tracked: who built it, who took over,
when). This is **portability (bring a session to another machine) + takeover + the access
layer**, all in one command. It's also how a reviewer can *rewind* and rebuild differently.

### 3. Public efficiency profile — the shareable graph (the flywheel)

Sign up with GitHub → import past sessions → link sessions ↔ commits ↔ merged PRs →
a beautiful public page: **PRs shipped ÷ tokens burned**, contribution-graph style. One
click shares to X / LinkedIn with an auto-generated image. Every share recruits more
thoughts into Orchid.

---

## Strategic pillars (everything maps to one of these)

| # | Pillar | Why it matters |
|---|--------|----------------|
| 1 | **Conversation-aware agent review** | The 80% feature. The reason Orchid exists. |
| 2 | **Capture everything, every tool** | Finish Codex; add Cursor, opencode, Hermes. One normalized thought stream. |
| 3 | **Private by default + the access layer** | Orchid is the authority over who reads which thoughts. Share / handoff / takeover. |
| 4 | **Speed everywhere** | Every click < 200ms. Instant nav, empty states, no needless server round-trips. |
| 5 | **Fast Claude intelligence** | Summaries/turnovers/Q&A on the best Claude model, auto-generated on session end. |
| 6 | **Remote control + portability** | Drive a session from anywhere; bring a session to another machine. (Agent View is local — we make it global.) |
| 7 | **Virality flywheel** | Public, beautiful, shareable efficiency profiles. PRs shipped ÷ tokens. Sign up with GitHub. |
| 8 | **Performant storage** | Transcripts out of the hot path; fast search; Neon as index, object storage for bodies. |

---

## Guidelines

- **Code style:** functional, no mutation, no `useEffect`, no `any`/`unknown`, typed
  `readonly` interfaces, descriptive names, table-qualified SQL, object params for
  multi-arg domain functions. (Canonical rules in `AGENTS.md`.)
- **Speed is a feature, not a metric.** If a click feels slow, it *is* slow — fix it.
  Prefer server components reading the DB directly, optimistic UI, and `after()` for
  background work. Batch DB writes (one multi-VALUES INSERT, never a loop).
- **Writes are dumb-simple and instant.** Capture/sync must be the simplest, fastest path
  possible — **no re-uploading the whole transcript every 5s**. Append/stream deltas,
  minimal server work on write, redaction inline but cheap. The exact mechanism is the
  **orchestrator's to design**; the bar is: writing never feels slow and never blocks the
  user's agent.
- **Claude is the brain.** Replace OpenAI `gpt-4o-mini` everywhere with the best available
  Claude model. Stream where the user waits. Pre-compute (on session end) where they don't.
- **Private by default.** No teammate or agent sees another's session unless it was
  shared, handed off, or taken over — all brokered through Orchid. Team dashboards show
  *aggregate* stats, not content, unless shared.
- **Never store users' secrets.** Redact secrets **locally in the CLI before upload**
  (local-first); the server re-scans and stores only redacted, canonical transcripts.
  Raw secrets never become canonical. This is both a trust promise and what makes "capture
  everything" safe enough to feed the flywheel. (Phase T.)
- **Design:** interfaces like **Linear** (calm, dense, fast). CLI like the **Claude Code
  TUI**. The public profile must be something you're *proud* to post on X / LinkedIn.
- **The CLI is the API for agents.** Every capability an agent needs is a shell command;
  no special integration required.

## Constraints

- **Harness = Claude workflows.** No bash loops. Bounded agents return; the workflow owns
  sequencing and persistence. (The ralph harness has been removed.)
- **Branching:** the orchestrator works on the long-lived **`orchestrator`** branch and
  may merge its own work there freely. It **never touches `main`** — humans promote.
- **Hosting now:** Vercel (web + API) + Neon (Postgres). The DO droplet (`orchid-deploy`,
  4 vCPU / 8 GB, Docker + Caddy) is available for Redis, background jobs, object storage,
  and running the orchestrator persistently.
- **Storage path:** optimize Neon first (stop selecting transcript, FTS index, paginate,
  cache) → then move transcript bodies to object storage with Neon as the search index.
- **Don't break capture.** Hooks + sync are the lifeblood; changes must keep transcripts
  flowing and crash-safe.

---

## What "launched" means (definition of done for v1)

- [ ] A reviewing agent can resolve any PR's commits → sessions → intent, ask fast
      Claude-powered follow-ups, and post a grounded review. (Pillar 1)
- [ ] Sessions are **private by default**; sharing, handoff, and takeover work. (Pillar 3)
- [ ] Session summaries are generated **automatically on session end**, fast, with Claude. (Pillar 5)
- [ ] Every primary click in the web UI feels instant, with real empty states. (Pillar 4)
- [ ] Codex capture is finished; at least one more tool (Cursor *or* opencode) works. (Pillar 2)
- [ ] **Sign up with GitHub** + a public, shareable efficiency profile with an auto-generated
      share image. (Pillar 7)
- [ ] Search is fast (FTS, not `ilike` full-scan) and transcripts are off the hot read path. (Pillar 8)

## Success metrics

- **Speed:** p95 interaction < 200ms; session-summary latency < 2s; search < 300ms.
- **Adoption (the flywheel):** profiles created, graphs shared externally, sessions
  imported per new signup, % of PRs that get an Orchid-grounded review.
- **Value:** review turnaround time ↓; "why was this built?" answered without asking a human.

---

## Also for Snappr

Orchid is dogfood-able at Snappr as-is (team capture + review). Keep the door open for
SSO and self-host later, but **do not** build multi-tenant complexity that slows v1.
