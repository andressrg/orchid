import { NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { requireApiKey } from '@/app/lib/auth';

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');

    let result;
    if (q) {
      result = await pool.query(
        `SELECT id, user_name, user_email, working_dir, git_remotes, branch, tool, started_at, updated_at, status, message_count
         FROM sessions
         WHERE transcript ILIKE $1
         ORDER BY started_at DESC`,
        [`%${q}%`],
      );
    } else {
      result = await pool.query(
        `SELECT id, user_name, user_email, working_dir, git_remotes, branch, tool, started_at, updated_at, status, message_count
         FROM sessions
         ORDER BY started_at DESC`,
      );
    }
    return NextResponse.json(result.rows);
  } catch (err) {
    console.error('GET /api/sessions error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
