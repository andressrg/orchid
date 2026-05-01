# AI-Powered Read Path

## The Shift

Previous assumption: slice conversations at write time, attach segments to commits.

New model: **dumb write, smart read.**

### Write Path (Simple)

Record everything. Full conversations dumped to DB. No slicing, no mapping, no cut points. Just:

- Session ID
- Full transcript (JSONL)
- Which repo, which branch, which PR
- Timestamps

### Read Path (Intelligent)

The UI lets you **ask questions** about the conversations behind a PR. Not "here's the conversation for commit 3" — instead:

> "Did the author discuss using PostgreSQL instead of Supabase?"
> "Why did they choose Supabase in the end?"
> "What security concerns were raised during development?"
> "Was there a discussion about rate limiting?"
> "What alternatives were considered for the auth flow?"

The system retrieves the relevant conversation fragments and synthesizes an answer.

---

## Why This Is Better

|                        | Pre-sliced (old model)                      | AI-powered read (new model)                          |
| ---------------------- | ------------------------------------------- | ---------------------------------------------------- |
| Write complexity       | High (cut points, UUID chains, edge cases)  | **Trivial** (dump everything)                        |
| Read experience        | Static — "here's the convo for this commit" | **Interactive** — ask anything about the PR          |
| Cross-commit questions | Impossible — each commit has its own slice  | **Natural** — "was X discussed anywhere in this PR?" |
| Discovery              | User must read through conversations        | **AI finds the relevant parts** for you              |
| Reviewer effort        | Must scan entire conversation segments      | **Ask a question, get an answer with citations**     |

The pre-sliced model forces the reviewer to read conversations linearly. The AI-powered model lets them ask the questions that actually matter for code review.

---

## Architecture

```
Write Path (simple):
  Claude Code hooks → orchid CLI → dump full JSONL to Supabase Storage
                                 → index metadata in Postgres
                                 → record (session_id, repo, branch, PR#)

Read Path (smart):
  Reviewer opens PR in Orchid UI
    → sees diff (standard code review)
    → sees "Ask about this PR" input
    → types: "Why Supabase instead of PostgreSQL?"
    → backend retrieves all conversations for this PR
    → feeds them to Claude API with the question
    → returns answer with citations to specific messages
    → UI highlights the relevant conversation fragments
```

### Backend Flow for a Question

```typescript
async function answerQuestion(prId: string, question: string) {
  // 1. Get all sessions linked to this PR
  const sessions = await db.query(
    `
    SELECT s.id, s.transcript_storage_key, s.first_prompt, s.summary
    FROM sessions s
    JOIN session_commits sc ON s.id = sc.session_id
    JOIN pr_commits pc ON sc.commit_sha = pc.commit_sha
    WHERE pc.pr_id = $1
  `,
    [prId],
  );

  // 2. Load transcripts
  const transcripts = await Promise.all(
    sessions.map((s) => storage.download(s.transcript_storage_key)),
  );

  // 3. Ask Claude with the full context
  const response = await claude.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    messages: [
      {
        role: 'user',
        content: `You are reviewing the AI conversations that led to a pull request.

Here are all the conversations from the development sessions:

${transcripts
  .map(
    (t, i) => `
--- Session ${sessions[i].id} ---
${formatTranscript(t)}
--- End Session ---
`,
  )
  .join('\n')}

The reviewer asks: "${question}"

Answer the question based on the conversations above.
Cite specific messages by quoting them.
If the topic wasn't discussed, say so clearly.`,
      },
    ],
  });

  return {
    answer: response.content[0].text,
    // Could also extract cited message UUIDs for highlighting in UI
  };
}
```

### For Large PRs (Many Sessions, Long Transcripts)

If the combined transcripts exceed context limits:

1. **Embedding-based retrieval**: Embed conversation chunks → vector search for relevant fragments → pass only relevant chunks to Claude
2. **Two-pass approach**: First pass with summaries of each session → identify relevant sessions → second pass with full transcripts of only relevant sessions
3. **Pragmatic for MVP**: Most PRs have 1-3 sessions. Full transcripts of 3 sessions easily fit in Claude's context. Optimize later.

---

## UI Design

### The PR Review Page

```
+------------------------------------------------------------------+
| PR #42: Add user authentication                    [Merge] [Close]|
+------------------------------------------------------------------+
| [Diff] [Conversations] [Ask]                                     |
+------------------------------------------------------------------+

[Diff tab] — standard code diff, like GitHub

[Conversations tab] — raw conversation browser
  Session 1 (Claude, 23 messages, 12 min)
  Session 2 (Claude, 15 messages, 8 min)
  Session 3 (Codex, 8 messages, 5 min)
  (click to expand/browse any session)

[Ask tab] — THE KEY FEATURE
  +--------------------------------------------------------------+
  | Ask anything about how this code was developed...            |
  +--------------------------------------------------------------+

  Example questions:
  • "Why was Supabase chosen over PostgreSQL?"
  • "Were there any security concerns discussed?"
  • "What alternatives were considered for auth?"
  • "Did the developer ask about error handling?"
```

### Ask Tab — Interaction Flow

```
+------------------------------------------------------------------+
| Ask about this PR                                                 |
+------------------------------------------------------------------+
|                                                                    |
| You: Did they discuss using PostgreSQL instead of Supabase?       |
|                                                                    |
| Orchid: Yes. In Session 2, the developer initially asked Claude   |
| to set up PostgreSQL with connection pooling:                     |
|                                                                    |
|   > User (2:15 PM): "Let's use raw PostgreSQL with pg and        |
|   > pgBouncer for connection pooling"                             |
|                                                                    |
| Claude suggested Supabase instead, citing faster setup and        |
| built-in auth:                                                    |
|                                                                    |
|   > Claude (2:16 PM): "Since you're also adding authentication,  |
|   > Supabase would give you both the database and auth in one     |
|   > service. It uses PostgreSQL under the hood, so you can        |
|   > always migrate later if needed."                              |
|                                                                    |
| The developer agreed and switched to Supabase in the next         |
| message. No further discussion about PostgreSQL after that.       |
|                                                                    |
|   [View in Session 2 →]  [Jump to related diff →]                |
|                                                                    |
+------------------------------------------------------------------+
| Ask a follow-up...                                                |
+------------------------------------------------------------------+
```

### Key UI Principles

1. **The Ask tab is the star.** The diff and raw conversations are table stakes. The ability to interrogate the development process is the product.

2. **Citations are non-negotiable.** Every answer links back to the exact messages. The reviewer can click through to verify.

3. **Follow-ups are natural.** The Ask tab is a conversation itself — "Why did they agree?" "Was performance discussed?"

4. **Suggested questions.** On first load, show 3-4 AI-generated questions based on the PR diff and conversations: "This PR introduces bcrypt — was the choice of hashing algorithm discussed?"

---

## What Changes in the Architecture

### Write path gets simpler

Remove from architecture:

- ~~Conversation slicing~~
- ~~UUID cut points~~
- ~~Per-commit git notes with sliced content~~

Replace with:

- Dump full transcript to Supabase Storage on session end
- Record (session_id, repo, PR, commits) in Postgres
- Done

### Read path gets a new component

Add:

- **Query endpoint**: `POST /api/pr/:id/ask` — takes a question, returns answer + citations
- **Claude API integration**: Sonnet for fast answers, Opus for deep analysis
- **Transcript retrieval**: Pull from Supabase Storage, format for Claude context
- **(Later) Vector embeddings**: For large PRs with many sessions

### Git notes become optional

Git notes were important when we were trying to attach pre-sliced conversations. Now they're just a nice-to-have for CLI users who want `orchid show <commit>` in the terminal. The real value is in the web UI's Ask feature.

---

## Cost Considerations

Each "Ask" query sends conversation transcripts to Claude API:

| PR Size                       | Typical Transcript Size | Claude API Cost (Sonnet) |
| ----------------------------- | ----------------------- | ------------------------ |
| Small (1 session, 20 msgs)    | ~15K tokens input       | ~$0.005                  |
| Medium (3 sessions, 60 msgs)  | ~50K tokens input       | ~$0.015                  |
| Large (10 sessions, 200 msgs) | ~150K tokens input      | ~$0.045                  |

At $0.01-0.05 per question, this is very affordable. Caching repeated questions per PR further reduces cost.

### Optimization: Pre-compute common questions

On PR creation, automatically generate and cache answers to common questions:

- "What is this PR about?" (summary)
- "What decisions were made and why?"
- "What alternatives were considered?"
- "Were there any concerns or trade-offs discussed?"

This gives instant answers for the most common reviewer needs.
