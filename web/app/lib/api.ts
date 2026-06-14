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
  role: 'user' | 'assistant' | 'unknown';
  text: string;
}

type ContentBlock = string | { type?: string; text?: string };
type TranscriptContent = string | ContentBlock[] | null | undefined;

interface TranscriptLine {
  type?: string;
  role?: string;
  content?: TranscriptContent;
  message?: { role?: string; content?: TranscriptContent };
}

function extractTextContent(content: TranscriptContent): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && block.type === 'text' && typeof block.text === 'string') return block.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

// Resolve a single transcript line into a {role, text} turn, or null when it
// isn't a renderable message. Handles both the legacy top-level
// `{type:'human'|'assistant', content}` shape and the Claude CLI shape, which
// writes `{type:'user'|'assistant'}` with the body under `message.content` — the
// `type === 'user'` case is why user turns previously fell through and rendered
// as 'Claude'.
function parseTranscriptLine(line: string): Turn | null {
  try {
    const obj = JSON.parse(line) as TranscriptLine;
    const content = obj.message?.content ?? obj.content;

    const isUser =
      obj.type === 'human' ||
      obj.type === 'user' ||
      obj.role === 'human' ||
      obj.role === 'user' ||
      obj.message?.role === 'user' ||
      obj.message?.role === 'human';
    const isAssistant =
      obj.type === 'assistant' || obj.role === 'assistant' || obj.message?.role === 'assistant';

    const role: Turn['role'] = isUser
      ? 'user'
      : isAssistant
        ? 'assistant'
        : obj.message
          ? 'unknown'
          : 'unknown';

    if (!isUser && !isAssistant && !obj.message) return null;

    const text = extractTextContent(content);
    return text ? { role, text } : null;
  } catch {
    return null; // skip non-JSON lines
  }
}

export function parseTranscript(transcript: string): Turn[] {
  return transcript
    .split('\n')
    .filter((l) => l.trim())
    .map(parseTranscriptLine)
    .filter((turn): turn is Turn => turn !== null);
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
  return transcript.split('\n').filter((l) => l.trim()).length;
}
