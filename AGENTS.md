## Harness:

The orchestrator runs on **Claude workflows** (the Workflow tool) — not a bash loop. Each
agent does one bounded task and returns. Persistence, looping, and sequencing are decided by
the workflow/orchestrator, never by a blanket "never stop" instruction in this file.

## Coding Style:

- **Functional programming** — no `for` loops, no `forEach`, no mutation. Use `map`, `reduce`, `filter`, `flatMap`, `Promise.all`. Transform data through pipelines, not imperative steps.
- **No mutation** — always `const`, never `let`. Never reassign variables. Never push to arrays — spread or concat instead. Derive new state, don't mutate existing state. Prefer `reduce` to accumulate, `map` to transform, `filter` to select.
- **No `useEffect`** — avoid `useEffect` as much as possible. Derive values from state/props directly. Use event handlers, server components, or `useSyncExternalStore` instead. If you think you need `useEffect`, you probably don't.
- **No `any` or `unknown`** — use proper typed interfaces with `readonly` fields. Define the shape of your data explicitly.
- **Performance is everything** — every interaction under 200ms. Batch DB queries (single INSERT with multiple VALUES, not loops). Use `after()` for background work. Minimize round trips. If something feels slow, it is slow — fix it.
- **Descriptive function names** — names should be self-documenting at the call site. `displayFileSize(bytes)` not `formatBytes(bytes)`. `projectKeyToName(key)` not `humanizeProjectKey(key)`.
- **SQL: always `table_name.column_name`** — every column reference in SQL must be table-qualified, even in single-table queries. `SELECT session_commits.commit_sha FROM session_commits WHERE session_commits.session_id = $1`, never bare `commit_sha`.
- **Object params for multi-arg domain functions** — functions with 2+ domain-specific params take a single object: `markSessionsSynced({ sessions, syncedIds })` not `markSynced(sessions, syncedIds)`. Simple utilities (`clamp`, `padRight`) with well-known signatures are fine with positional params.

## CRITICAL NOTES:

- Use the agent-browser skill to test your app. Always use the headed browser mode.
- For design of interfaces I like linear
- For design of the cli -> I like the tui of claude code
- Remember to commit everything, except the secrets file (it’s already in GitHub ignore)
