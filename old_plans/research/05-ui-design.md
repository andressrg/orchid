# UI/UX Design: Conversation-Aware Code Diff Review

## Core Insight

**The novel UI challenge is a linking problem, not a rendering problem.** Both diff UIs and conversation UIs are well-solved individually. The hard part is connecting them in a way that feels natural, fast, and non-intrusive.

---

## State of the Art: Diff UIs

| Platform       | Key Strength                                                                                                                                  | Relevance to Orchid                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **GitHub**     | Baseline everyone knows. File tree sidebar, inline comments, "Viewed" checkboxes. Gap: conversation tab is separate from "Files changed" tab. | Our starting point — match this baseline |
| **Graphite**   | Minimalist, clean aesthetic. Stacked PRs. AI-generated PR summaries. Fast.                                                                    | **Closest to "super simplistic" goal**   |
| **Reviewable** | Most sophisticated diff UI. Discussions anchored to line ranges that survive rebases.                                                         | Power-user reference                     |
| **Gerrit**     | Dense, keyboard-driven. "Attention set" (knows who needs to act).                                                                             | Keyboard nav reference                   |
| **GitButler**  | Hunks as draggable units. Spatial approach to code changes.                                                                                   | Novel "unit of change" thinking          |

### Universal Diff Patterns

- Split view (side-by-side) — default for most users
- File tree sidebar — essential for large PRs
- Inline comments with threading
- Sticky file headers while scrolling
- Collapse/expand context (surrounding unchanged lines)
- Lazy loading for large diffs (collapse files >500 lines)
- Syntax highlighting (TextMate grammars or Tree-sitter)

---

## State of the Art: Conversation UIs

| Product       | Key Pattern                                                                                                     | Relevance                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Claude.ai** | Collapsible thinking blocks. Tool use as collapsible blocks ("Searched 3 files"). Artifacts panel on the right. | Artifacts model = separate "conversation" from "output"    |
| **Cursor**    | Chat panel on right side of editor. Inline diff previews in chat. "Apply" button.                               | "Chat that references code locations" is directly relevant |
| **Windsurf**  | "Cascade" flow: waterfall of actions (searched → read → edited).                                                | Cascade metaphor for AI coding session progression         |
| **Aider**     | Terminal-based. Git diffs inline in conversation. Each turn maps to a commit.                                   | "Conversation turn = commit" conceptual mapping            |

### Key Conversation Patterns

- Collapsible tool calls (must show AI actions compactly)
- Inline code diffs in chat (preview changes within conversation)
- Side panel for output (separates talk from result)
- Action waterfall/cascade (good for "replay")
- Markdown rendering with syntax-highlighted code blocks

---

## Six Layout Approaches Analyzed

### A. Side-by-Side (Diff + Conversation)

```
+------------------------------------------------------------------+
| Files  |  CODE DIFF                   |  AI CONVERSATION          |
|        |                              |                           |
| > src/ | @@ auth.ts @@                | [Claude] 2:34 PM          |
|   auth | + import bcrypt from 'bcrypt'| User: Add password         |
|   login| + export async function      | hashing using bcrypt.      |
|        | +   hashPassword(pw) {       |                           |
|        | +   return bcrypt.hash(      | Claude: I'll add bcrypt   |
|        | +     pw, 10                 | for hashing and JWT for   |
|        | +   );                       | token generation.          |
|        | + }                          |                           |
|        |                              | [Edited auth.ts]          |
|        | @@ login.ts @@               | [Edited login.ts]         |
|        | - const valid = pw === stored |                           |
|        | + const valid = await        | [+3 more messages]        |
|        | +   bcrypt.compare(pw,stored)|                           |
+------------------------------------------------------------------+
```

As you scroll the diff, the conversation highlights the relevant message. Click a message → diff scrolls to relevant hunk.

**Verdict**: Best primary layout. Familiar (resembles Cursor). Both views always visible.

---

### B. Inline Conversation (Embedded in Diff)

```
+------------------------------------------------------------------+
| @@ auth.ts @@                                                     |
|                                                                    |
| +---------- AI Context (Claude, 2:34 PM) -----------------------+|
| | User: "Add password hashing using bcrypt"                      ||
| | Claude: "I'll add bcrypt for hashing and JWT for..."           ||
| | [Expand full conversation...]                                  ||
| +----------------------------------------------------------------+|
|                                                                    |
| + import bcrypt from 'bcrypt';                                    |
| + export async function hashPassword(password: string) {          |
| +   return bcrypt.hash(password, 10);                             |
| + }                                                               |
+------------------------------------------------------------------+
```

Conversation snippets inserted above the hunks they produced. Collapsed by default (one-line summary), expandable.

**Verdict**: Great for "zero context switching". Can break diff scanning flow if too many segments.

---

### C. Timeline / Replay

```
+------------------------------------------------------------------+
| 2:30 PM  [User -> Claude]                                        |
|          "I need to add password hashing. Currently plaintext."   |
|                                                                    |
| 2:31 PM  [Claude]                                                |
|          "I'll add bcrypt for password hashing..."                |
|          [> Searched: auth.ts, login.ts, package.json]            |
|                                                                    |
| 2:32 PM  [Claude -> auth.ts]                                     |
|          +----------------------------------------------+          |
|          | + import bcrypt from 'bcrypt';               |          |
|          | + export async function hashPassword(pw) {   |          |
|          | +   return bcrypt.hash(pw, 10);              |          |
|          | + }                                          |          |
|          +----------------------------------------------+          |
|                                                                    |
| 2:33 PM  [User -> Claude]                                        |
|          "Also add rate limiting to the login endpoint"           |
+------------------------------------------------------------------+
```

Chronological. Code diffs appear inline at the moment they were created. Tells a story — you can "replay" the session.

**Verdict**: Excellent secondary view. Not sufficient as the primary review surface (changes to same file scattered across timeline).

---

### D. Tabbed with Cross-Linking

```
+------------------------------------------------------------------+
| [Summary] [Diff *] [Conversation] [Timeline]                     |
+------------------------------------------------------------------+
| @@ auth.ts @@                                                     |
|                                                                    |
| + import bcrypt from 'bcrypt';                                    |
| + export async function hashPassword(     💬 ← (clickable)       |
| +   password: string                                              |
| + ): Promise<string> {                                            |
| +   return bcrypt.hash(password, 10);                             |
| + }                                                               |
+------------------------------------------------------------------+
```

Small 💬 indicators on hunks. Click navigates to Conversation tab scrolled to relevant message.

**Verdict**: Clean, but context-switching between tabs is friction.

---

### E. Minimap / Overview

```
+------------------------------------------------------------------+
| auth.ts    [████████░░░░] 2 conversations, 15 lines added        |
|            [██ "Add bcrypt hashing"                               |
|            [██████ "Add JWT tokens"                               |
|                                                                    |
| login.ts   [██████░░░░░░] 1 conversation, 8 lines changed        |
|            [██████ "Update login to use bcrypt"                   |
+------------------------------------------------------------------+
```

Bird's eye view of entire PR. Color-coded segments show which conversation produced which portion.

**Verdict**: Great supplementary widget for large PRs. Not standalone.

---

### F. Blame-Style

```
+------------------------------------------------------------------+
| Convo 1 (Claude)             | + import bcrypt from 'bcrypt';     |
| "Add password hashing"       | + export async function            |
| 2:32 PM                      | +   hashPassword(pw: string) {    |
| [Expand conversation >]      | +   return bcrypt.hash(pw, 10);   |
|                               | + }                                |
|-------------------------------+------------------------------------|
| Manual edit (human)           | + // TODO: Add refresh tokens     |
| No AI conversation            |                                    |
+------------------------------------------------------------------+
```

Like git blame but shows which conversation produced each code block.

**Verdict**: Powerful metaphor but only works for additions, not deletions/modifications.

---

## Recommended: Progressive Disclosure Hybrid

### The MVP Layout

Combine A (side-by-side) + B (inline hints) + D (cross-linking):

```
+------------------------------------------------------------------+
| PR #42: Add user authentication                    [Merge] [Close]|
+------------------------------------------------------------------+
| [Summary] [Changes *] [Conversation] [Timeline]                  |
+------------------------------------------------------------------+
|        |                                              | CONVO     |
| Files  |  DIFF VIEW                                  | (toggle)  |
| ----   |                                              |           |
| * auth |  @@ src/auth.ts @@                          | Session 1 |
|   login|                                              | --------  |
|   pkg  |  ┃ + import bcrypt from 'bcrypt';            | User:     |
|        |  ┃ + import jwt from 'jsonwebtoken';         | Add pwd   |
|        |  ┃ +                                         | hashing   |
|        |  ┃ + export async function hashPassword(     | using     |
|        |  ┃ +   password: string                      | bcrypt    |
|        |  ┃ + ): Promise<string> {                    |           |
|        |  ┃ +   return bcrypt.hash(password, 10);     | Claude:   |
|        |  ┃ + }                                       | I'll add  |
|        |  ┃                                           | bcrypt... |
|        |     (colored bar ┃ matches session 1 color)  |           |
|        |                                              | [+3 more  |
|        |  @@ src/login.ts @@                          |  messages]|
+------------------------------------------------------------------+
```

### Three Levels of Detail

| Level | What                                                       | When                         | Learning Curve                     |
| ----- | ---------------------------------------------------------- | ---------------------------- | ---------------------------------- |
| **0** | Standard diff + colored gutter bars on AI hunks            | Default view                 | Zero — looks like GitHub           |
| **1** | Hover gutter bar → popover with prompt + first AI response | On hover                     | None — tooltips are universal      |
| **2** | Toggle conversation side panel with scroll sync            | On click / keyboard shortcut | Minimal — like Cursor's chat panel |
| **3** | Full conversation view, timeline replay, overview map      | Separate tabs                | Low — each tab is self-explanatory |

### Key Design Principles

1. **Diff is king.** Primary job is reviewing code. Conversation is supporting context.
2. **No new concepts.** Diffs, inline comments, file trees, blame — map the novel element onto familiar patterns.
3. **Show "why" not "what."** Don't repeat the AI's code in the conversation panel — the reviewer sees that in the diff. Show the human's intent (prompt) and AI's reasoning (explanation).
4. **Colors and indicators, not barriers.** Visual cues (colored gutters, small icons) show AI involvement without forcing engagement.
5. **Fast, fast, fast.** Diff renders instantly. Conversation loading is deferred. Never block diff rendering for conversation data.

---

## Adjacent Product Inspiration

| Product     | Lesson for Orchid                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| **Loom**    | Context attachment should be optional and non-intrusive. A small link, not a dominant element.           |
| **Linear**  | Clean main view, expandable side panel for details. Side panels that slide in < new pages.               |
| **Figma**   | Time-travel through iterations. Seeing code at the point of an AI suggestion is valuable.                |
| **Jupyter** | The notebook model (alternating narrative + code cells) is close to a "timeline view" of AI development. |
| **Replit**  | Location-anchored conversations (threads tied to line ranges) > free-floating chat.                      |

---

## Technical Implementation

### Diff Rendering Libraries

| Library                      | Best For                                                   | Bundle | Verdict                                         |
| ---------------------------- | ---------------------------------------------------------- | ------ | ----------------------------------------------- |
| **diff2html**                | Fast MVP. Takes unified diff → HTML.                       | ~50KB  | **MVP pick** — fast to integrate                |
| **react-diff-view**          | Hunk-level control for conversation mapping.               | ~30KB  | **Strong alternative** — better API for linking |
| **CodeMirror 6** (merge ext) | Long-term. Custom gutters, decorations, virtual scrolling. | ~150KB | **V2 migration target**                         |
| **Monaco** (diff mode)       | VS Code fidelity.                                          | ~2MB   | Overkill for display-only                       |
| **react-diff-viewer**        | Beautiful defaults but less flexible.                      | ~80KB  | Pass — performance issues with large diffs      |

### Conversation Rendering

| Concern              | Library                               |
| -------------------- | ------------------------------------- |
| Markdown             | `react-markdown` + `remark-gfm`       |
| Syntax highlighting  | `shiki` (VS Code themes, WASM-based)  |
| Collapsible sections | Native `<details>` + custom component |

### Layout

```css
.main-layout {
  display: grid;
  grid-template-columns: auto 1fr auto;
  /* Sidebar | Diff | Conversation */
}
```

Use `allotment` for VS Code-style resizable split panels. Conversation panel uses `position: sticky` or independent `overflow-y: auto`.

### Full Stack

| Concern             | Pick                                  | Why                                                      |
| ------------------- | ------------------------------------- | -------------------------------------------------------- |
| Framework           | Next.js App Router or SvelteKit       | React ecosystem for diff libs; Svelte for smaller bundle |
| Diff rendering      | `diff2html` (MVP) → CodeMirror 6 (V2) | Fast start, extensible future                            |
| Syntax highlighting | `shiki`                               | Beautiful, VS Code themes                                |
| Markdown            | `react-markdown` + `remark-gfm`       | Standard                                                 |
| Virtual scrolling   | `@tanstack/virtual`                   | Variable-height rows, framework-agnostic                 |
| Resizable panels    | `allotment`                           | VS Code-style                                            |
| Icons               | `lucide-react`                        | Clean, consistent                                        |
| Theming             | CSS custom properties + Tailwind      | Dark/light mode                                          |
| State               | Zustand or Jotai                      | Scroll sync state, panel visibility                      |

### Performance Strategy

1. **File-level virtualization**: Only render diffs for files in/near viewport (`@tanstack/virtual`)
2. **Hunk-level lazy loading**: Collapse far-away hunks, expand as user scrolls near
3. **Conversation lazy loading**: Show snippet (first message + summary) eagerly, full transcript on demand
4. **Dark mode**: CSS custom properties. Diff colors follow GitHub convention (green/red) with sufficient contrast in both modes.

---

## What Exists in This Space Today

| Product                   | What It Does                       | Gap                                   |
| ------------------------- | ---------------------------------- | ------------------------------------- |
| **Graphite**              | Clean PR review, AI summaries      | No AI conversation context            |
| **CodeRabbit / Ellipsis** | AI reviews PRs after the fact      | Doesn't show original AI conversation |
| **Devin**                 | Session replay of agent work       | Watching an agent, not reviewing a PR |
| **Cursor**                | Shows AI-generated code indicators | Local to editor, not in code review   |
| **SWE-agent / OpenHands** | Log full interaction traces        | JSON/markdown logs, no review UI      |

**No product has nailed "review PR with AI conversation context" yet. This is genuine whitespace.**
