import { describe, expect, it } from 'vitest';
import {
  countMeaningfulTranscriptTurns,
  parseTranscriptTurns,
  summarizeTranscriptMetadata,
} from '@/app/lib/transcript';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
type JsonRecord = { readonly [key: string]: JsonValue };

const jsonl = (...entries: readonly JsonRecord[]): string =>
  entries.map((entry) => JSON.stringify(entry)).join('\n');

describe('parseTranscriptTurns', () => {
  it('parses Claude user and assistant messages', () => {
    const transcript = jsonl(
      { type: 'human', message: { role: 'user', content: 'Fix tests' } },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'I will inspect them.' }] },
      },
    );

    const turns = parseTranscriptTurns({ transcript });

    expect(
      turns.map((turn) => ({ role: turn.role, text: turn.text, sourceTool: turn.sourceTool })),
    ).toEqual([
      { role: 'user', text: 'Fix tests', sourceTool: 'claude-code' },
      { role: 'assistant', text: 'I will inspect them.', sourceTool: 'claude-code' },
    ]);
  });

  it('parses Codex canonical user and assistant events without duplicates', () => {
    const transcript = jsonl(
      {
        type: 'session_meta',
        timestamp: '2026-05-01T00:00:00.000Z',
        payload: {
          id: 'codex-session',
          cwd: '/repo',
          timestamp: '2026-05-01T00:00:00.000Z',
          git: { branch: 'main' },
          base_instructions: 'do not show this',
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-05-01T00:00:01.000Z',
        payload: {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: 'hidden instructions' }],
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-05-01T00:00:02.000Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Fix tests' }],
        },
      },
      {
        type: 'event_msg',
        timestamp: '2026-05-01T00:00:02.000Z',
        payload: {
          type: 'user_message',
          message: 'Fix tests',
          text_elements: ['Fix tests'],
          images: [],
          local_images: [],
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-05-01T00:00:03.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'I will inspect them.' }],
        },
      },
      {
        type: 'event_msg',
        timestamp: '2026-05-01T00:00:03.000Z',
        payload: { type: 'agent_message', message: 'I will inspect them.', phase: 'final' },
      },
    );

    const turns = parseTranscriptTurns({ transcript });

    expect(
      turns.map((turn) => ({ role: turn.role, text: turn.text, rawType: turn.rawType })),
    ).toEqual([
      { role: 'user', text: 'Fix tests', rawType: 'event_msg.user_message' },
      { role: 'assistant', text: 'I will inspect them.', rawType: 'event_msg.agent_message' },
    ]);
    expect(countMeaningfulTranscriptTurns(transcript)).toBe(2);
  });

  it('parses Codex tool calls and outputs', () => {
    const transcript = jsonl(
      {
        type: 'response_item',
        timestamp: '2026-05-01T00:00:04.000Z',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          call_id: 'call_1',
          arguments: JSON.stringify({ cmd: 'git status --short', workdir: '/repo' }),
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-05-01T00:00:05.000Z',
        payload: { type: 'function_call_output', call_id: 'call_1', output: ' M file.ts' },
      },
    );

    const turns = parseTranscriptTurns({ transcript });

    expect(
      turns.map((turn) => ({ role: turn.role, text: turn.text, callId: turn.callId })),
    ).toEqual([
      { role: 'tool', text: '$ git status --short', callId: 'call_1' },
      { role: 'tool', text: ' M file.ts', callId: 'call_1' },
    ]);
  });
});

describe('summarizeTranscriptMetadata', () => {
  it('extracts Codex metadata', () => {
    const transcript = jsonl({
      type: 'session_meta',
      timestamp: '2026-05-01T00:00:00.000Z',
      payload: {
        id: 'codex-session',
        cwd: '/repo',
        timestamp: '2026-05-01T00:00:00.000Z',
        git: { branch: 'main' },
      },
    });

    expect(summarizeTranscriptMetadata({ transcript })).toEqual({
      id: 'codex-session',
      cwd: '/repo',
      branch: 'main',
      timestamp: '2026-05-01T00:00:00.000Z',
      model: null,
    });
  });
});
