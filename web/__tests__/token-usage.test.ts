import { describe, it, expect } from 'vitest';
import { tokenUsageFromTranscript } from '@/app/lib/token-usage';

describe('tokenUsageFromTranscript', () => {
  it('returns zero usage for an empty transcript', () => {
    expect(tokenUsageFromTranscript('')).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('sums input/output across JSONL lines, folding cache into input', () => {
    const transcript = [
      '{"type":"user","content":"Hello"}',
      '{"type":"assistant","usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":5}}',
      '{"type":"assistant","message":{"usage":{"input_tokens":4,"output_tokens":6,"cache_creation_input_tokens":2}}}',
    ].join('\n');
    expect(tokenUsageFromTranscript(transcript)).toEqual({ inputTokens: 21, outputTokens: 26 });
  });

  it('skips malformed lines', () => {
    const transcript = [
      'not valid json',
      '{"usage":{"input_tokens":3,"output_tokens":7}}',
      '',
    ].join('\n');
    expect(tokenUsageFromTranscript(transcript)).toEqual({ inputTokens: 3, outputTokens: 7 });
  });
});
