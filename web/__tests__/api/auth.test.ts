import { describe, it, expect } from 'vitest';
import { requireApiKey } from '@/app/lib/auth';

describe('requireApiKey', () => {
  it('returns 401 when no api key provided', () => {
    const result = requireApiKey(new Request('http://localhost'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it('returns 401 when wrong api key provided', () => {
    const result = requireApiKey(
      new Request('http://localhost', {
        headers: { 'x-api-key': 'wrong-key' },
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it('returns null when correct api key provided', () => {
    const result = requireApiKey(
      new Request('http://localhost', {
        headers: { 'x-api-key': 'test-api-key' },
      }),
    );
    expect(result).toBeNull();
  });
});
