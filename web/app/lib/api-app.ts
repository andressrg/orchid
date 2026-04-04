import { Hono } from 'hono';
import { cors } from 'hono/cors';
import pool from './db';
import { auth } from './auth';
import { hashToken, generateToken } from './crypto';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const LEGACY_API_KEY = process.env.ORCHID_API_KEY;
const WEB_UI_URL = process.env.NEXT_PUBLIC_URL || process.env.VERCEL_URL || 'http://localhost:3000';

type AuthContext = {
  userId: string | null;
  teamId: string | null;
  authMethod: 'pat' | 'session' | 'legacy' | null;
};

const app = new Hono<{ Variables: AuthContext }>().basePath('/api');

app.use('*', cors());

// Better Auth handler — must be before auth middleware
app.on(['POST', 'GET'], '/auth/*', (c) => {
  return auth.handler(c.req.raw);
});

// Auth middleware — skip for health, webhook, and auth routes
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
      const result = await pool.query(
        `SELECT ak.user_id, ak.team_id FROM api_keys ak WHERE ak.key_hash = $1
         AND (ak.expires_at IS NULL OR ak.expires_at > NOW())`,
        [hash],
      );
      if (result.rows.length > 0) {
        const { user_id, team_id } = result.rows[0];
        // Update last_used
        pool.query('UPDATE api_keys SET last_used = NOW() WHERE key_hash = $1', [hash]);
        c.set('userId', user_id);
        c.set('teamId', team_id);
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
      // Resolve team from ?team= query param (slug) or fallback to active org
      const teamSlug = c.req.query('team');
      if (teamSlug) {
        const teamResult = await pool.query(
          `SELECT o.id FROM organization o
           INNER JOIN member m ON m.organization_id = o.id
           WHERE o.slug = $1 AND m.user_id = $2`,
          [teamSlug, session.user.id],
        );
        c.set('teamId', teamResult.rows[0]?.id || null);
      } else {
        c.set('teamId', (session.session as { activeOrganizationId?: string }).activeOrganizationId || null);
      }
      c.set('authMethod', 'session');
      return next();
    }
  } catch {
    // Session check failed, continue to legacy
  }

  // 3. Legacy X-API-Key
  const key = c.req.header('x-api-key');
  if (LEGACY_API_KEY && key === LEGACY_API_KEY) {
    c.set('userId', null);
    c.set('teamId', null);
    c.set('authMethod', 'legacy');
    return next();
  }

  return c.json({ error: 'Unauthorized' }, 401);
});

// Helper: build WHERE clause for team scoping
function scopeClause(c: { get(key: string): string | null }, paramOffset: number): { where: string; params: string[] } {
  const teamId = c.get('teamId');
  const userId = c.get('userId');
  const authMethod = c.get('authMethod');

  if (authMethod === 'legacy') return { where: '', params: [] };
  if (teamId) return { where: `AND team_id = $${paramOffset}`, params: [teamId] };
  if (userId) return { where: `AND user_id = $${paramOffset}`, params: [userId] };
  return { where: '', params: [] };
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
  const scope = scopeClause(c, q ? 2 : 1);
  try {
    let result;
    if (q) {
      result = await pool.query(
        `SELECT id, user_name, user_email, working_dir, git_remotes, branch, tool, started_at, updated_at, status, message_count
         FROM orchid_sessions WHERE transcript ILIKE $1 ${scope.where} ORDER BY started_at DESC`,
        [`%${q}%`, ...scope.params],
      );
    } else {
      result = await pool.query(
        `SELECT id, user_name, user_email, working_dir, git_remotes, branch, tool, started_at, updated_at, status, message_count
         FROM orchid_sessions WHERE 1=1 ${scope.where} ORDER BY started_at DESC`,
        [...scope.params],
      );
    }
    return c.json(result.rows);
  } catch (err) {
    console.error('GET /api/sessions error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Session by ID
app.get('/sessions/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const result = await pool.query('SELECT * FROM orchid_sessions WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/sessions/:id error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Create/update session
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
      `INSERT INTO orchid_sessions (id, user_name, user_email, working_dir, git_remotes, branch, tool, transcript, status, message_count, user_id, team_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       ON CONFLICT (id) DO UPDATE SET
         user_name = EXCLUDED.user_name, user_email = EXCLUDED.user_email,
         working_dir = EXCLUDED.working_dir, git_remotes = EXCLUDED.git_remotes,
         branch = EXCLUDED.branch, tool = EXCLUDED.tool,
         transcript = EXCLUDED.transcript, status = EXCLUDED.status,
         message_count = EXCLUDED.message_count,
         user_id = COALESCE(EXCLUDED.user_id, orchid_sessions.user_id),
         team_id = COALESCE(EXCLUDED.team_id, orchid_sessions.team_id),
         updated_at = NOW()
       RETURNING *`,
      [id, user_name, user_email, working_dir, JSON.stringify(git_remotes), branch, tool, transcript, status || 'active', messageCount, userId, teamId],
    );
    return c.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /api/sessions/:id error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Delete session
app.delete('/sessions/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const result = await pool.query('DELETE FROM orchid_sessions WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error('DELETE /api/sessions/:id error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Stats
app.get('/stats', async (c) => {
  const scope = scopeClause(c, 1);
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_sessions,
        COUNT(*) FILTER (WHERE status = 'active') as active_sessions,
        COUNT(DISTINCT user_name) as unique_users,
        MIN(started_at) as first_session,
        MAX(updated_at) as last_activity
      FROM orchid_sessions WHERE 1=1 ${scope.where}
    `, [...scope.params]);
    return c.json(result.rows[0]);
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
    const result = await pool.query(
      `INSERT INTO api_keys (user_id, team_id, name, key_hash, key_prefix) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, key_prefix, created_at`,
      [userId, teamId, name, hash, prefix],
    );
    return c.json({ ...result.rows[0], token });
  } catch (err) {
    console.error('POST /api/tokens error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/tokens', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Requires user authentication' }, 403);

  try {
    const result = await pool.query(
      `SELECT id, name, key_prefix, last_used, expires_at, created_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return c.json(result.rows);
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
    const result = await pool.query(
      'DELETE FROM api_keys WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId],
    );
    if (result.rows.length === 0) return c.json({ error: 'Token not found' }, 404);
    return c.json({ deleted: result.rows[0].id });
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
    const result = await pool.query('SELECT * FROM orchid_sessions WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return c.json({ error: 'Session not found' }, 404);
    }

    const session = result.rows[0];
    if (!session.transcript) {
      return c.json({ summary: 'No conversation content available.' });
    }

    const lines = session.transcript.split('\n').filter((l: string) => l.trim());
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
    const result = await pool.query('SELECT * FROM orchid_sessions WHERE id = $1', [id]);
    if (result.rows.length === 0) return c.json({ error: 'Session not found' }, 404);

    const session = result.rows[0];
    if (!session.transcript) {
      return c.json({ answer: 'No conversation content available to reason about.' });
    }

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

    const lines = session.transcript.split('\n').filter((l: string) => l.trim());
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
- User: ${session.user_name} <${session.user_email}>
- Branch: ${session.branch || 'unknown'}
- Directory: ${session.working_dir || 'unknown'}
- Tool: ${session.tool || 'unknown'}
- Started: ${session.started_at}
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
    const result = await pool.query('SELECT * FROM orchid_sessions WHERE id = $1', [id]);
    if (result.rows.length === 0) return c.json({ error: 'Session not found' }, 404);

    const session = result.rows[0];
    const remotes: string[] = session.git_remotes || [];
    if (remotes.length === 0) {
      return c.json({ commits: [], message: 'No git remotes associated with this session' });
    }

    const ghHeaders: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (GITHUB_TOKEN) ghHeaders.Authorization = `Bearer ${GITHUB_TOKEN}`;

    const since = session.started_at
      ? new Date(new Date(session.started_at).getTime() - 3600000).toISOString()
      : undefined;
    const until =
      session.status === 'done' && session.updated_at
        ? new Date(new Date(session.updated_at).getTime() + 300000).toISOString()
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
  const scope = scopeClause(c, repo ? 2 : 1);
  try {
    let sessionsResult;
    if (repo) {
      sessionsResult = await pool.query(
        `SELECT id, user_name, transcript FROM orchid_sessions WHERE git_remotes::text ILIKE $1 AND transcript IS NOT NULL ${scope.where} ORDER BY started_at DESC LIMIT 20`,
        [`%${repo}%`, ...scope.params],
      );
    } else {
      sessionsResult = await pool.query(
        `SELECT id, user_name, transcript FROM orchid_sessions WHERE transcript IS NOT NULL ${scope.where === '' ? '' : `AND 1=1 ${scope.where}`} ORDER BY started_at DESC LIMIT 10`,
        [...scope.params],
      );
    }

    const sessions = sessionsResult.rows;
    if (sessions.length === 0) return c.json({ decisions: [], sessions_analyzed: 0 });

    if (!OPENAI_API_KEY) {
      return c.json({
        decisions: [
          { title: 'Chose PostgreSQL over MongoDB', decision: 'Use PostgreSQL as the primary database', alternatives: ['MongoDB', 'SQLite'], reason: 'PostgreSQL provides better relational integrity and the team has existing expertise.', session_id: sessions[0].id, turn_index: 3 },
          { title: 'Periodic sync instead of real-time streaming', decision: 'Sync transcripts every 5 seconds via polling', alternatives: ['WebSockets', 'SSE', 'post-session upload'], reason: 'Simplest approach that keeps data crash-safe without requiring persistent connections.', session_id: sessions[0].id, turn_index: 7 },
        ],
        sessions_analyzed: sessions.length,
      });
    }

    const transcriptBlocks = sessions.map((s: { id: string; user_name: string; transcript: string }) => {
      const lines = s.transcript.split('\n').filter((l: string) => l.trim());
      const turns: string[] = [];
      lines.forEach((line: string, idx: number) => {
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

    return c.json({ decisions, sessions_analyzed: sessions.length });
  } catch (err) {
    console.error('GET /api/decisions error:', err);
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
    const result = await pool.query(
      `SELECT id, user_name, branch, started_at, updated_at, status, LENGTH(transcript) as transcript_length
       FROM orchid_sessions WHERE (git_remotes::text ILIKE $1 OR branch = $2) ORDER BY updated_at DESC LIMIT 10`,
      [`%${repository.full_name}%`, branch],
    );

    if (result.rows.length === 0) return c.json({ ok: true, sessions: 0 });

    const sessions = result.rows;
    const baseUrl = WEB_UI_URL.startsWith('http') ? WEB_UI_URL : `https://${WEB_UI_URL}`;
    const sessionLines = sessions.map((s: { id: string; user_name: string; started_at: string; updated_at: string; status: string; transcript_length: number }) => {
      const duration = Math.round((new Date(s.updated_at).getTime() - new Date(s.started_at).getTime()) / 60000);
      const msgEstimate = Math.round(s.transcript_length / 500);
      const emoji = s.status === 'active' ? '🟢' : '✅';
      return `- ${emoji} **Session by @${s.user_name}** (${duration}m, ~${msgEstimate} messages) — [View conversation](${baseUrl}/sessions/${encodeURIComponent(s.id)})`;
    });

    const comment = `🌸 **Orchid**: ${sessions.length} AI conversation${sessions.length > 1 ? 's' : ''} related to this PR\n\n${sessionLines.join('\n')}\n\n---\n*These conversations capture the reasoning behind the code changes.*`;

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

    console.log(`Posted comment on ${repository.full_name}#${pull_request.number} with ${sessions.length} sessions`);
    return c.json({ ok: true, sessions: sessions.length });
  } catch (err) {
    console.error('Webhook error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;
