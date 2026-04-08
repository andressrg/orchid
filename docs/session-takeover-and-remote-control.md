# Session Takeover & Remote Control

> RFC for allowing orchid users within a team to take over or remotely control a coworker's AI coding session.

## Problem

Today, orchid captures and stores AI conversations so teammates can _read_ them. But reading isn't enough:

1. **Takeover** -- A coworker started a feature, went on vacation, and you need to _continue_ that exact conversation on your own machine with full history intact.
2. **Remote control** -- A coworker is stuck mid-session and you want to _drive_ their live Claude session from your terminal -- like `tmux attach` but across machines, through the orchid server.

Both features must be **secure** (team-scoped auth, encrypted transport, explicit consent) and **low-latency** (real-time keystrokes, no perceptible lag).

---

## Current Architecture

| Layer | How it works today |
|-------|-------------------|
| **CLI launch** | `spawn("claude", args)` with `stdio: "inherit"` -- terminal I/O goes straight to the user's TTY, no interception |
| **Transcript sync** | Full JSONL re-uploaded every 5 seconds via `PUT /api/sessions/:id` |
| **Session identity** | UUID from the JSONL filename in `~/.claude/projects/<project-path>/` |
| **Auth** | Bearer token (PAT `orc_*`) scoped to user or team |
| **Claude Code resume** | Native flags: `--resume <id>`, `--continue`, `--fork-session` |

### Key constraint

`stdio: "inherit"` means orchid has **zero access** to terminal I/O today. Both features require orchid to sit between Claude Code and the terminal.

---

## Feature 1: Session Takeover

### Goal

```
orchid takeover <session-id>
```

Download a teammate's session, fork it under your identity, and continue the conversation locally with full history.

### Approaches

#### A. Download + Native Resume (same session ID)

1. `GET /api/sessions/:id` -- download JSONL transcript from server
2. Write it to `~/.claude/projects/<project-path>/<session-id>.jsonl`
3. Launch `claude --resume <session-id>`
4. Orchid syncs ongoing changes (same session ID, new user context)

| | |
|-|-|
| **Pros** | Simplest. Uses Claude Code's built-in resume. Full history. |
| **Cons** | Same session ID -- ownership is ambiguous on the server. Two people could resume the same session simultaneously. |

#### B. Download + Fork (recommended)

1. `GET /api/sessions/:id` -- download JSONL transcript
2. Write it to `~/.claude/projects/<project-path>/<session-id>.jsonl`
3. Launch `claude --resume <session-id> --fork-session` -- Claude Code creates a **new session ID** but loads the full conversation history
4. Orchid detects the new JSONL file, syncs it as a new session with `forkedFrom: <original-id>` metadata
5. Server records the lineage: original session -> forked session

| | |
|-|-|
| **Pros** | Clean ownership -- new ID, new user, traceable lineage. Native Claude Code mechanism. Original session stays untouched. |
| **Cons** | Requires writing the JSONL to disk before launch. Must resolve the correct `~/.claude/projects/` subdirectory. |

**Why this is the recommendation:** Fork preserves history while creating a clean ownership boundary. The original session remains read-only for audit. The forked session belongs entirely to the new user.

#### C. New Session with Context Injection

1. Start a fresh `orchid claude` session
2. Pipe the previous transcript as the initial prompt

| | |
|-|-|
| **Pros** | No filesystem manipulation. |
| **Cons** | Burns context window. Loses turn-by-turn tool-use history. Not a real continuation -- Claude may hallucinate about previous actions. |

**Rejected** -- too lossy for a takeover feature.

### Takeover: Security Design

- **Team scope**: Only sessions within the same team can be taken over. Server validates `teamId` match.
- **Explicit consent**: The original session owner must mark a session as "transferable", or the team admin must have a policy allowing takeovers. No silent access.
- **Audit trail**: Every takeover is logged: who, when, which session, forked-to session ID.
- **Token validation**: The requesting user's PAT must be team-scoped and valid. Server checks membership.
- **Read-only original**: The original session is never modified. Fork creates an independent copy.

### Takeover: Implementation Sketch

```
CLI (orchid takeover <session-id>)
  |
  |-- 1. GET /api/sessions/:id (auth: Bearer orc_*)
  |       Server validates: user is member of session's team
  |       Server validates: session is transferable
  |       Returns: { transcript, working_dir, git_remotes, branch }
  |
  |-- 2. Resolve local project path
  |       Map working_dir -> ~/.claude/projects/<path>/
  |       Write <session-id>.jsonl to that directory
  |
  |-- 3. spawn("claude", ["--resume", sessionId, "--fork-session", ...userArgs])
  |       Claude Code loads history, creates new session ID
  |
  |-- 4. Detect new JSONL file (existing watcher logic)
  |       Start syncing with metadata: { forkedFrom: originalSessionId }
  |
  |-- 5. Server stores fork relationship
  |       orchid_session.forked_from = originalSessionId
```

---

## Feature 2: Remote Session Control

### Goal

```
orchid attach <session-id>
```

Attach to a coworker's live Claude Code session from your terminal. See their output in real-time, optionally send input. Like `tmux attach` but through the orchid server.

### Approaches

#### A. WebSocket Terminal Relay via Orchid Server (recommended)

```
[Your Machine]             [Orchid Server]            [Coworker's Machine]
orchid attach <id>  <---> WebSocket relay  <--->  orchid claude (PTY mode)
  terminal render            TLS + auth              node-pty -> claude
```

**Host side:**
- `orchid claude` runs Claude Code under a **PTY** (via `node-pty`) instead of `stdio: "inherit"`
- PTY output is streamed to the orchid server via WebSocket (binary frames, minimal overhead)
- PTY input comes from: local terminal (default) + remote attachers (when permitted)

**Server side:**
- Maintains WebSocket connections for active sessions
- Authenticates and authorizes attach requests (team membership, session owner consent)
- Relays binary terminal data between host and clients
- No buffering of terminal content beyond what's needed for initial screen state

**Client side:**
- `orchid attach <session-id>` opens a WebSocket to the server
- Renders terminal output locally (raw PTY stream -- the client terminal handles escape codes natively)
- In read-write mode, keystrokes are sent upstream

| | |
|-|-|
| **Pros** | Works across any network. No SSH. Reuses orchid auth/teams. Binary protocol = low overhead. |
| **Cons** | Requires `node-pty` dependency. Server becomes a relay (added hop). PTY mode is a significant change to `orchid claude`. |

#### B. SSH + tmux

- Coworker runs session inside tmux
- You SSH in and `tmux attach`
- Orchid stores connection info and provides `orchid attach` as an SSH shortcut

| | |
|-|-|
| **Pros** | Simple. Battle-tested. Lowest possible latency (direct connection). |
| **Cons** | Requires SSH access between machines. Firewall/NAT issues. No centralized access control. Doesn't work across corporate networks. |

**Rejected as primary approach** -- too many network assumptions. Could be offered as an optional "direct mode" for users on the same network.

#### C. P2P via WebRTC Data Channel

- Orchid server acts as signaling server only
- Machines connect directly via WebRTC
- Terminal I/O flows peer-to-peer after connection setup

| | |
|-|-|
| **Pros** | Lowest latency after connection. No server bottleneck. |
| **Cons** | NAT traversal complexity (STUN/TURN). WebRTC in Node.js requires native dependencies. Harder to implement. Connection setup is slower. |

**Deferred** -- could be a future optimization for latency-sensitive users. The WebSocket relay is the right starting point.

### Remote Control: Security Design

Security is paramount here -- this feature gives one user access to another user's terminal.

- **End-to-end encryption**: TLS for WebSocket transport (wss://). Consider adding an additional layer of encryption where the server cannot read the terminal stream (E2E key exchange between host and client).
- **Explicit opt-in**: The host must explicitly enable remote attach when starting the session (`orchid claude --allow-attach`) or accept an attach request interactively.
- **Permission levels**:
  - `read-only` -- can see the terminal, cannot type (default for attach)
  - `read-write` -- can see and type (requires explicit grant from host)
- **Team-scoped**: Only members of the same team can request attach. Server validates membership.
- **Session-level consent**: Each attach request shows a prompt on the host's terminal: `"julian wants to attach (read-only). Allow? [y/n]"`. Host must accept.
- **Revocation**: Host can kick an attacher at any time (`/kick` or `Ctrl+Shift+K`).
- **Audit log**: Every attach/detach event is logged with: who, when, permission level, duration.
- **Rate limiting**: Attach requests are rate-limited to prevent abuse.
- **No recording by default**: Attachers cannot record the session unless the host explicitly allows it.

### Remote Control: Latency Design

Performance is a pillar. The goal is **< 50ms perceived latency** for keystrokes.

- **Binary WebSocket frames**: Terminal data is sent as raw binary, not JSON-wrapped. Minimal serialization overhead.
- **No server-side buffering**: The relay forwards frames immediately -- no batching, no queueing.
- **Compression**: Optional per-frame compression (permessage-deflate) for terminal output, which compresses well (repetitive escape codes).
- **Regional routing**: For production, deploy relay servers in multiple regions. Connect host and client to the nearest relay.
- **Direct mode fallback**: For same-network users, offer `orchid attach --direct` which attempts a direct TCP connection (or SSH tunnel) bypassing the server entirely.
- **Connection health**: WebSocket ping/pong with tight timeouts (5s). If connection degrades, show latency indicator to the client.
- **Initial screen sync**: On attach, send the current terminal screen state (scrollback buffer snapshot) so the client sees the current state immediately without waiting for new output.

### Remote Control: Architecture

```
                    ┌──────────────────────────────────┐
                    │         Orchid Server             │
                    │                                    │
                    │  ┌────────────────────────────┐   │
                    │  │   WebSocket Relay Service   │   │
                    │  │                              │   │
                    │  │  - Auth middleware (PAT)     │   │
                    │  │  - Team membership check     │   │
                    │  │  - Session registry          │   │
                    │  │  - Binary frame forwarding   │   │
                    │  │  - Attach request brokering  │   │
                    │  └──────┬───────────┬──────────┘   │
                    │         │           │               │
                    └─────────┼───────────┼───────────────┘
                              │           │
                     wss://   │           │  wss://
                     (TLS)    │           │  (TLS)
                              │           │
               ┌──────────────┴──┐   ┌────┴──────────────┐
               │   Host Machine   │   │  Client Machine   │
               │                  │   │                    │
               │  orchid claude   │   │  orchid attach     │
               │       │          │   │       │            │
               │  ┌────┴─────┐   │   │  ┌────┴─────┐     │
               │  │ node-pty │   │   │  │ Terminal  │     │
               │  │    │     │   │   │  │ renderer  │     │
               │  │  claude  │   │   │  └──────────┘     │
               │  └──────────┘   │   │                    │
               └─────────────────┘   └────────────────────┘
```

### Remote Control: Implementation Sketch

**Phase 1: PTY mode for `orchid claude`**

```
orchid claude --allow-attach
```

- Replace `spawn("claude", args, { stdio: "inherit" })` with `pty.spawn("claude", args)`
- Multiplex PTY output to: local terminal (stdout) + WebSocket (if attached)
- Accept input from: local terminal (stdin) + WebSocket (if read-write attacher)
- Register session as "attachable" on the server

**Phase 2: Server relay**

- New WebSocket endpoint: `wss://server/api/sessions/:id/terminal`
- Auth: Bearer token in WebSocket handshake headers
- Protocol:
  - `host -> server`: binary PTY output frames
  - `server -> client`: forwarded binary frames
  - `client -> server`: binary input frames (if read-write)
  - `server -> host`: forwarded input frames
  - Control messages (JSON): attach-request, attach-accept, attach-deny, kick, permission-change

**Phase 3: Client attach**

```
orchid attach <session-id>
```

- Connect to `wss://server/api/sessions/:id/terminal`
- Render incoming binary frames to local terminal (raw write to stdout)
- In read-write mode, capture stdin and send upstream
- Show status bar: session info, latency, permission level, connected users

---

## Shared Prerequisite: PTY Mode

Both features require orchid to **intercept terminal I/O**. This means replacing:

```typescript
// Current: no interception possible
spawn("claude", args, { stdio: "inherit" })
```

With:

```typescript
// New: full control over terminal I/O
import * as pty from "node-pty";
const proc = pty.spawn("claude", args, { cols, rows, cwd, env });

// Output goes to local terminal AND WebSocket
proc.onData((data) => {
  process.stdout.write(data);      // local
  ws?.send(data);                   // remote (if attached)
});

// Input comes from local terminal AND WebSocket
process.stdin.on("data", (data) => proc.write(data));
ws?.on("message", (data) => proc.write(data));  // remote input
```

This is the single biggest change. It should be implemented first and gated behind a flag (`--allow-attach` or `--pty`) so existing `orchid claude` behavior is preserved by default.

**Important**: PTY mode must not degrade local performance. When no one is attached, the overhead should be near-zero (just the PTY layer, no WebSocket, no serialization).

---

## Implementation Phases

### Phase 1: PTY Foundation
- Add `node-pty` to CLI dependencies
- Implement PTY mode behind `--allow-attach` flag
- Ensure zero degradation in local-only mode
- Handle terminal resize (SIGWINCH propagation)

### Phase 2: Session Takeover (`orchid takeover`)
- `GET /api/sessions/:id` endpoint returns full transcript (already exists)
- Add `forked_from` column to `orchid_session` table
- CLI: download JSONL, resolve local path, launch with `--fork-session`
- Server: record fork lineage, enforce team-scoped access
- Add `transferable` flag or team policy for session access

### Phase 3: WebSocket Relay (server)
- New endpoint: `wss://server/api/sessions/:id/terminal`
- Auth middleware for WebSocket upgrade
- Binary frame relay with zero-copy forwarding
- Attach request/accept/deny protocol
- Connection health monitoring

### Phase 4: Remote Attach (`orchid attach`)
- CLI: connect to relay, render terminal output, forward input
- Permission negotiation (read-only vs read-write)
- Host-side consent prompt
- Status bar with latency and connection info
- Kick/revoke mechanism

### Phase 5: Hardening
- E2E encryption layer (optional, on top of TLS)
- Audit logging for all attach events
- Rate limiting
- Direct mode for same-network users
- Regional relay servers

---

## Open Questions

1. **Should takeover require the original session to be `done`?** Or can you fork an `active` session (effectively "branching" the conversation)?
2. **Multi-attacher**: Can multiple people attach to the same session simultaneously? If so, how do we handle conflicting input in read-write mode?
3. **Session recording**: Should the attach session be recorded separately? Or is the host's transcript sufficient?
4. **E2E encryption**: How far do we go? TLS is table stakes. Do we need the server to be unable to read the terminal stream?
5. **Fallback for non-PTY mode**: If `node-pty` can't be installed (e.g., missing build tools), should `orchid claude` fall back to `stdio: "inherit"` with attach disabled?
