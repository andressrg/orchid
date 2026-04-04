import { NextResponse } from 'next/server';
import pool from '@/app/lib/db';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const WEB_UI_URL = process.env.NEXT_PUBLIC_URL || process.env.VERCEL_URL || 'http://localhost:3000';

export async function POST(request: Request) {
  const event = request.headers.get('x-github-event');

  if (event !== 'pull_request') {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const { action, pull_request, repository } = await request.json();
  if (action !== 'opened' && action !== 'synchronize') {
    return NextResponse.json({ ok: true, skipped: true });
  }

  if (!GITHUB_TOKEN) {
    console.warn('GITHUB_TOKEN not set, skipping PR comment');
    return NextResponse.json({ ok: true, skipped: true, reason: 'no token' });
  }

  try {
    const branch = pull_request.head.ref;

    const result = await pool.query(
      `SELECT id, user_name, branch, started_at, updated_at, status,
              LENGTH(transcript) as transcript_length
       FROM sessions
       WHERE (git_remotes::text ILIKE $1 OR branch = $2)
       ORDER BY updated_at DESC
       LIMIT 10`,
      [`%${repository.full_name}%`, branch],
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ ok: true, sessions: 0 });
    }

    const sessions = result.rows;
    const baseUrl = WEB_UI_URL.startsWith('http') ? WEB_UI_URL : `https://${WEB_UI_URL}`;
    const sessionLines = sessions.map(
      (s: {
        id: string;
        user_name: string;
        started_at: string;
        updated_at: string;
        status: string;
        transcript_length: number;
      }) => {
        const duration = Math.round(
          (new Date(s.updated_at).getTime() - new Date(s.started_at).getTime()) / 60000,
        );
        const msgEstimate = Math.round(s.transcript_length / 500);
        const statusEmoji = s.status === 'active' ? '🟢' : '✅';
        return `- ${statusEmoji} **Session by @${s.user_name}** (${duration}m, ~${msgEstimate} messages) — [View conversation](${baseUrl}/sessions/${encodeURIComponent(s.id)})`;
      },
    );

    const comment = `🌸 **Orchid**: ${sessions.length} AI conversation${sessions.length > 1 ? 's' : ''} related to this PR

${sessionLines.join('\n')}

---
*These conversations capture the reasoning behind the code changes. Click to see the full developer-AI dialogue.*`;

    const [owner, repo] = repository.full_name.split('/');
    const ghRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${pull_request.number}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: comment }),
      },
    );

    if (!ghRes.ok) {
      const errText = await ghRes.text();
      console.error('GitHub API error:', ghRes.status, errText);
      return NextResponse.json({ error: 'GitHub API error' }, { status: 502 });
    }

    console.log(
      `Posted comment on ${repository.full_name}#${pull_request.number} with ${sessions.length} sessions`,
    );
    return NextResponse.json({ ok: true, sessions: sessions.length });
  } catch (err) {
    console.error('Webhook error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
