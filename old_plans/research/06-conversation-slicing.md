# Conversation Slicing: Per-Commit Conversation Segments

## The Problem

A single AI coding session often produces multiple commits. When reviewing commit 3 of 5, you want to see **only** the conversation that led to that commit — not the entire 50-message session.

## git-memento Cannot Do This

git-memento attaches the **entire** session transcript to every commit. Its data flow:

```
git memento commit <session-id>
  → provider.GetSessionAsync(sessionId)    // Fetches ALL messages
  → Markdown.renderConversation(session)   // Renders ALL messages
  → git.AddNoteAsync(sha, fullTranscript)  // Attaches everything
```

No timestamp filtering, no message ranges, no windowing. Every commit in a session gets the same full conversation dump.

## Orchid's Solution: UUID-Based Cut Points

### Why This Works

Claude Code's JSONL has on every line:

- **`timestamp`**: ISO 8601 (e.g., `"2026-03-28T17:17:39.147Z"`)
- **`uuid`**: Unique message ID
- **`parentUuid`**: Links to previous message (linked list)
- **`type`**: `"user"` | `"assistant"` | `"file-history-snapshot"`

This gives us a precise, ordered chain of messages we can cut at any point.

### The Algorithm

**Step 1: Record cut points at commit time**

When `orchid capture-commit` fires (PostToolUse hook after `git commit`):

```typescript
// orchid capture-commit handler
async function captureCommit(hookPayload: HookPayload) {
  const commitSha = await exec('git rev-parse HEAD');
  const timestamp = new Date().toISOString();

  // Read the session JSONL to find the last message UUID
  const sessionPath = hookPayload.transcript_path;
  const lastEntry = getLastMessageEntry(sessionPath);

  // Record the cut point
  db.insert('commit_markers', {
    session_id: hookPayload.session_id,
    commit_sha: commitSha,
    timestamp: timestamp,
    last_message_uuid: lastEntry.uuid,
    message_index: lastEntry.index, // position in JSONL
  });
}
```

This produces a series of markers:

```
Session "89fb3dac" with 50 messages, 3 commits:

Marker 1: { commit: "aaa", lastMessageUuid: "msg-15", index: 15 }
Marker 2: { commit: "bbb", lastMessageUuid: "msg-30", index: 30 }
Marker 3: { commit: "ccc", lastMessageUuid: "msg-45", index: 45 }
```

**Step 2: Slice the conversation per commit**

```typescript
function sliceConversation(
  entries: JournalEntry[],
  markers: CommitMarker[],
): Map<string, JournalEntry[]> {
  const slices = new Map();

  // Sort markers by timestamp
  markers.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  for (let i = 0; i < markers.length; i++) {
    const startUuid = i === 0 ? null : markers[i - 1].last_message_uuid;
    const endUuid = markers[i].last_message_uuid;

    // Walk the parentUuid chain from endUuid back to startUuid
    const segment = extractSegment(entries, startUuid, endUuid);
    slices.set(markers[i].commit_sha, segment);
  }

  // Messages after the last commit → "post-commit conversation"
  const lastMarker = markers[markers.length - 1];
  const remaining = entries.filter(
    (e) =>
      e.timestamp > lastMarker.timestamp &&
      ['user', 'assistant'].includes(e.type),
  );
  if (remaining.length > 0) {
    slices.set('post-commit', remaining);
  }

  return slices;
}

function extractSegment(
  entries: JournalEntry[],
  startUuid: string | null, // exclusive
  endUuid: string, // inclusive
): JournalEntry[] {
  const byUuid = new Map(entries.map((e) => [e.uuid, e]));

  const segment: JournalEntry[] = [];
  let current: string | undefined = endUuid;

  while (current && current !== startUuid) {
    const entry = byUuid.get(current);
    if (!entry) break;
    segment.push(entry);
    current = entry.parentUuid;
  }

  segment.reverse();
  return segment;
}
```

**Step 3: Store slices, not full transcripts**

Each commit's git note contains only its slice:

```bash
# Commit "ccc" gets only messages 31-45
git notes --ref=refs/notes/ai-sessions add -m '{
  "session_id": "89fb3dac",
  "slice": {
    "start_uuid": "msg-30",
    "end_uuid": "msg-45",
    "message_count": 15,
    "messages": [
      {"role": "user", "content": "Let'\''s switch from Supabase to raw PostgreSQL..."},
      {"role": "assistant", "content": "I'\''ll update the database layer..."},
      ...
    ]
  }
}' ccc
```

### Edge Cases

| Case                                       | Handling                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| No commits in a session                    | Attach full conversation to the PR itself                                 |
| Messages after the last commit             | Attach as "post-commit discussion"                                        |
| Session resumed (`claude --continue`)      | `sessionId` stays consistent; slicing works normally                      |
| Subagent conversations                     | Stored in separate JSONL files; link to parent via tool_use block's UUID  |
| Sidechain messages (abandoned branches)    | Filter out entries with `isSidechain: true`                               |
| Multiple sessions contribute to one commit | Multiple slices from different sessions, each attached to the same commit |
| Rapid commits (seconds apart)              | UUID chain is precise; timestamps are backup. Cut point is exact.         |

### What the UI Shows

For a PR with 3 commits from one session:

```
PR #42: Restructure database layer
├── Commit 1: "Set up project scaffolding"
│   └── 🗨️ 15 messages (3 min session)
│       User: "Create a new Next.js project with..."
│       Claude: "I'll set up the scaffolding..."
│       [expand full conversation]
│
├── Commit 2: "Add authentication with Supabase"
│   └── 🗨️ 15 messages (8 min session)
│       User: "Add auth using Supabase..."
│       Claude: "I'll implement Supabase auth..."
│       [expand full conversation]
│
├── Commit 3: "Migrate from Supabase to PostgreSQL"
│   └── 🗨️ 15 messages (12 min session)  ← ONLY THIS PART
│       User: "Actually let's use raw PostgreSQL instead of Supabase..."
│       Claude: "I'll migrate the database layer. Here's my plan..."
│       [expand full conversation]
│
└── Post-commit discussion (5 messages)
    User: "Looks good, let's also add connection pooling later"
    Claude: "Good idea, we can use pgBouncer..."
```

### Why This Is a Key Differentiator

|                      | git-memento                       | Orchid                                   |
| -------------------- | --------------------------------- | ---------------------------------------- |
| Per-commit?          | Full session on every commit      | Only relevant slice per commit           |
| Cut precision        | None                              | UUID-exact via parentUuid chain          |
| Storage efficiency   | N \* full_transcript              | Sum of slices ≈ 1 \* full_transcript     |
| Review experience    | "Find the relevant part yourself" | "Here's exactly what led to this commit" |
| Post-commit messages | Lost                              | Captured and attached to PR              |
