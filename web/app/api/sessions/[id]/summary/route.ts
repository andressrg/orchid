import { NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { requireApiKey } from '@/app/lib/auth';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'AI summaries not available (OPENAI_API_KEY not configured)' },
      { status: 503 },
    );
  }

  const { id } = await params;

  try {
    const result = await pool.query('SELECT * FROM sessions WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const session = result.rows[0];
    if (!session.transcript) {
      return NextResponse.json({ summary: 'No conversation content available.' });
    }

    const lines = session.transcript.split('\n').filter((l: string) => l.trim());
    const turns: Array<{ role: string; text: string }> = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        let role = '';
        let text = '';
        if (obj.type === 'human' || obj.role === 'user') {
          role = 'Developer';
          text = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
        } else if (obj.type === 'assistant' || obj.role === 'assistant') {
          role = 'AI';
          text = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
        }
        if (role && text) {
          turns.push({ role, text: text.slice(0, 500) });
        }
      } catch {
        // skip
      }
    }

    const conversationText = turns.map((t) => `[${t.role}]: ${t.text}`).join('\n\n');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'Summarize this AI coding conversation in 2-3 sentences. Focus on: what was built/changed, key decisions made, and the outcome. Be specific and concise.',
          },
          { role: 'user', content: conversationText },
        ],
        max_tokens: 200,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'AI service error' }, { status: 502 });
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const summary = data.choices?.[0]?.message?.content || 'Unable to generate summary.';

    return NextResponse.json({ summary });
  } catch (err) {
    console.error('GET /api/sessions/:id/summary error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
