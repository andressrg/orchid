const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export interface Session {
  id: string;
  user_name: string;
  user_email: string;
  working_dir: string;
  git_remotes: string[];
  branch: string;
  tool: string;
  started_at: string;
  updated_at: string;
  status: string;
  transcript?: string;
  message_count?: number;
}

export interface Stats {
  total_sessions: string;
  active_sessions: string;
  unique_users: string;
  first_session: string;
  last_activity: string;
}

async function apiFetch<T>(path: string, query?: string): Promise<T> {
  let url = `${API_URL}/api${path}`;
  if (query) url += `?q=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  return res.json();
}

export async function getSessions(query?: string): Promise<Session[]> {
  return apiFetch<Session[]>('/sessions', query);
}

export async function getSession(id: string): Promise<Session> {
  return apiFetch<Session>(`/sessions/${encodeURIComponent(id)}`);
}

export async function getStats(): Promise<Stats> {
  return apiFetch<Stats>('/stats');
}

export interface Turn {
  role: 'user' | 'assistant' | 'unknown';
  text: string;
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block: { type?: string; text?: string }) => {
        if (typeof block === 'string') return block;
        if (block && block.type === 'text' && typeof block.text === 'string') return block.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function parseTranscript(transcript: string): Turn[] {
  const turns: Turn[] = [];
  const lines = transcript.split('\n').filter((l) => l.trim());

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      let role: 'user' | 'assistant' | 'unknown' | undefined;
      let text = '';

      if (obj.type === 'human' || obj.role === 'human' || obj.role === 'user') {
        role = 'user';
        text = extractTextContent(obj.content || (obj.message && obj.message.content));
      } else if (obj.type === 'assistant' || obj.role === 'assistant') {
        role = 'assistant';
        text = extractTextContent(obj.content || (obj.message && obj.message.content));
      } else if (obj.message) {
        role =
          obj.message.role === 'user' || obj.message.role === 'human'
            ? 'user'
            : obj.message.role === 'assistant'
              ? 'assistant'
              : 'unknown';
        text = extractTextContent(obj.message.content);
      }

      if (role && text) {
        turns.push({ role, text });
      }
    } catch {
      // skip non-JSON lines
    }
  }

  return turns;
}

export function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}

export interface Decision {
  title: string;
  decision: string;
  alternatives: string[];
  reason: string;
  session_id: string;
  turn_index: number;
}

export interface DecisionsResult {
  decisions: Decision[];
  sessions_analyzed: number;
}

export async function getDecisions(repo?: string): Promise<DecisionsResult> {
  const path = repo ? `/decisions?repo=${encodeURIComponent(repo)}` : '/decisions';
  return apiFetch<DecisionsResult>(path);
}

export function countMessages(transcript?: string): number {
  if (!transcript) return 0;
  return transcript.split('\n').filter((l) => l.trim()).length;
}
