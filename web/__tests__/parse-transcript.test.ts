import { describe, it, expect } from 'vitest';
import { parseTranscript } from '@/app/lib/api';

const jsonl = (...entries: object[]): string => entries.map((e) => JSON.stringify(e)).join('\n');

describe('parseTranscript', () => {
  // Regression: the Claude CLI writes top-level `type:'user'` with the body
  // under `message.content`. These must parse as user turns, not 'Claude'.
  it('treats top-level type:"user" (Claude CLI shape) as a user turn', () => {
    const transcript = jsonl(
      { type: 'user', message: { role: 'user', content: 'fix the bug' } },
      { type: 'assistant', message: { role: 'assistant', content: 'on it' } },
    );
    expect(parseTranscript(transcript)).toEqual([
      { role: 'user', text: 'fix the bug' },
      { role: 'assistant', text: 'on it' },
    ]);
  });

  it('reads content from message.content when present, else top-level content', () => {
    const transcript = jsonl(
      { type: 'user', content: 'top-level body' },
      { type: 'user', message: { role: 'user', content: 'nested body' } },
    );
    expect(parseTranscript(transcript)).toEqual([
      { role: 'user', text: 'top-level body' },
      { role: 'user', text: 'nested body' },
    ]);
  });

  it('still handles the legacy human/assistant shapes', () => {
    const transcript = jsonl(
      { type: 'human', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: 'thanks' },
    );
    expect(parseTranscript(transcript)).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'hi there' },
      { role: 'user', text: 'thanks' },
    ]);
  });

  it('extracts text from array content blocks', () => {
    const transcript = jsonl({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'block one' }, { type: 'tool_use' }],
      },
    });
    expect(parseTranscript(transcript)).toEqual([{ role: 'user', text: 'block one' }]);
  });

  it('skips non-JSON lines and empty-content turns', () => {
    const transcript = ['not json', '', JSON.stringify({ type: 'user', content: '' })].join('\n');
    expect(parseTranscript(transcript)).toEqual([]);
  });
});
