import { NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { requireApiKey } from '@/app/lib/auth';

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

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
    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/stats error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
