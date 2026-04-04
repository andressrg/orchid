import { NextResponse } from 'next/server';
import pool from '@/app/lib/db';

export async function GET() {
  try {
    await pool.query('SELECT 1');
    return NextResponse.json({ status: 'ok' });
  } catch {
    return NextResponse.json({ status: 'ok', db: 'disconnected' });
  }
}
