import { headers as getHeaders } from 'next/headers';
import type { DecisionsResult } from './api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

async function apiFetch<T>(path: string, opts: { query?: string; team?: string } = {}): Promise<T> {
  const params = new URLSearchParams();
  if (opts.query) params.set('q', opts.query);
  if (opts.team) params.set('team', opts.team);
  const qs = params.toString();
  const url = `${API_URL}/api${path}${qs ? `?${qs}` : ''}`;

  const incomingHeaders = await getHeaders();
  const cookie = incomingHeaders.get('cookie') || '';

  const res = await fetch(url, {
    headers: cookie ? { Cookie: cookie } : {},
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  return res.json();
}

export async function getDecisions(team?: string, repo?: string): Promise<DecisionsResult> {
  const params = new URLSearchParams();
  if (team) params.set('team', team);
  if (repo) params.set('repo', repo);
  const qs = params.toString();
  return apiFetch<DecisionsResult>(`/decisions${qs ? `?${qs}` : ''}`);
}
