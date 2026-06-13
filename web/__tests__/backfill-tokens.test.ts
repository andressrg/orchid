import { describe, it, expect, beforeEach } from 'vitest';
import { cleanTestDb, getTestAuth, insertTestSession, testDb } from './setup';
import { backfillTokens } from '@/app/lib/backfill-tokens';
import { orchidSession } from '@/app/lib/schema';
import { eq } from 'drizzle-orm';

describe('backfillTokens', () => {
  beforeEach(async () => {
    await getTestAuth();
    await cleanTestDb();
  });

  it('fills token totals for zero-token rows from their transcripts', async () => {
    const transcript = [
      '{"type":"user","content":"hi"}',
      '{"type":"assistant","usage":{"input_tokens":200,"output_tokens":80,"cache_read_input_tokens":20}}',
    ].join('\n');
    await insertTestSession({ id: 'needs-backfill', transcript });

    const result = await backfillTokens();
    expect(result.updated).toBe(1);

    const [row] = await testDb
      .select({
        inputTokens: orchidSession.inputTokens,
        outputTokens: orchidSession.outputTokens,
      })
      .from(orchidSession)
      .where(eq(orchidSession.id, 'needs-backfill'));
    expect(row.inputTokens).toBe(220);
    expect(row.outputTokens).toBe(80);
  });

  it('leaves rows without usage untouched', async () => {
    await insertTestSession({
      id: 'no-usage',
      transcript: '{"type":"user","content":"hello"}',
    });
    const result = await backfillTokens();
    expect(result.updated).toBe(0);
  });
});
