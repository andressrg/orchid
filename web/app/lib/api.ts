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

export interface Turn {
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
}

export function parseTranscript(transcript: string): Turn[] {
  return parseTranscriptTurns({ transcript }).map((turn) => ({ role: turn.role, text: turn.text }));
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

export function countMessages(transcript?: string): number {
  if (!transcript) return 0;
  return countMeaningfulTranscriptTurns(transcript);
}
import { countMeaningfulTranscriptTurns, parseTranscriptTurns } from './transcript';
