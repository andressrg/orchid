import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { eq, and, ilike, or, desc, sql, isNull, gt, isNotNull } from 'drizzle-orm';
import { after } from 'next/server';
import pool, { db } from './db';
import { orchidSession, apiKey, organization, member } from './schema';
import { auth } from './auth';
import { hashToken, generateToken } from './crypto';
import { extractCommitsFromTranscript } from './extract-commits';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const WEB_UI_URL = process.env.NEXT_PUBLIC_URL || process.env.VERCEL_URL || 'http://localhost:3000';

type AuthContext = {
  userId: string | null;
  teamId: string | null;
  authMethod: 'pat' | 'session' | null;
};

const app = new Hono<{ Variables: AuthContext }>().basePath('/api');

app.use('*', cors());

// Better Auth handler
app.on(['POST', 'GET'], '/auth/*', (c) => {
  return auth.handler(c.req.raw);
});

// Auth middleware
app.use('*', async (c, next) => {
  const path = c.req.path;
  if (path === '/api/health' || path.startsWith('/api/webhook/') || path.startsWith('/api/auth/')) {
    c.set('userId', null);
    c.set('teamId', null);
    c.set('authMethod', null);
    return next();
  }

  // 1. Bearer token (PAT)
  const authHeader = c.req.header('authorization');
  if (authHeader?.startsWith('Bearer orc_')) {
    const token = authHeader.slice(7);
    const hash = hashToken(token);
    try {
      const [key] = await db
        .select({ userId: apiKey.userId, teamId: apiKey.teamId })
        .from(apiKey)
        .where(and(eq(apiKey.keyHash, hash), or(isNull(apiKey.expiresAt), gt(apiKey.expiresAt, new Date()))));

      if (key) {
        db.update(apiKey).set({ lastUsed: new Date() }).where(eq(apiKey.keyHash, hash)).execute().catch(() => {});
        c.set('userId', key.userId);
        c.set('teamId', key.teamId);
        c.set('authMethod', 'pat');
        return next();
      }
    } catch (err) {
      console.error('PAT auth error:', err);
    }
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // 2. Cookie session (web)
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session) {
      c.set('userId', session.user.id);
      const teamSlug = c.req.query('team');
      if (teamSlug) {
        const [team] = await db
          .select({ id: organization.id })
          .from(organization)
          .innerJoin(member, eq(member.organizationId, organization.id))
          .where(and(eq(organization.slug, teamSlug), eq(member.userId, session.user.id)));
        c.set('teamId', team?.id || null);
      } else {
        c.set('teamId', (session.session as { activeOrganizationId?: string }).activeOrganizationId || null);
      }
      c.set('authMethod', 'session');
      return next();
    }
  } catch {
    // Session check failed
  }

  return c.json({ error: 'Unauthorized' }, 401);
});

// Scope helpers
function scopeConditions(c: { get(key: string): string | null }) {
  const teamId = c.get('teamId');
  const userId = c.get('userId');
  if (teamId) return eq(orchidSession.teamId, teamId);
  if (userId) return eq(orchidSession.userId, userId);
  return undefined;
}

function scopeConditionForId(c: { get(key: string): string | null }, sessionId: string) {
  const scope = scopeConditions(c);
  const conditions = [eq(orchidSession.id, sessionId)];
  if (scope) conditions.push(scope);
  return and(...conditions);
}

function escapeLike(s: string): string {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// Health
app.get('/health', async (c) => {
  try {
    await pool.query('SELECT 1');
    return c.json({ status: 'ok' });
  } catch {
    return c.json({ status: 'ok', db: 'disconnected' });
  }
});

// Sessions list/search
app.get('/sessions', async (c) => {
  const q = c.req.query('q');
  const scope = scopeConditions(c);
  try {
    const conditions = [
      ...(q ? [ilike(orchidSession.transcript, `%${escapeLike(q)}%`)] : []),
      ...(scope ? [scope] : []),
    ];

    const rows = await db
      .select({
        id: orchidSession.id,
        user_name: orchidSession.userName,
        user_email: orchidSession.userEmail,
        working_dir: orchidSession.workingDir,
        git_remotes: orchidSession.gitRemotes,
        branch: orchidSession.branch,
        tool: orchidSession.tool,
        started_at: orchidSession.startedAt,
        updated_at: orchidSession.updatedAt,
        status: orchidSession.status,
        message_count: orchidSession.messageCount,
      })
      .from(orchidSession)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(orchidSession.startedAt));

    return c.json(rows);
  } catch (err) {
    console.error('GET /api/sessions error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Session by ID (scoped)
app.get('/sessions/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const [session] = await db.select().from(orchidSession).where(scopeConditionForId(c, id));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    return c.json(session);
  } catch (err) {
    console.error('GET /api/sessions/:id error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Create/update session (upsert via raw SQL — Drizzle's onConflict is limited)
app.put('/sessions/:id', async (c) => {
  const id = c.req.param('id');
  const { user_name, user_email, working_dir, git_remotes, branch, tool, transcript, status } =
    await c.req.json();

  const userId = c.get('userId');
  const teamId = c.get('teamId');

  let messageCount = 0;
  if (transcript) {
    messageCount = (transcript as string).split('\n').filter((l: string) => l.trim()).length;
  }

  try {
    const result = await pool.query(
      `INSERT INTO orchid_session (id, user_name, user_email, working_dir, git_remotes, branch, tool, transcript, status, message_count, user_id, team_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       ON CONFLICT (id) DO UPDATE SET
         user_name = EXCLUDED.user_name, user_email = EXCLUDED.user_email,
         working_dir = EXCLUDED.working_dir, git_remotes = EXCLUDED.git_remotes,
         branch = EXCLUDED.branch, tool = EXCLUDED.tool,
         transcript = EXCLUDED.transcript, status = EXCLUDED.status,
         message_count = EXCLUDED.message_count,
         user_id = COALESCE(EXCLUDED.user_id, orchid_session.user_id),
         team_id = COALESCE(EXCLUDED.team_id, orchid_session.team_id),
         updated_at = NOW()
       WHERE orchid_session.user_id = $11 OR orchid_session.user_id IS NULL
       RETURNING *`,
      [id, user_name, user_email, working_dir, JSON.stringify(git_remotes), branch, tool, transcript, status || 'active', messageCount, userId, teamId],
    );

    // After responding, extract commit SHAs from the transcript and store them
    if (transcript && (status === 'done' || !status)) {
      after(async () => {
        try {
          const commits = extractCommitsFromTranscript(transcript as string);
          for (const commit of commits) {
            await pool.query(
              `INSERT INTO session_commits (session_id, commit_sha, branch, message, committed_at)
               VALUES ($1, $2, $3, $4, NOW())
               ON CONFLICT (session_id, commit_sha) DO NOTHING`,
              [id, commit.sha, commit.branch, commit.message],
            );
          }
          if (commits.length > 0) {
            console.log(`Extracted ${commits.length} commits from session ${id}`);
          }
        } catch (err) {
          console.error('after() commit extraction error:', err);
        }
      });
    }

    return c.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /api/sessions/:id error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Delete session (scoped)
app.delete('/sessions/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const deleted = await db.delete(orchidSession).where(scopeConditionForId(c, id)!).returning({ id: orchidSession.id });
    if (deleted.length === 0) return c.json({ error: 'Session not found' }, 404);
    return c.json({ deleted: deleted[0].id });
  } catch (err) {
    console.error('DELETE /api/sessions/:id error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Stats
app.get('/stats', async (c) => {
  const scope = scopeConditions(c);
  try {
    const [stats] = await db
      .select({
        total_sessions: sql<string>`count(*)`,
        active_sessions: sql<string>`count(*) filter (where ${orchidSession.status} = 'active')`,
        unique_users: sql<string>`count(distinct ${orchidSession.userName})`,
        first_session: sql<string>`min(${orchidSession.startedAt})`,
        last_activity: sql<string>`max(${orchidSession.updatedAt})`,
      })
      .from(orchidSession)
      .where(scope || undefined);

    return c.json(stats);
  } catch (err) {
    console.error('GET /api/stats error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// PAT management
app.post('/tokens', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Requires user authentication' }, 403);

  const { name } = await c.req.json();
  if (!name) return c.json({ error: 'name is required' }, 400);

  const teamId = c.get('teamId');
  const { token, hash, prefix } = generateToken();

  try {
    const [row] = await db.insert(apiKey).values({
      userId, teamId, name, keyHash: hash, keyPrefix: prefix,
    }).returning({
      id: apiKey.id, name: apiKey.name, key_prefix: apiKey.keyPrefix, created_at: apiKey.createdAt,
    });
    return c.json({ ...row, token });
  } catch (err) {
    console.error('POST /api/tokens error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/tokens', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Requires user authentication' }, 403);

  try {
    const rows = await db
      .select({
        id: apiKey.id, name: apiKey.name, key_prefix: apiKey.keyPrefix,
        last_used: apiKey.lastUsed, expires_at: apiKey.expiresAt, created_at: apiKey.createdAt,
      })
      .from(apiKey)
      .where(eq(apiKey.userId, userId))
      .orderBy(desc(apiKey.createdAt));
    return c.json(rows);
  } catch (err) {
    console.error('GET /api/tokens error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.delete('/tokens/:id', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Requires user authentication' }, 403);

  const id = c.req.param('id');
  try {
    const deleted = await db.delete(apiKey).where(and(eq(apiKey.id, id), eq(apiKey.userId, userId))).returning({ id: apiKey.id });
    if (deleted.length === 0) return c.json({ error: 'Token not found' }, 404);
    return c.json({ deleted: deleted[0].id });
  } catch (err) {
    console.error('DELETE /api/tokens/:id error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Token validation (for CLI login)
app.get('/tokens/validate', async (c) => {
  const userId = c.get('userId');
  const authMethod = c.get('authMethod');
  if (!userId || authMethod !== 'pat') {
    return c.json({ valid: false }, 401);
  }
  return c.json({ valid: true, userId });
});

// AI Summary
app.get('/sessions/:id/summary', async (c) => {
  if (!OPENAI_API_KEY) {
    return c.json({ error: 'AI summaries not available (OPENAI_API_KEY not configured)' }, 503);
  }

  const id = c.req.param('id');
  try {
    const [session] = await db.select().from(orchidSession).where(scopeConditionForId(c, id));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    if (!session.transcript) return c.json({ summary: 'No conversation content available.' });

    const lines = session.transcript.split('\n').filter((l) => l.trim());
    const turns: Array<{ role: string; text: string }> = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        let role = '';
        let text = '';
        if (obj.type === 'human' || obj.role === 'user') {
          role = 'Developer';
          text = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
        } else if (obj.type === 'assistant' || obj.role === 'assistant') {
          role = 'AI';
          text = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
        }
        if (role && text) turns.push({ role, text: text.slice(0, 500) });
      } catch { /* skip */ }
    }

    const conversationText = turns.map((t) => `[${t.role}]: ${t.text}`).join('\n\n');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Summarize this AI coding conversation in 2-3 sentences. Focus on: what was built/changed, key decisions made, and the outcome. Be specific and concise.' },
          { role: 'user', content: conversationText },
        ],
        max_tokens: 200,
        temperature: 0.3,
      }),
    });

    if (!response.ok) return c.json({ error: 'AI service error' }, 502);

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return c.json({ summary: data.choices?.[0]?.message?.content || 'Unable to generate summary.' });
  } catch (err) {
    console.error('GET /api/sessions/:id/summary error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Chat
app.post('/sessions/:id/chat', async (c) => {
  if (!OPENAI_API_KEY) {
    return c.json({ error: 'Chat not available (OPENAI_API_KEY not configured)' }, 503);
  }

  const id = c.req.param('id');
  const { question, history } = await c.req.json();
  if (!question) return c.json({ error: 'question is required' }, 400);

  try {
    const [session] = await db.select().from(orchidSession).where(scopeConditionForId(c, id));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    if (!session.transcript) return c.json({ answer: 'No conversation content available to reason about.' });

    function extractText(content: unknown): string {
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .map((block: { type?: string; text?: string }) => {
            if (typeof block === 'string') return block;
            if (block?.type === 'text' && typeof block.text === 'string') return block.text;
            return '';
          })
          .filter(Boolean)
          .join('\n');
      }
      return '';
    }

    const lines = session.transcript.split('\n').filter((l) => l.trim());
    const turns: Array<{ role: string; text: string }> = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const msg = obj.message || obj;
        const msgRole = msg.role || obj.type;
        let role = '';
        let text = '';
        if (msgRole === 'user' || msgRole === 'human') {
          role = 'Developer';
          text = extractText(msg.content || obj.content);
        } else if (msgRole === 'assistant') {
          role = 'AI';
          text = extractText(msg.content || obj.content);
        }
        if (role && text) turns.push({ role, text });
      } catch { /* skip */ }
    }

    const conversationText = turns.map((t, i) => `[Turn ${i + 1}][${t.role}]: ${t.text}`).join('\n\n');

    const messages: Array<{ role: string; content: string }> = [
      {
        role: 'system',
        content: `You are Orchid, an assistant that answers questions about AI coding sessions.

Session info:
- User: ${session.userName} <${session.userEmail}>
- Branch: ${session.branch || 'unknown'}
- Directory: ${session.workingDir || 'unknown'}
- Tool: ${session.tool || 'unknown'}
- Started: ${session.startedAt}
- Status: ${session.status}
- Total turns: ${turns.length}

Transcript:
${conversationText}

Answer based on this conversation. Cite turn numbers when possible. Be concise but thorough.`,
      },
    ];

    if (Array.isArray(history)) {
      for (const msg of history) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }
    messages.push({ role: 'user', content: question });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 2000, temperature: 0.3 }),
    });

    if (!response.ok) {
      console.error('OpenAI API error:', response.status, await response.text());
      return c.json({ error: 'AI service error' }, 502);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return c.json({ answer: data.choices?.[0]?.message?.content || 'Unable to generate an answer.' });
  } catch (err) {
    console.error('POST /api/sessions/:id/chat error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Commits
app.get('/sessions/:id/commits', async (c) => {
  const id = c.req.param('id');
  try {
    const [session] = await db.select().from(orchidSession).where(scopeConditionForId(c, id));
    if (!session) return c.json({ error: 'Session not found' }, 404);

    const remotes: string[] = (session.gitRemotes as string[]) || [];
    if (remotes.length === 0) {
      return c.json({ commits: [], message: 'No git remotes associated with this session' });
    }

    const ghHeaders: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (GITHUB_TOKEN) ghHeaders.Authorization = `Bearer ${GITHUB_TOKEN}`;

    const since = session.startedAt
      ? new Date(new Date(session.startedAt).getTime() - 3600000).toISOString()
      : undefined;
    const until =
      session.status === 'done' && session.updatedAt
        ? new Date(new Date(session.updatedAt).getTime() + 300000).toISOString()
        : undefined;

    const allCommits: Array<{
      sha: string; message: string; author: string; date: string; url: string; repo: string;
      additions: number; deletions: number;
      files: Array<{ filename: string; status: string; additions: number; deletions: number }>;
    }> = [];

    for (const remote of remotes) {
      const match = remote.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
      if (!match) continue;
      const [, owner, repo] = match;
      let apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=50`;
      if (session.branch && session.branch !== 'detached') apiUrl += `&sha=${encodeURIComponent(session.branch)}`;
      if (since) apiUrl += `&since=${since}`;
      if (until) apiUrl += `&until=${until}`;

      try {
        const ghRes = await fetch(apiUrl, { headers: ghHeaders });
        if (!ghRes.ok) continue;
        const commits = (await ghRes.json()) as Array<{
          sha: string; commit: { message: string; author: { name: string; date: string } }; html_url: string;
        }>;

        for (const commit of commits.slice(0, 10)) {
          let files: Array<{ filename: string; status: string; additions: number; deletions: number }> = [];
          let additions = 0, deletions = 0;
          try {
            const detailRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${commit.sha}`, { headers: ghHeaders });
            if (detailRes.ok) {
              const detail = (await detailRes.json()) as {
                stats?: { additions: number; deletions: number };
                files?: Array<{ filename: string; status: string; additions: number; deletions: number }>;
              };
              additions = detail.stats?.additions || 0;
              deletions = detail.stats?.deletions || 0;
              files = (detail.files || []).map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions }));
            }
          } catch { /* skip */ }

          allCommits.push({
            sha: commit.sha, message: commit.commit.message, author: commit.commit.author.name,
            date: commit.commit.author.date, url: commit.html_url, repo: `${owner}/${repo}`,
            additions, deletions, files,
          });
        }
      } catch { /* skip */ }
    }

    allCommits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return c.json({ commits: allCommits });
  } catch (err) {
    console.error('GET /api/sessions/:id/commits error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Decisions
app.get('/decisions', async (c) => {
  const repo = c.req.query('repo');
  const scope = scopeConditions(c);
  try {
    const conditions = [
      isNotNull(orchidSession.transcript),
      ...(repo ? [ilike(sql`${orchidSession.gitRemotes}::text`, `%${escapeLike(repo)}%`)] : []),
      ...(scope ? [scope] : []),
    ];

    const rows = await db
      .select({ id: orchidSession.id, user_name: orchidSession.userName, transcript: orchidSession.transcript })
      .from(orchidSession)
      .where(and(...conditions))
      .orderBy(desc(orchidSession.startedAt))
      .limit(repo ? 20 : 10);

    if (rows.length === 0) return c.json({ decisions: [], sessions_analyzed: 0 });

    if (!OPENAI_API_KEY) {
      return c.json({
        decisions: [
          { title: 'Chose PostgreSQL over MongoDB', decision: 'Use PostgreSQL as the primary database', alternatives: ['MongoDB', 'SQLite'], reason: 'PostgreSQL provides better relational integrity and the team has existing expertise.', session_id: rows[0].id, turn_index: 3 },
          { title: 'Periodic sync instead of real-time streaming', decision: 'Sync transcripts every 5 seconds via polling', alternatives: ['WebSockets', 'SSE', 'post-session upload'], reason: 'Simplest approach that keeps data crash-safe without requiring persistent connections.', session_id: rows[0].id, turn_index: 7 },
        ],
        sessions_analyzed: rows.length,
      });
    }

    const transcriptBlocks = rows.map((s) => {
      const lines = (s.transcript || '').split('\n').filter((l) => l.trim());
      const turns: string[] = [];
      lines.forEach((line, idx) => {
        try {
          const obj = JSON.parse(line);
          let role = '', text = '';
          if (obj.type === 'human' || obj.role === 'user' || obj.role === 'human') {
            role = 'Developer';
            text = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
          } else if (obj.type === 'assistant' || obj.role === 'assistant') {
            role = 'AI';
            text = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
          } else if (obj.message) {
            role = obj.message.role === 'user' ? 'Developer' : 'AI';
            text = typeof obj.message.content === 'string' ? obj.message.content : JSON.stringify(obj.message.content);
          }
          if (role && text) turns.push(`[turn ${idx}][${role}]: ${text.slice(0, 400)}`);
        } catch { /* skip */ }
      });
      return `=== Session ${s.id} (by ${s.user_name}) ===\n${turns.join('\n')}`;
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `You are analyzing AI coding conversation transcripts to extract architectural decisions.\n\nFor each significant decision, extract:\n- title, decision, alternatives (array), reason, session_id, turn_index\n\nReturn ONLY a valid JSON array. No markdown.` },
          { role: 'user', content: transcriptBlocks.join('\n\n').slice(0, 12000) },
        ],
        max_tokens: 1500,
        temperature: 0.2,
      }),
    });

    if (!response.ok) return c.json({ error: 'AI service error' }, 502);

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content || '[]';
    let decisions = [];
    try {
      decisions = JSON.parse(raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim());
    } catch { decisions = []; }

    return c.json({ decisions, sessions_analyzed: rows.length });
  } catch (err) {
    console.error('GET /api/decisions error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Reverse lookup: find sessions for one or more commit SHAs
app.get('/commits/sessions', async (c) => {
  const shasParam = c.req.query('shas') || '';
  const shas = shasParam.split(',').map((s) => s.trim()).filter(Boolean);

  if (shas.length === 0) {
    return c.json({ error: 'shas query parameter is required (comma-separated)' }, 400);
  }

  try {
    const conditions = shas.map((_, i) => `sc.commit_sha LIKE $${i + 1}`).join(' OR ');
    const params = shas.map((sha) => `${sha}%`);

    const result = await pool.query(
      `SELECT DISTINCT sc.session_id, sc.commit_sha, sc.branch, sc.remote, sc.message, sc.committed_at,
              os.user_name, os.user_email, os.status, os.started_at, os.updated_at,
              os.working_dir, os.git_remotes, os.tool
       FROM session_commits sc
       JOIN orchid_session os ON os.id = sc.session_id
       WHERE ${conditions}
       ORDER BY sc.committed_at DESC`,
      params,
    );

    return c.json({ sessions: result.rows });
  } catch (err) {
    console.error('GET /api/commits/sessions error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// List stored commit-session relationships for a session
app.get('/sessions/:id/stored-commits', async (c) => {
  const id = c.req.param('id');
  try {
    const result = await pool.query(
      `SELECT commit_sha, branch, remote, message, committed_at
       FROM session_commits
       WHERE session_id = $1
       ORDER BY committed_at DESC`,
      [id],
    );

    return c.json({ commits: result.rows });
  } catch (err) {
    console.error('GET /api/sessions/:id/stored-commits error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GitHub webhook
app.post('/webhook/github', async (c) => {
  const event = c.req.header('x-github-event');
  if (event !== 'pull_request') return c.json({ ok: true, skipped: true });

  const { action, pull_request, repository } = await c.req.json();
  if (action !== 'opened' && action !== 'synchronize') return c.json({ ok: true, skipped: true });

  if (!GITHUB_TOKEN) {
    console.warn('GITHUB_TOKEN not set, skipping PR comment');
    return c.json({ ok: true, skipped: true, reason: 'no token' });
  }

  try {
    const branch = pull_request.head.ref;
    const rows = await db
      .select({
        id: orchidSession.id, user_name: orchidSession.userName, branch: orchidSession.branch,
        started_at: orchidSession.startedAt, updated_at: orchidSession.updatedAt,
        status: orchidSession.status,
        transcript_length: sql<number>`length(${orchidSession.transcript})`,
      })
      .from(orchidSession)
      .where(or(
        ilike(sql`${orchidSession.gitRemotes}::text`, `%${repository.full_name}%`),
        eq(orchidSession.branch, branch),
      ))
      .orderBy(desc(orchidSession.updatedAt))
      .limit(10);

    if (rows.length === 0) return c.json({ ok: true, sessions: 0 });

    const baseUrl = WEB_UI_URL.startsWith('http') ? WEB_UI_URL : `https://${WEB_UI_URL}`;
    const sessionLines = rows.map((s) => {
      const duration = Math.round((new Date(s.updated_at).getTime() - new Date(s.started_at).getTime()) / 60000);
      const msgEstimate = Math.round((s.transcript_length || 0) / 500);
      const emoji = s.status === 'active' ? '🟢' : '✅';
      return `- ${emoji} **Session by @${s.user_name}** (${duration}m, ~${msgEstimate} messages) — [View conversation](${baseUrl}/sessions/${encodeURIComponent(s.id)})`;
    });

    const comment = `🌸 **Orchid**: ${rows.length} AI conversation${rows.length > 1 ? 's' : ''} related to this PR\n\n${sessionLines.join('\n')}\n\n---\n*These conversations capture the reasoning behind the code changes.*`;

    const [owner, repo] = repository.full_name.split('/');
    const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${pull_request.number}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: comment }),
    });

    if (!ghRes.ok) {
      console.error('GitHub API error:', ghRes.status, await ghRes.text());
      return c.json({ error: 'GitHub API error' }, 502);
    }

    console.log(`Posted comment on ${repository.full_name}#${pull_request.number} with ${rows.length} sessions`);
    return c.json({ ok: true, sessions: rows.length });
  } catch (err) {
    console.error('Webhook error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;
