import { NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { requireApiKey } from '@/app/lib/auth';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function extractText(content: unknown): string {
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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'Chat not available (OPENAI_API_KEY not configured)' },
      { status: 503 },
    );
  }

  const { id } = await params;
  const { question, history } = await request.json();

  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }

  try {
    const result = await pool.query('SELECT * FROM sessions WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const session = result.rows[0];
    if (!session.transcript) {
      return NextResponse.json({ answer: 'No conversation content available to reason about.' });
    }

    const lines = session.transcript.split('\n').filter((l: string) => l.trim());
    const turns: Array<{ role: string; text: string }> = [];

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const msg = obj.message || obj;
        const msgRole = msg.role || obj.type;
        let role = '';
        let text = '';

        if (msgRole === 'user' || msgRole === 'human') {
          role = 'Developer';
          text = extractText(msg.content || obj.content);
        } else if (msgRole === 'assistant') {
          role = 'AI';
          text = extractText(msg.content || obj.content);
        }

        if (role && text) {
          turns.push({ role, text });
        }
      } catch {
        // skip
      }
    }

    const conversationText = turns
      .map((t, i) => `[Turn ${i + 1}][${t.role}]: ${t.text}`)
      .join('\n\n');

    const messages: Array<{ role: string; content: string }> = [
      {
        role: 'system',
        content: `You are Orchid, an assistant that answers questions about AI coding sessions. You have access to the full conversation between a developer and an AI coding assistant.

Session info:
- User: ${session.user_name} <${session.user_email}>
- Branch: ${session.branch || 'unknown'}
- Directory: ${session.working_dir || 'unknown'}
- Tool: ${session.tool || 'unknown'}
- Started: ${session.started_at}
- Status: ${session.status}
- Total turns: ${turns.length}

Here is the full conversation transcript:

${conversationText}

Answer the user's question based on this conversation. Be specific and cite relevant parts (by turn number) when possible. If the answer isn't in the conversation, say so. Be concise but thorough.`,
      },
    ];

    if (Array.isArray(history)) {
      for (const msg of history) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }

    messages.push({ role: 'user', content: question });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 2000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('OpenAI API error:', response.status, errBody);
      return NextResponse.json({ error: 'AI service error' }, { status: 502 });
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const answer = data.choices?.[0]?.message?.content || 'Unable to generate an answer.';

    return NextResponse.json({ answer });
  } catch (err) {
    console.error('POST /api/sessions/:id/chat error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
