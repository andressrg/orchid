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
- **Authed preview verify now WORKS** (S-0, #71, `f230773`) — Better Auth trusts the per-deploy Vercel hosts (`VERCEL_URL`/`VERCEL_BRANCH_URL`), so **log into the PR's preview URL** with `ORCHID_TEST_EMAIL`/`PASSWORD` and verify there. The acceptance test for an auth-touching change is "login succeeds on the preview AND prod login still works." (Was "Invalid origin" on every preview pre-S-0.) `bash check.sh` does NOT run web vitest — run `cd web && pnpm test` separately.
- **`status: 'done'` is NOT a one-shot signal** — the Stop hook (`cli/.../hooks.ts`) and every `orchid sync` resend `done` many times per session. Any on-`done` server work (summaries, key-moments, notifications) MUST be idempotent: gate the write (`!existing` + `WHERE col IS NULL`), never re-run the model on a repeat. Model the commit-extraction `after()` (ON CONFLICT DO NOTHING).
- **`ON CONFLICT … DO UPDATE` preserves columns it doesn't SET**, so the upsert's `RETURNING *` row is a reliable "already computed?" check without a second query.
- **Access control is private-by-default + scoped: a user sees a session IFF `user_id=me` OR `(team_id=myTeam AND visibility='team')` OR `(a non-expired session_share to me)`** (P1, #72/#73). THREE mirrored read-scope helpers — API `scopeConditions` + raw-SQL `sessionReadScopeSql`, SSR `visibleSessionScope`. When touching ACL: sweep EVERY read path; the central helper misses raw `pool.query` reverse-lookups (`/commits/sessions`, `/review-context`). **Destructive/write routes MUST gate on ownership (`requireSessionOwner`), NEVER on the read scope** — `scopeConditionForId` is derived from the read scope, so reusing it for DELETE/POST silently lets read-grantees mutate the owner's data (caught in #73 review). Always run an **adversarial security reviewer told to write a real exploit test** — that's what caught both the "out of scope" leak (#72) and the read-grant→delete escalation (#73).

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

## 2026-06-14 — P1-4 aggregate-only dashboard (#75) — PRIVACY PHASE COMPLETE (5/5)

- **Shipped:** the dashboard now distinguishes three states via a pure, tested helper
  `dashboardListState({visibleCount, totalTeamSessions})` → `list | locked | fresh`. New **locked**
  state ("Nothing shared with you yet — your team has N sessions, but they're private to their
  owners") for a viewer who can see none while the team is active — instead of the misleading
  "No sessions yet. Run orchid claude" onboarding CTA (now reserved for a genuinely empty team).
- **Design decision (logged):** stat cards stay **aggregate team metrics** (total/active/members) —
  the task explicitly allows counts/stats; they're team-activity, not content. Only the session
  **list** is owner/visibility/share-scoped (P1-2/P1-3). Audited dashboard list, activity, and
  decisions — all route through scoped reads; **no private content leaks**.
- **Lean gate (small UI change, done inline):** 3 `dashboardListState` unit cases (list/locked/fresh
  - boundaries); `check.sh` + full suite green; 1 adversarial reviewer → **SHIP**, zero must-fix
    (confirmed no leak, sound 3-way logic, functional style; also tidied a pre-existing `let stats`→`const`).
- **Verified:** preview (S-0 login) — dashboard renders the list (157 sessions, list state, no false
  locked/fresh); the locked/fresh paths can't be triggered with a single account that owns everything,
  so they're covered by unit tests. Prod `592d8ed` `/api/health` ok. Files: `display.ts`,
  dashboard `page.tsx`, `display.test.ts`. PR #75.
- **Milestone: the #1 goal (privacy & access layer) is fully shipped** — private by default (P1-1),
  enforced own/team scoping (P1-2), share grants (P1-3), Share UI (P1-5), aggregate-only dashboard
  (P1-4). All live + verified.

## 2026-06-14 — P1-5 Share UI (#74) — sharing is now a real, demoable affordance

- **Shipped:** a Linear-style **Share** popover on the session page. Owner view: invite a teammate
  by email (→ `POST /share`, inline server-error surfacing), a live grants list with per-row
  Remove (→ `DELETE /share/:granteeUserId`), empty state, and a **Copy link** that now actually
  works (the recipient can open it once granted). Non-owner view: Copy link only. Replaces the old
  `copy-link.tsx`, which only copied a URL that 404'd for non-shared users (misleading affordance).
- **Implementation:** new client component `share-session.tsx` — all network in event handlers
  (grants fetched on popover-open), **no `useEffect`**, typed readonly interfaces, no any/mutation.
  `getSessionById` now returns `is_owner` (selects `orchid_session.user_id`, compares to viewer) so
  the page gates the manage UI. Backend unchanged (P1-3).
- **Review:** clean single pass — reviewer + tester both **ship**, zero must-fix. 195 web tests / 28
  files green; `check.sh` green. Tests assert the `GET /shares` UI-contract shape + `is_owner` true/false.
- **Verified live on the preview** (headed browser): opened Share on a session I own → owner popover
  renders; invited my own email → inline **"Cannot share a session with yourself"** (server error
  surfaced); empty state + Copy link present. After squash-merge `fc66f30`, prod `/api/health` ok.
  Files: `share-session.tsx`, `queries.ts`, session `page.tsx`, `session-shares.test.ts`, `queries.test.ts`;
  `copy-link.tsx` deleted. PR #74.
- **Tooling-gap follow-up (filed under C-3):** eslint does NOT actually ban `useEffect` — the gate
  only catches `any` (via no-explicit-any). Add a `no-restricted-syntax` rule so the AGENTS.md
  no-useEffect convention is enforced by `check.sh` for future PRs.
- **Privacy phase is now 4/5** (P1-1,2,3,5 done; P1-4 aggregate-only dashboard remains).

## 2026-06-14 — P1-3 session share grants (#73) — access model now own/team/shared

- **Shipped:** an owner can grant another user scoped **read** access to a private session, and
  revoke it. `session_share` table (migration `0009`: session_id→cascade, grantee_user_id→cascade,
  capability `read|continue` default `read`, created_by, expires_at nullable; unique on
  (session_id, grantee_user_id)). The read-scope gains a third disjunct — **OR a non-expired
  share to me** — added to ALL THREE mirrored helpers (`scopeConditions`, `sessionReadScopeSql`,
  `visibleSessionScope`) via `exists(...)`. Endpoints (owner-only): `POST /sessions/:id/share`
  (grant by email or userId, upsert, self-grant 400, unknown grantee 404), `DELETE
/sessions/:id/share/:granteeUserId`, `GET /sessions/:id/shares`.
- **Gate caught two real privilege escalations:** because `scopeConditionForId` is derived from the
  (now share-inclusive) read scope, two MUTATING routes were gated on it — so a **read-only**
  grantee could **DELETE the owner's session** (cascading the row + commits) and **POST commit
  links**. Fix: both now use `requireSessionOwner` (owner-scoped predicate); audited every other
  `scopeConditionForId` caller (rest are reads; PUT is independently owner-gated). Added a "read
  grant does NOT confer write/delete" test block (grantee → 403 on DELETE + POST /commits).
- **Verified:** preview (S-0 login) — `GET /sessions/:id/shares` → 200 `{shares:[]}`, self-grant
  → 400, reads unregressed; after squash-merge `7294462`, **prod** `GET /api/sessions` → 200 / 157
  visible, `/api/health` ok. Cross-user grant/revoke/expiry/non-owner/write-protection locked by
  19 DB-backed tests (192 web tests total). Files: `schema.ts`, `api-app.ts`, `queries.ts`,
  `drizzle/0009_*`, `session-shares.test.ts`. PR #73.
- **Follow-ups:** `GET /summary` cache-miss UPDATE is still read-scope-gated (a read-grantee can
  trigger the idempotent summary write + one Claude call — benign, derived from content they can
  read; owner-gate it later); add the explicit `$userParam IS NOT NULL` guard to the raw-SQL
  EXISTS branch; `__tests__/setup.ts` assumes a pre-migrated DB (fine locally; a fresh CI DB would
  need `db:migrate` first).
- **Learning:** when a READ-scope predicate is reused to build the by-id predicate, MUTATING routes
  silently inherit the widened access — **destructive/write routes must gate on ownership, never on
  the read scope**. (Promoted to Patterns.)

## 2026-06-14 — P1-1 + P1-2 private-by-default + enforced scoping (#72) — the #1 goal, live

- **Shipped the privacy layer:** sessions are now **private by default** (new captures) with the
  rule enforced everywhere: a user sees a session IFF `user_id = me` OR `(team_id = myTeam AND
visibility = 'team')`. Existing rows backfilled to `team` (no surprise to current users); new
  inserts get the DB default `private` with **no write-path change**.
- **Two enforcement layers, one rule each:** (1) API — `scopeConditions` (Drizzle) rewritten with
  `or(own, and(team, visibility=team))` → automatically covers every endpoint that routes through
  it (list, search, GET/:id, delete, stats, summary, chat, decisions, commits). (2) SSR — shared
  `visibleSessionScope` in `queries.ts`; `listSessions`/`getSessionById`/`getSessionTranscriptById`/
  `searchSessions` converted to object params with `userId` threaded from `getServerAuth` through
  every page caller (dashboard, activity, session page + conversation component). Migration `0008`
  (column default `private` + backfill + `(team_id,visibility)` index).
- **The review gate earned its day:** the security reviewer wrote an adversarial test and found
  `GET /commits/sessions` (reverse SHA→session lookup, reachable via the CLI `orchid data
sessions-for`) had **ZERO** scoping — a cross-team leak of private session metadata (emails,
  private repo URLs, local paths) via short SHA-prefix enumeration. The implementer had punted it
  as "out of scope" (against our mindset rule). Fix: routed it + `/review-context` through one
  shared raw-SQL `sessionReadScopeSql` helper, added a **≥7-char hex** prefix guard against
  enumeration, and an adversarial cross-team test. 173 tests / 27 files green; `check.sh` green.
- **Verified:** preview (S-0 login works now) — dashboard lists my sessions, session detail +
  transcript load, no self-regression; after squash-merge `2f83b39`, **prod** dashboard loads my
  sessions, `/api/health` ok. Cross-user/cross-team isolation locked by 7 new integration tests
  (`sessions-visibility`, `commits-sessions-visibility`, `queries`, `search`).
- **Files:** `schema.ts`, `drizzle/0008_*`, `api-app.ts`, `queries.ts`, dashboard/activity/session
  pages + conversation, 3 test files. PR #72.
- **Follow-ups filed:** P1-4 still owns the aggregate leak (`getTeamStats`/`/stats` counts — `/stats`
  API now respects visibility, the SSR `getTeamStats` does not yet); add same-team private-exclusion
  tests for `searchSessions` + `/review-context`; consider the ≥7-char prefix guard on `/review-context` too.
- **Learnings:** (1) access-control changes need a _completeness_ sweep of EVERY read path — the
  central helper covered 9 endpoints but two raw-SQL reverse-lookups (`/commits/sessions`,
  `/review-context`) bypassed it; enumerate raw `pool.query` reads explicitly. (2) The adversarial
  security reviewer (told to write a real exploit test) is what caught the "out of scope" punt —
  keep that lens mandatory on auth/ACL PRs. (Promoted to Patterns.)

## 2026-06-14 — S-0 trusted preview origins (#71) — previews are now authed-verifiable

- **Shipped:** Better Auth now trusts the Vercel preview hosts, so authed flows (dashboard,
  sessions, chat, review) can be **verified on the PR's own preview URL** — not just prod. This
  retires the long-standing "verify on prod" risk in the loop's gate.
- **How:** new pure module `web/app/lib/auth-urls.ts` → `resolveAuthUrls(env)` derives `baseURL`
  - `trustedOrigins` from Vercel system envs (`VERCEL_ENV`/`VERCEL_URL`/`VERCEL_BRANCH_URL`/
    `VERCEL_PROJECT_PRODUCTION_URL`/`BETTER_AUTH_URL`). Preview `baseURL` = the branch alias (its
    own host); `trustedOrigins` = the de-duped exact origins for this deploy. **No `*.vercel.app`
    wildcard** (that would trust arbitrary third-party Vercel apps → CSRF) — only Vercel-controlled
    exact hosts. Wired into `auth.ts` (call site spreads `[...trustedOrigins]` since Better Auth's
    field wants a mutable array).
- **Prod safety:** for `VERCEL_ENV==='production'`, `baseURL === BETTER_AUTH_URL` exactly as
  before — locked in by a dedicated unit test. The other half of S-0 (migrate DB on build) was
  already done (`"build": "pnpm db:migrate && next build"`).
- **Review:** clean single pass — security reviewer + tester both **ship**, zero must-fix.
  6-case unit suite (`auth-urls.test.ts`): production (baseURL unchanged), preview (branch wins),
  preview-without-branch (deploy fallback), local, no-wildcard assertion, de-dup. 153 web tests +
  `check.sh` green; CI green.
- **Verified live:** (1) **logged into the PR preview** `…task-trusted-preview-origins…vercel.app`
  → redirected to the dashboard, **no "Invalid origin"** (the exact flow that failed pre-S-0);
  (2) after squash-merge `f230773`, **fresh prod login still works** → dashboard; prod
  `/api/health` ok. Files: `auth-urls.ts`, `auth.ts`, `auth-urls.test.ts`. PR #71.
- **Open sub-item:** confirm `ANTHROPIC_API_KEY` is in the Vercel **preview** env so AI features
  (summary/chat/review) also exercise on previews — now easy to check on the next PR's preview
  (login works), so deferred there rather than guessed.
- **Learning:** derive auth URLs from Vercel system envs (don't hardcode/wildcard); the
  acceptance test for any auth change is now **preview-login + prod-login**, both headed. (Pattern
  updated above.)

## 2026-06-14 — P3-1 auto-summary on session end (#70) — verified live on prod

- **Shipped:** Claude summaries now persist on the session row and render **instantly with no
  click** (server-side). When a session flips to `done`, an `after()` task generates the summary
  and stores it; the on-demand `GET /sessions/:id/summary` became **cache-read → compute →
  persist**; `getSessionById` returns it; the page SSRs it via `initialSummary`; `AISummary`
  seeds from that prop (no `useEffect`).
- **Build:** dynamic workflow (implement-in-worktree → open PR → 1 reviewer + 1 tester in
  parallel → fix). New column `orchid_session.summary` (migration `0007_lonely_black_bolt`),
  helper `generateSessionSummary`, regression test `web/__tests__/api/summary-cache.test.ts`.
- **Adversarial catch (real, fixed):** the first cut regenerated + **overwrote** the summary on
  _every_ `done` PUT — and the Stop hook + every `orchid sync` resend `done` repeatedly → a fresh
  Claude call + a re-rolled (temp 0.3) summary each time. Gated on the upsert's `RETURNING *`
  row (`!existingSummary`) + `WHERE orchid_session.summary IS NULL`; added a load-bearing test
  (fails if the gate is removed). Idempotent like the commit-extraction `after()` above it.
- **Files:** `schema.ts`, `drizzle/0007_*` (+ journal/snapshot), `api-app.ts`, `queries.ts`,
  `t/[teamSlug]/sessions/[id]/page.tsx`, `components/ai-summary.tsx`, the new test. PR #70 →
  squash-merge `625d203`.
- **Verify:** 147 web tests + `check.sh` green; CI green; **prod headed-browser** — generated a
  summary on a real session, **reloaded → it rendered immediately with no click** (proves
  persist + SSR cache-read). Prod `/api/health` ok on `625d203`.
- **Learnings:** (1) `done` is NOT a one-shot signal — the Stop hook and `orchid sync` resend it
  many times per session; any on-`done` work MUST be idempotent (gate the write, don't re-run the
  model). (2) `ON CONFLICT … DO UPDATE` that doesn't touch a column preserves its prior value, so
  `RETURNING *` is a reliable "already computed?" check. (Both promoted to Patterns.)

## 2026-06-14 — Dashboard bug-sweep + fixes (#68 #69) — all verified live

- Julian reported the dashboard "had a lot of things not working." Ran a 4-agent bug-sweep
  workflow; root causes (ownership/scoping were INTACT — display/UX only):
  - **Commits tab crashed (HIGH):** API returned snake_case `{commit_sha,committed_at,…}` but
    the component expected `{sha,date,url,…}` → `commit.sha.slice()` threw → blank tab on any
    session WITH commits (invisible until the backfill populated them).
  - **Session click felt dead:** detail route is `force-dynamic` with no `loading.tsx` → click
    blocked on the slow full render with zero feedback.
  - **"user.email"/"unconfigured" names:** git-config issue — global `user.name` unset (→
    "unconfigured") and the orchid repo's LOCAL `user.name` was literally "user.email" (botched
    `git config user.name user.email`). Names are display-only; ownership (user_id from PAT) fine.
  - Sweep: dead quick-search buttons; `unique_users`/Team Members counted distinct NAME (inflated).
- **Fixes shipped + verified on prod:** git config corrected on this machine; **#68** CLI
  `resolveUserName` hardening (rejects config-key garbage → email-local fallback; CLI rebuilt/
  relinked); **#69** web — commits-tab shape mapping + component guards, `loading.tsx` instant
  nav, `friendlyUserName` display normalization (fixes existing rows), distinct-email user count,
  parseTranscript `type:'user'` user-turn fix, live search buttons. 145 web + 120 CLI tests.
- **Verified live (a4963c5):** Commits tab shows 5 commits w/ messages+SHAs; 0 bad names (sessions
  show "Julian"); Team Members = 2 (was 5); session nav works.
- Pattern: **dogfood the dashboard UX, not just ship features** — a backfill can be correct while a
  UI shape-mismatch silently crashes the tab that displays it.

## 2026-06-14 — Commit↔session linking shipped (#67) → FLAGSHIP REVIEW WORKS ON PROD

- **#67 (P2-1b):** deterministic commit↔session linking — scoped/idempotent `POST
/api/sessions/:id/commits`, unique index migration `0006`, and `orchid sync --discover`
  (git-log backfill by author+branch+time-window, argv-form). Also fixed a latent bug:
  `session_commits.id` is NOT NULL with only an app-side default, so even the old transcript
  extraction silently failed to insert — a real reason prod links were empty.
- **Backfill run against prod:** `orchid sync --discover` → **linked 213 commits across 59
  sessions** (404s = local sessions not in the prod account; idempotent).
- **Flagship verified live:** `POST /api/review-context` with recent Orchid commit SHAs →
  **sessions_analyzed: 2**, resolved to the building sessions (`task/github-account-linking`,
  `main`) + a Claude-grounded intent brief. The conversation-aware code review (the 80% feature)
  now resolves a PR's commits → the sessions that built them → why. P2-1b ticked.
- **Follow-ups:** (a) the review-context sessions list shows `user_name` as the literal
  "user.email" — a select-alias nit in the endpoint's session query; (b) P2-1 live git
  post-commit hook (future commits auto-link without `--discover`); (c) P2-4 webhook posts the
  review brief as a PR comment (now that linking works, the brief is non-empty).

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
