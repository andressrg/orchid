import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import pool from "./db";
import { runMigrations } from "./migrate";

const app: Express = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
const API_KEY = process.env.API_KEY;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.json({ status: "ok", db: "disconnected" });
  }
});

function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["x-api-key"];
  if (!API_KEY || key !== API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

app.put("/sessions/:id", requireApiKey, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { user_name, user_email, working_dir, git_remotes, branch, tool, transcript, status } = req.body;

  // Count messages in transcript
  let messageCount = 0;
  if (transcript) {
    const lines = (transcript as string).split("\n").filter((l: string) => l.trim());
    messageCount = lines.length;
  }

  try {
    const result = await pool.query(
      `INSERT INTO sessions (id, user_name, user_email, working_dir, git_remotes, branch, tool, transcript, status, message_count, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (id) DO UPDATE SET
         user_name     = EXCLUDED.user_name,
         user_email    = EXCLUDED.user_email,
         working_dir   = EXCLUDED.working_dir,
         git_remotes   = EXCLUDED.git_remotes,
         branch        = EXCLUDED.branch,
         tool          = EXCLUDED.tool,
         transcript    = EXCLUDED.transcript,
         status        = EXCLUDED.status,
         message_count = EXCLUDED.message_count,
         updated_at    = NOW()
       RETURNING *`,
      [id, user_name, user_email, working_dir, JSON.stringify(git_remotes), branch, tool, transcript, status || "active", messageCount]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT /sessions/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/sessions", requireApiKey, async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string | undefined;
    let result;
    if (q) {
      result = await pool.query(
        `SELECT id, user_name, user_email, working_dir, git_remotes, branch, tool, started_at, updated_at, status, message_count
         FROM sessions
         WHERE transcript ILIKE $1
         ORDER BY started_at DESC`,
        [`%${q}%`]
      );
    } else {
      result = await pool.query(
        `SELECT id, user_name, user_email, working_dir, git_remotes, branch, tool, started_at, updated_at, status, message_count
         FROM sessions
         ORDER BY started_at DESC`
      );
    }
    res.json(result.rows);
  } catch (err) {
    console.error("GET /sessions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/sessions/:id", requireApiKey, async (req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT * FROM sessions WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("GET /sessions/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/stats", requireApiKey, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_sessions,
        COUNT(*) FILTER (WHERE status = 'active') as active_sessions,
        COUNT(DISTINCT user_name) as unique_users,
        MIN(started_at) as first_session,
        MAX(updated_at) as last_activity
      FROM sessions
    `);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("GET /stats error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/sessions/:id", requireApiKey, async (req: Request, res: Response) => {
  try {
    const result = await pool.query("DELETE FROM sessions WHERE id = $1 RETURNING id", [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error("DELETE /sessions/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// AI summary endpoint
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.get("/sessions/:id/summary", requireApiKey, async (req: Request, res: Response) => {
  if (!OPENAI_API_KEY) {
    res.status(503).json({ error: "AI summaries not available (OPENAI_API_KEY not configured)" });
    return;
  }

  try {
    const result = await pool.query("SELECT * FROM sessions WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const session = result.rows[0];
    if (!session.transcript) {
      res.json({ summary: "No conversation content available." });
      return;
    }

    // Parse transcript into turns
    const lines = session.transcript.split("\n").filter((l: string) => l.trim());
    const turns: Array<{ role: string; text: string }> = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        let role = "";
        let text = "";
        if (obj.type === "human" || obj.role === "user") {
          role = "Developer";
          text = typeof obj.content === "string" ? obj.content : JSON.stringify(obj.content);
        } else if (obj.type === "assistant" || obj.role === "assistant") {
          role = "AI";
          text = typeof obj.content === "string" ? obj.content : JSON.stringify(obj.content);
        }
        if (role && text) {
          turns.push({ role, text: text.slice(0, 500) });
        }
      } catch {
        // skip
      }
    }

    const conversationText = turns
      .map((t) => `[${t.role}]: ${t.text}`)
      .join("\n\n");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4-nano",
        messages: [
          {
            role: "system",
            content: "Summarize this AI coding conversation in 2-3 sentences. Focus on: what was built/changed, key decisions made, and the outcome. Be specific and concise.",
          },
          {
            role: "user",
            content: conversationText,
          },
        ],
        max_tokens: 200,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      res.status(502).json({ error: "AI service error" });
      return;
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const summary = data.choices?.[0]?.message?.content || "Unable to generate summary.";

    res.json({ summary });
  } catch (err) {
    console.error("GET /sessions/:id/summary error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Decision Log: extract architectural decisions from sessions using AI
app.get("/decisions", requireApiKey, async (req: Request, res: Response) => {
  const repo = req.query.repo as string | undefined;

  try {
    let sessionsResult;
    if (repo) {
      sessionsResult = await pool.query(
        `SELECT id, user_name, transcript FROM sessions
         WHERE git_remotes::text ILIKE $1 AND transcript IS NOT NULL
         ORDER BY started_at DESC LIMIT 20`,
        [`%${repo}%`]
      );
    } else {
      sessionsResult = await pool.query(
        `SELECT id, user_name, transcript FROM sessions
         WHERE transcript IS NOT NULL
         ORDER BY started_at DESC LIMIT 10`
      );
    }

    const sessions = sessionsResult.rows;
    if (sessions.length === 0) {
      res.json({ decisions: [], sessions_analyzed: 0 });
      return;
    }

    if (!OPENAI_API_KEY) {
      // Return mock data when no API key
      res.json({
        decisions: [
          {
            title: "Chose PostgreSQL over MongoDB",
            decision: "Use PostgreSQL as the primary database",
            alternatives: ["MongoDB", "SQLite"],
            reason: "PostgreSQL provides better relational integrity and the team has existing expertise.",
            session_id: sessions[0].id,
            turn_index: 3,
          },
          {
            title: "Periodic sync instead of real-time streaming",
            decision: "Sync transcripts every 5 seconds via polling",
            alternatives: ["WebSockets", "SSE", "post-session upload"],
            reason: "Simplest approach that keeps data crash-safe without requiring persistent connections.",
            session_id: sessions[0].id,
            turn_index: 7,
          },
        ],
        sessions_analyzed: sessions.length,
      });
      return;
    }

    // Build transcript content per session
    const transcriptBlocks = sessions.map((s: { id: string; user_name: string; transcript: string }) => {
      const lines = s.transcript.split("\n").filter((l: string) => l.trim());
      const turns: string[] = [];
      lines.forEach((line: string, idx: number) => {
        try {
          const obj = JSON.parse(line);
          let role = "";
          let text = "";
          if (obj.type === "human" || obj.role === "user" || obj.role === "human") {
            role = "Developer";
            text = typeof obj.content === "string" ? obj.content : JSON.stringify(obj.content);
          } else if (obj.type === "assistant" || obj.role === "assistant") {
            role = "AI";
            text = typeof obj.content === "string" ? obj.content : JSON.stringify(obj.content);
          } else if (obj.message) {
            role = obj.message.role === "user" ? "Developer" : "AI";
            text = typeof obj.message.content === "string" ? obj.message.content : JSON.stringify(obj.message.content);
          }
          if (role && text) {
            turns.push(`[turn ${idx}][${role}]: ${text.slice(0, 400)}`);
          }
        } catch { /* skip */ }
      });
      return `=== Session ${s.id} (by ${s.user_name}) ===\n${turns.join("\n")}`;
    });

    const combinedTranscript = transcriptBlocks.join("\n\n");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4-nano",
        messages: [
          {
            role: "system",
            content: `You are analyzing AI coding conversation transcripts to extract architectural decisions.

For each significant architectural or technical decision made, extract:
- title: short decision title (e.g. "Chose PostgreSQL over MongoDB")
- decision: what was decided (1 sentence)
- alternatives: array of alternatives that were considered (strings, can be empty)
- reason: why this was chosen (1-2 sentences)
- session_id: the session ID (from "=== Session <id> ===" header) where this decision was made
- turn_index: the number from [turn N] tag of the turn where this decision was made or finalized

Return ONLY a valid JSON array of decision objects. No markdown, no explanation. Only include real decisions visible in the transcripts, not implementation details.`,
          },
          {
            role: "user",
            content: combinedTranscript.slice(0, 12000),
          },
        ],
        max_tokens: 1500,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      res.status(502).json({ error: "AI service error" });
      return;
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content || "[]";

    let decisions = [];
    try {
      // Strip any markdown code fences if present
      const cleaned = raw.replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();
      decisions = JSON.parse(cleaned);
    } catch {
      decisions = [];
    }

    res.json({ decisions, sessions_analyzed: sessions.length });
  } catch (err) {
    console.error("GET /decisions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Chat endpoint: ask questions about a session's conversation
app.post("/sessions/:id/chat", requireApiKey, async (req: Request, res: Response) => {
  if (!OPENAI_API_KEY) {
    res.status(503).json({ error: "Chat not available (OPENAI_API_KEY not configured)" });
    return;
  }

  const { question, history } = req.body;
  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  try {
    const result = await pool.query("SELECT * FROM sessions WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const session = result.rows[0];
    if (!session.transcript) {
      res.json({ answer: "No conversation content available to reason about." });
      return;
    }

    // Parse transcript into turns — handle multiple JSONL formats from Claude Code
    const lines = session.transcript.split("\n").filter((l: string) => l.trim());
    const turns: Array<{ role: string; text: string }> = [];

    function extractText(content: unknown): string {
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .map((block: { type?: string; text?: string }) => {
            if (typeof block === "string") return block;
            if (block && block.type === "text" && typeof block.text === "string") return block.text;
            return "";
          })
          .filter(Boolean)
          .join("\n");
      }
      return "";
    }

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        let role = "";
        let text = "";

        // Check obj.message first (Claude Code JSONL wraps messages)
        const msg = obj.message || obj;
        const msgRole = msg.role || obj.type;

        if (msgRole === "user" || msgRole === "human") {
          role = "Developer";
          text = extractText(msg.content || obj.content);
        } else if (msgRole === "assistant") {
          role = "AI";
          text = extractText(msg.content || obj.content);
        }

        if (role && text) {
          turns.push({ role, text });
        }
      } catch {
        // skip
      }
    }

    // Send the full conversation to a capable model
    const conversationText = turns
      .map((t, i) => `[Turn ${i + 1}][${t.role}]: ${t.text}`)
      .join("\n\n");

    // Build chat messages with optional history
    const messages: Array<{ role: string; content: string }> = [
      {
        role: "system",
        content: `You are Orchid, an assistant that answers questions about AI coding sessions. You have access to the full conversation between a developer and an AI coding assistant.

Session info:
- User: ${session.user_name} <${session.user_email}>
- Branch: ${session.branch || "unknown"}
- Directory: ${session.working_dir || "unknown"}
- Tool: ${session.tool || "unknown"}
- Started: ${session.started_at}
- Status: ${session.status}
- Total turns: ${turns.length}

Here is the full conversation transcript:

${conversationText}

Answer the user's question based on this conversation. Be specific and cite relevant parts (by turn number) when possible. If the answer isn't in the conversation, say so. Be concise but thorough.`,
      },
    ];

    // Add conversation history if provided
    if (Array.isArray(history)) {
      for (const msg of history) {
        if (msg.role === "user" || msg.role === "assistant") {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }

    messages.push({ role: "user", content: question });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4-nano",
        messages,
        max_tokens: 2000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("OpenAI API error:", response.status, errBody);
      res.status(502).json({ error: "AI service error" });
      return;
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const answer = data.choices?.[0]?.message?.content || "Unable to generate an answer.";

    res.json({ answer });
  } catch (err) {
    console.error("POST /sessions/:id/chat error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Commits for a session (from transcript parsing)
app.get("/sessions/:id/commits", requireApiKey, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT commit_sha, branch, remote, message, committed_at
       FROM session_commits
       WHERE session_id = $1
       ORDER BY committed_at DESC`,
      [req.params.id]
    );

    res.json({ commits: result.rows });
  } catch (err) {
    console.error("GET /sessions/:id/commits error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Reverse lookup: find sessions for one or more commit SHAs
app.get("/commits/sessions", requireApiKey, async (req: Request, res: Response) => {
  const shasParam = (req.query.shas as string) || "";
  const shas = shasParam.split(",").map((s) => s.trim()).filter(Boolean);

  if (shas.length === 0) {
    res.status(400).json({ error: "shas query parameter is required (comma-separated)" });
    return;
  }

  try {
    const conditions = shas.map((_, i) => `sc.commit_sha LIKE $${i + 1}`).join(" OR ");
    const params = shas.map((sha) => `${sha}%`);

    const result = await pool.query(
      `SELECT DISTINCT sc.session_id, sc.commit_sha, sc.branch, sc.remote, sc.message, sc.committed_at,
              s.user_name, s.user_email, s.status, s.started_at, s.updated_at, s.working_dir,
              s.git_remotes, s.tool
       FROM session_commits sc
       JOIN sessions s ON s.id = sc.session_id
       WHERE ${conditions}
       ORDER BY sc.committed_at DESC`,
      params
    );

    res.json({ sessions: result.rows });
  } catch (err) {
    console.error("GET /commits/sessions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// GitHub webhook: auto-comment on PRs with related conversations
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const WEB_UI_URL = process.env.WEB_UI_URL || "http://24.144.97.81";

app.post("/webhook/github", async (req: Request, res: Response) => {
  const event = req.headers["x-github-event"] as string;

  if (event !== "pull_request") {
    res.json({ ok: true, skipped: true });
    return;
  }

  const { action, pull_request, repository } = req.body;
  if (action !== "opened" && action !== "synchronize") {
    res.json({ ok: true, skipped: true });
    return;
  }

  if (!GITHUB_TOKEN) {
    console.warn("GITHUB_TOKEN not set, skipping PR comment");
    res.json({ ok: true, skipped: true, reason: "no token" });
    return;
  }

  try {
    const repoUrl = repository.clone_url || repository.html_url;
    const branch = pull_request.head.ref;

    // Find sessions that match this repo and/or branch
    const result = await pool.query(
      `SELECT id, user_name, branch, started_at, updated_at, status,
              LENGTH(transcript) as transcript_length
       FROM sessions
       WHERE (git_remotes::text ILIKE $1 OR branch = $2)
       ORDER BY updated_at DESC
       LIMIT 10`,
      [`%${repository.full_name}%`, branch]
    );

    if (result.rows.length === 0) {
      res.json({ ok: true, sessions: 0 });
      return;
    }

    // Build the comment
    const sessions = result.rows;
    const sessionLines = sessions.map((s: { id: string; user_name: string; branch: string; started_at: string; updated_at: string; status: string; transcript_length: number }) => {
      const duration = Math.round(
        (new Date(s.updated_at).getTime() - new Date(s.started_at).getTime()) / 60000
      );
      const msgEstimate = Math.round(s.transcript_length / 500);
      const statusEmoji = s.status === "active" ? "🟢" : "✅";
      return `- ${statusEmoji} **Session by @${s.user_name}** (${duration}m, ~${msgEstimate} messages) — [View conversation](${WEB_UI_URL}/sessions/${encodeURIComponent(s.id)})`;
    });

    const comment = `🌸 **Orchid**: ${sessions.length} AI conversation${sessions.length > 1 ? "s" : ""} related to this PR

${sessionLines.join("\n")}

---
*These conversations capture the reasoning behind the code changes. Click to see the full developer-AI dialogue.*`;

    // Post to GitHub
    const [owner, repo] = repository.full_name.split("/");
    const ghRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${pull_request.number}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body: comment }),
      }
    );

    if (!ghRes.ok) {
      const errText = await ghRes.text();
      console.error("GitHub API error:", ghRes.status, errText);
      res.status(502).json({ error: "GitHub API error" });
      return;
    }

    console.log(`Posted comment on ${repository.full_name}#${pull_request.number} with ${sessions.length} sessions`);
    res.json({ ok: true, sessions: sessions.length });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function start() {
  try {
    await runMigrations();
  } catch (err) {
    console.error("Migration failed:", err);
  }

  app.listen(PORT, () => {
    console.log(`Orchid server listening on port ${PORT}`);
    if (!API_KEY) {
      console.warn("WARNING: API_KEY is not set");
    }
  });
}

start();

export default app;
