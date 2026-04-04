import { NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { requireApiKey } from '@/app/lib/auth';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { id } = await params;

  try {
    const result = await pool.query('SELECT * FROM sessions WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/sessions/:id error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { id } = await params;
  const { user_name, user_email, working_dir, git_remotes, branch, tool, transcript, status } =
    await request.json();

  let messageCount = 0;
  if (transcript) {
    const lines = (transcript as string).split('\n').filter((l: string) => l.trim());
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
      [
        id,
        user_name,
        user_email,
        working_dir,
        JSON.stringify(git_remotes),
        branch,
        tool,
        transcript,
        status || 'active',
        messageCount,
      ],
    );
    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /api/sessions/:id error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { id } = await params;

  try {
    const result = await pool.query('DELETE FROM sessions WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    return NextResponse.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error('DELETE /api/sessions/:id error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
