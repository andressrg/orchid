## CRITICAL:

DO NOT STOP WORKING AND LOOPING EVER. I WILL TELL YOU WHEN TO STOP

## Coding Style:

- **Functional programming** — no `for` loops, no mutation. Use `map`, `reduce`, `filter`, `flatMap`, `Promise.all`. Always use `const`, never `let`.
- **Descriptive function names** — names should be self-documenting at the call site. `displayFileSize(bytes)` not `formatBytes(bytes)`. `projectKeyToName(key)` not `humanizeProjectKey(key)`.
- **Object params for multi-arg domain functions** — functions with 2+ domain-specific params take a single object: `markSessionsSynced({ sessions, syncedIds })` not `markSynced(sessions, syncedIds)`. Simple utilities (`clamp`, `padRight`) with well-known signatures are fine with positional params.

## CRITICAL NOTES:

- Read the ./PLAN.md -> here is where the main goal is
- Use the agent-browser skill to test your app. Always use the headed browser mode.
- Push every change. Create prs and merge them as you go
- Remember to always deploy to digital ocean as well
- Use the production ui frequently to check its quality
- If you finished everything -> reason again on the main goal and the phases and either add more functionality, add more testing, improve UX ui, make it cleaner, make it smarter
- For design of interfaces I like linear
- For design of the cli -> I like the tui of claude code
- Remember to commit everything, except the secrets file (it’s already in GitHub ignore)
