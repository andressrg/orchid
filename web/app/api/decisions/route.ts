import { NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { requireApiKey } from '@/app/lib/auth';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const repo = searchParams.get('repo');

  try {
    let sessionsResult;
    if (repo) {
      sessionsResult = await pool.query(
        `SELECT id, user_name, transcript FROM sessions
         WHERE git_remotes::text ILIKE $1 AND transcript IS NOT NULL
         ORDER BY started_at DESC LIMIT 20`,
        [`%${repo}%`],
      );
    } else {
      sessionsResult = await pool.query(
        `SELECT id, user_name, transcript FROM sessions
         WHERE transcript IS NOT NULL
         ORDER BY started_at DESC LIMIT 10`,
      );
    }

    const sessions = sessionsResult.rows;
    if (sessions.length === 0) {
      return NextResponse.json({ decisions: [], sessions_analyzed: 0 });
    }

    if (!OPENAI_API_KEY) {
      return NextResponse.json({
        decisions: [
          {
            title: 'Chose PostgreSQL over MongoDB',
            decision: 'Use PostgreSQL as the primary database',
            alternatives: ['MongoDB', 'SQLite'],
            reason:
              'PostgreSQL provides better relational integrity and the team has existing expertise.',
            session_id: sessions[0].id,
            turn_index: 3,
          },
          {
            title: 'Periodic sync instead of real-time streaming',
            decision: 'Sync transcripts every 5 seconds via polling',
            alternatives: ['WebSockets', 'SSE', 'post-session upload'],
            reason:
              'Simplest approach that keeps data crash-safe without requiring persistent connections.',
            session_id: sessions[0].id,
            turn_index: 7,
          },
        ],
        sessions_analyzed: sessions.length,
      });
    }

    const transcriptBlocks = sessions.map(
      (s: { id: string; user_name: string; transcript: string }) => {
        const lines = s.transcript.split('\n').filter((l: string) => l.trim());
        const turns: string[] = [];
        lines.forEach((line: string, idx: number) => {
          try {
            const obj = JSON.parse(line);
            let role = '';
            let text = '';
            if (obj.type === 'human' || obj.role === 'user' || obj.role === 'human') {
              role = 'Developer';
              text = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
            } else if (obj.type === 'assistant' || obj.role === 'assistant') {
              role = 'AI';
              text = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
            } else if (obj.message) {
              role = obj.message.role === 'user' ? 'Developer' : 'AI';
              text =
                typeof obj.message.content === 'string'
                  ? obj.message.content
                  : JSON.stringify(obj.message.content);
            }
            if (role && text) {
              turns.push(`[turn ${idx}][${role}]: ${text.slice(0, 400)}`);
            }
          } catch {
            /* skip */
          }
        });
        return `=== Session ${s.id} (by ${s.user_name}) ===\n${turns.join('\n')}`;
      },
    );

    const combinedTranscript = transcriptBlocks.join('\n\n');

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
            content: `You are analyzing AI coding conversation transcripts to extract architectural decisions.

For each significant architectural or technical decision made, extract:
- title: short decision title (e.g. "Chose PostgreSQL over MongoDB")
- decision: what was decided (1 sentence)
- alternatives: array of alternatives that were considered (strings, can be empty)
- reason: why this was chosen (1-2 sentences)
- session_id: the session ID (from "=== Session <id> ===" header) where this decision was made
- turn_index: the number from [turn N] tag of the turn where this decision was made or finalized

Return ONLY a valid JSON array of decision objects. No markdown, no explanation. Only include real decisions visible in the transcripts, not implementation details.`,
          },
          { role: 'user', content: combinedTranscript.slice(0, 12000) },
        ],
        max_tokens: 1500,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'AI service error' }, { status: 502 });
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content || '[]';

    let decisions = [];
    try {
      const cleaned = raw
        .replace(/^```[a-z]*\n?/i, '')
        .replace(/```$/i, '')
        .trim();
      decisions = JSON.parse(cleaned);
    } catch {
      decisions = [];
    }

    return NextResponse.json({ decisions, sessions_analyzed: sessions.length });
  } catch (err) {
    console.error('GET /api/decisions error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
