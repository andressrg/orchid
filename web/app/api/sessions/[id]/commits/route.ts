import { NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { requireApiKey } from '@/app/lib/auth';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { id } = await params;

  try {
    const result = await pool.query('SELECT * FROM sessions WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const session = result.rows[0];
    const remotes: string[] = session.git_remotes || [];

    if (remotes.length === 0) {
      return NextResponse.json({
        commits: [],
        message: 'No git remotes associated with this session',
      });
    }

    const ghHeaders: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (GITHUB_TOKEN) {
      ghHeaders.Authorization = `Bearer ${GITHUB_TOKEN}`;
    }

    const since = session.started_at
      ? new Date(new Date(session.started_at).getTime() - 3600000).toISOString()
      : undefined;
    const until =
      session.status === 'done' && session.updated_at
        ? new Date(new Date(session.updated_at).getTime() + 300000).toISOString()
        : undefined;

    const allCommits: Array<{
      sha: string;
      message: string;
      author: string;
      date: string;
      url: string;
      repo: string;
      additions: number;
      deletions: number;
      files: Array<{
        filename: string;
        status: string;
        additions: number;
        deletions: number;
      }>;
    }> = [];

    for (const remote of remotes) {
      const match = remote.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
      if (!match) continue;

      const [, owner, repo] = match;
      let apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=50`;
      if (session.branch && session.branch !== 'detached') {
        apiUrl += `&sha=${encodeURIComponent(session.branch)}`;
      }
      if (since) apiUrl += `&since=${since}`;
      if (until) apiUrl += `&until=${until}`;

      try {
        const ghRes = await fetch(apiUrl, { headers: ghHeaders });
        if (!ghRes.ok) continue;

        const commits = (await ghRes.json()) as Array<{
          sha: string;
          commit: { message: string; author: { name: string; date: string } };
          html_url: string;
        }>;

        for (const commit of commits.slice(0, 10)) {
          let files: Array<{
            filename: string;
            status: string;
            additions: number;
            deletions: number;
          }> = [];
          let additions = 0;
          let deletions = 0;

          try {
            const detailRes = await fetch(
              `https://api.github.com/repos/${owner}/${repo}/commits/${commit.sha}`,
              { headers: ghHeaders },
            );
            if (detailRes.ok) {
              const detail = (await detailRes.json()) as {
                stats?: { additions: number; deletions: number };
                files?: Array<{
                  filename: string;
                  status: string;
                  additions: number;
                  deletions: number;
                }>;
              };
              additions = detail.stats?.additions || 0;
              deletions = detail.stats?.deletions || 0;
              files = (detail.files || []).map((f) => ({
                filename: f.filename,
                status: f.status,
                additions: f.additions,
                deletions: f.deletions,
              }));
            }
          } catch {
            // skip details if fetch fails
          }

          allCommits.push({
            sha: commit.sha,
            message: commit.commit.message,
            author: commit.commit.author.name,
            date: commit.commit.author.date,
            url: commit.html_url,
            repo: `${owner}/${repo}`,
            additions,
            deletions,
            files,
          });
        }
      } catch {
        // skip this remote if fetch fails
      }
    }

    allCommits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({ commits: allCommits });
  } catch (err) {
    console.error('GET /api/sessions/:id/commits error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
