import { getConfig, getAuthHeaders } from '../config';

interface Session {
  id: string;
  user_name: string;
  branch: string;
  transcript?: string;
  git_remotes: string[];
  status: string;
  started_at: string;
  updated_at: string;
}

interface Turn {
  role: string;
  text: string;
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block: { type?: string; text?: string }) => {
        if (typeof block === 'string') return block;
        if (block && block.type === 'text' && typeof block.text === 'string')
          return block.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function parseTranscript(transcript: string): Turn[] {
  const turns: Turn[] = [];
  const lines = transcript.split('\n').filter((l) => l.trim());

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      let role: string | undefined;
      let text = '';

      if (obj.type === 'human' || obj.role === 'human' || obj.role === 'user') {
        role = 'user';
        text = extractTextContent(
          obj.content || (obj.message && obj.message.content),
        );
      } else if (obj.type === 'assistant' || obj.role === 'assistant') {
        role = 'assistant';
        text = extractTextContent(
          obj.content || (obj.message && obj.message.content),
        );
      }

      if (role && text) turns.push({ role, text });
    } catch {
      // skip
    }
  }
  return turns;
}

function summarizeConversation(turns: Turn[]): string {
  return turns
    .map((t) => {
      const prefix = t.role === 'user' ? 'Developer' : 'AI';
      const text = t.text.length > 300 ? t.text.slice(0, 300) + '...' : t.text;
      return `[${prefix}]: ${text}`;
    })
    .join('\n\n');
}

export async function runReview(args: string[]): Promise<void> {
  const query = args.filter((a) => !a.startsWith('-')).join(' ');
  const useAI = !args.includes('--no-ai');

  if (!query) {
    console.log(`orchid review - conversation-aware code review

Usage:
  orchid review <branch-or-search-term>
  orchid review <branch-or-search-term> --no-ai

Examples:
  orchid review feature/websocket-support
  orchid review "payment bug"

This command finds conversations related to a branch or topic,
then summarizes the key decisions and context for code review.

Environment:
  OPENAI_API_KEY   Required for AI-powered summaries (optional with --no-ai)
`);
    return;
  }

  const { apiUrl, webUrl } = getConfig();

  console.log(`\x1b[35m🌸 Orchid Review\x1b[0m`);
  console.log(
    `\x1b[90mSearching for conversations related to: ${query}\x1b[0m\n`,
  );

  // Search by branch first, then by text
  let sessions: Session[] = [];

  try {
    // Try branch match
    const branchRes = await fetch(
      `${apiUrl.replace(/\/$/, '')}/sessions?q=${encodeURIComponent(query)}`,
      {
        headers: { ...getAuthHeaders() },
      },
    );
    if (branchRes.ok) {
      sessions = (await branchRes.json()) as Session[];
    }
  } catch (err) {
    console.error(`Error searching sessions: ${(err as Error).message}`);
    process.exit(1);
  }

  if (sessions.length === 0) {
    console.log(`\x1b[33mNo conversations found matching "${query}"\x1b[0m`);
    return;
  }

  console.log(
    `\x1b[32mFound ${sessions.length} related conversation${sessions.length > 1 ? 's' : ''}\x1b[0m\n`,
  );

  // Fetch full transcripts for the top sessions (max 3)
  const topSessions = sessions.slice(0, 3);
  const fullSessions: Session[] = [];

  for (const s of topSessions) {
    try {
      const res = await fetch(
        `${apiUrl.replace(/\/$/, '')}/sessions/${encodeURIComponent(s.id)}`,
        {
          headers: { ...getAuthHeaders() },
        },
      );
      if (res.ok) {
        fullSessions.push((await res.json()) as Session);
      }
    } catch {
      // skip
    }
  }

  // Display conversation summaries
  for (const session of fullSessions) {
    const turns = session.transcript ? parseTranscript(session.transcript) : [];
    const userMessages = turns.filter((t) => t.role === 'user').length;
    const aiMessages = turns.filter((t) => t.role === 'assistant').length;

    console.log(`\x1b[1m━━━ Session: ${session.id} ━━━\x1b[0m`);
    console.log(
      `\x1b[90m  By: ${session.user_name} | Branch: ${session.branch} | ${userMessages} user + ${aiMessages} AI messages\x1b[0m`,
    );
    console.log(
      `\x1b[90m  Status: ${session.status} | Started: ${new Date(session.started_at).toLocaleString()}\x1b[0m`,
    );
    console.log(
      `\x1b[34m  Web: ${webUrl}/sessions/${encodeURIComponent(session.id)}\x1b[0m`,
    );
    console.log();

    if (turns.length === 0) {
      console.log(`  \x1b[33m(no parseable messages)\x1b[0m\n`);
      continue;
    }

    // Show key decisions
    console.log(`\x1b[36m  Key points from the conversation:\x1b[0m`);
    for (const turn of turns.slice(0, 6)) {
      const prefix =
        turn.role === 'user'
          ? '\x1b[35m  Developer\x1b[0m'
          : '\x1b[34m  Claude\x1b[0m';
      const text =
        turn.text.length > 200 ? turn.text.slice(0, 200) + '...' : turn.text;
      console.log(`  ${prefix}: ${text.replace(/\n/g, ' ')}`);
      console.log();
    }

    if (turns.length > 6) {
      console.log(
        `  \x1b[90m... and ${turns.length - 6} more messages\x1b[0m\n`,
      );
    }
  }

  // AI summary using OpenAI
  if (useAI) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      console.log(
        `\x1b[33mTip: Set OPENAI_API_KEY for AI-powered review summaries\x1b[0m`,
      );
      return;
    }

    console.log(`\n\x1b[35m🤖 AI Review Summary\x1b[0m`);
    console.log(`\x1b[90mAnalyzing conversations...\x1b[0m\n`);

    const conversationText = fullSessions
      .map((s) => {
        const turns = s.transcript ? parseTranscript(s.transcript) : [];
        return `Session: ${s.id} (by ${s.user_name}, branch: ${s.branch})\n${summarizeConversation(turns)}`;
      })
      .join('\n\n---\n\n');

    try {
      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content:
                  'You are a code review assistant. Given AI coding conversations, summarize: (1) What was built or changed, (2) Key decisions and tradeoffs discussed, (3) Potential concerns or things a reviewer should look at. Be concise and specific.',
              },
              {
                role: 'user',
                content: `Review the following AI coding conversations and provide a summary for a code reviewer:\n\n${conversationText}`,
              },
            ],
            max_tokens: 1000,
            temperature: 0.3,
          }),
        },
      );

      if (!response.ok) {
        const text = await response.text();
        console.error(
          `\x1b[31mOpenAI API error: ${response.status} ${text}\x1b[0m`,
        );
        return;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const summary = data.choices?.[0]?.message?.content;
      if (summary) {
        console.log(summary);
      }
    } catch (err) {
      console.error(
        `\x1b[31mOpenAI API error: ${(err as Error).message}\x1b[0m`,
      );
    }
  }

  console.log(`\n\x1b[90m━━━ End of Orchid Review ━━━\x1b[0m`);
}
