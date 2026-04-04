import { NextResponse } from 'next/server';

const API_KEY = process.env.API_KEY;

export function requireApiKey(request: Request): NextResponse | null {
  const key = request.headers.get('x-api-key');
  if (!API_KEY || key !== API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
