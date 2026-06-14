import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { cleanTestDb, getTestAuth, insertTestSession, testDb } from '../setup';
import * as schema from '@/app/lib/schema';
import app from '@/app/lib/api-app';

// POST /api/sessions/:id/commits — the deterministic commit↔session ingest the
// CLI backfill (`orchid sync --discover`) calls. Asserts: auth required, scoped
// (a caller can't write commits to another user's session — 404), the idempotent
// batch upsert (a re-post links 0), and basic input validation.

const FULL_SHA_A = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const FULL_SHA_B = 'b2c3d4e5f6a7b2c3d4e5f6a7b2c3d4e5f6a7b2c3';

// Read back the linked commit SHAs for a session straight from the DB (bypasses
// any scope) so we can assert what actually landed.
const commitShasFor = async (sessionId: string): Promise<readonly string[]> => {
  const rows = await testDb
    .select({ sha: schema.sessionCommit.commitSha })
    .from(schema.sessionCommit)
    .where(eq(schema.sessionCommit.sessionId, sessionId));
  return rows.map((row) => row.sha);
};

describe('POST /api/sessions/:id/commits', () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    headers = (await getTestAuth()).headers;
  });

  beforeEach(async () => {
    await cleanTestDb();
  });

  it('401s without auth', async () => {
    await insertTestSession({ id: 's-1' });
    const res = await app.request('/api/sessions/s-1/commits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commits: [{ sha: FULL_SHA_A }] }),
    });
    expect(res.status).toBe(401);
  });

  it('links commits to a session the caller owns and returns the count', async () => {
    await insertTestSession({ id: 's-own' });

    const res = await app.request('/api/sessions/s-own/commits', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        commits: [
          {
            sha: FULL_SHA_A,
            branch: 'main',
            message: 'feat: add ingest',
            committed_at: '2026-06-13T10:00:00Z',
          },
          { sha: FULL_SHA_B, branch: 'main', message: 'fix: edge case' },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).linked).toBe(2);

    const shas = await commitShasFor('s-own');
    expect(shas).toContain(FULL_SHA_A);
    expect(shas).toContain(FULL_SHA_B);
  });

  it('is idempotent — a re-post of the same commits links 0 the second time', async () => {
    await insertTestSession({ id: 's-idem' });
    const body = JSON.stringify({
      commits: [{ sha: FULL_SHA_A }, { sha: FULL_SHA_B }],
    });

    const first = await app.request('/api/sessions/s-idem/commits', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body,
    });
    expect((await first.json()).linked).toBe(2);

    const second = await app.request('/api/sessions/s-idem/commits', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body,
    });
    expect(second.status).toBe(200);
    expect((await second.json()).linked).toBe(0);

    // Still exactly 2 rows — no duplicates.
    const shas = await commitShasFor('s-idem');
    expect(shas.length).toBe(2);
  });

  it('404s when writing to a session owned by another user (scoped)', async () => {
    // A second user owns the session; the default PAT (a different user, no team)
    // must not be able to write to it — and gets a 404, not a 403, so it never
    // learns the session exists.
    const otherUserId = `other-user-${Date.now()}`;
    await testDb
      .insert(schema.user)
      .values({
        id: otherUserId,
        name: 'Other User',
        email: `other-${Date.now()}@example.com`,
        emailVerified: true,
      })
      .onConflictDoNothing();
    await insertTestSession({ id: 's-other', user_id: otherUserId });

    const res = await app.request('/api/sessions/s-other/commits', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ commits: [{ sha: FULL_SHA_A }] }),
    });

    expect(res.status).toBe(404);
    // Nothing was written.
    const shas = await commitShasFor('s-other');
    expect(shas.length).toBe(0);
  });

  it('404s for a session that does not exist', async () => {
    const res = await app.request('/api/sessions/ghost/commits', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ commits: [{ sha: FULL_SHA_A }] }),
    });
    expect(res.status).toBe(404);
  });

  it('400s when commits is missing / not an array', async () => {
    await insertTestSession({ id: 's-bad' });
    const res = await app.request('/api/sessions/s-bad/commits', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ notCommits: true }),
    });
    expect(res.status).toBe(400);
  });

  it('400s when the batch is oversized', async () => {
    await insertTestSession({ id: 's-big' });
    const tooMany = Array.from({ length: 1001 }, (_, i) => ({
      sha: i.toString(16).padStart(40, '0'),
    }));
    const res = await app.request('/api/sessions/s-big/commits', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ commits: tooMany }),
    });
    expect(res.status).toBe(400);
  });

  it('drops malformed shas and dedups within a request', async () => {
    await insertTestSession({ id: 's-clean' });
    const res = await app.request('/api/sessions/s-clean/commits', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        commits: [
          { sha: FULL_SHA_A },
          { sha: FULL_SHA_A.toUpperCase() }, // same sha, different case → dedup
          { sha: 'not-a-sha' }, // dropped
          { sha: 'zz' }, // too short / non-hex → dropped
          { sha: '' }, // dropped
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).linked).toBe(1);
    const shas = await commitShasFor('s-clean');
    expect(shas).toEqual([FULL_SHA_A]);
  });
});
