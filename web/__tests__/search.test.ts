import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { testDb, getTestAuth, cleanTestDb } from './setup';
import { orchidSession, organization, user } from '@/app/lib/schema';
import { searchSessions } from '@/app/lib/queries';

// P0-4: `searchSessions` runs Postgres full-text search over the transcript
// (GIN-indexed `transcript_search` tsvector) — `websearch_to_tsquery` match +
// `ts_rank` ordering — instead of the old `ilike` full scan. These tests assert
// the search semantics survive: relevance ranking, multi-word queries, team
// scoping, and graceful handling of malformed input (no throw / no 500).
//
// P1-2: `searchSessions` now takes object params and enforces the visible-session
// read-scope. To exercise FTS over the SHARED test user's sessions, every seeded
// session here is team-visible (`visibility: 'team'`) and owned by that user.
const TEAM = 'team-p04';
const OTHER_TEAM = 'team-p04-other';

const seedSession = async (
  id: string,
  transcript: string,
  startedAt: Date,
  teamId = TEAM,
  ownerId?: string,
) => {
  const { userId } = await getTestAuth();
  await testDb.insert(orchidSession).values({
    id,
    userName: 'tester',
    userEmail: 'tester@example.com',
    workingDir: '/home/test/project',
    branch: 'main',
    tool: 'claude',
    transcript,
    status: 'done',
    messageCount: 2,
    startedAt,
    updatedAt: startedAt,
    userId: ownerId ?? userId,
    teamId,
    visibility: 'team',
  });
};

describe('searchSessions (Postgres FTS)', () => {
  let userId: string;

  beforeAll(async () => {
    userId = (await getTestAuth()).userId;
    // A second user that owns the cross-team session in the scoping test (FK).
    await testDb
      .insert(user)
      .values({
        id: 'other-owner-p04',
        name: 'Other Owner',
        email: 'other-owner-p04@example.com',
        emailVerified: true,
      })
      .onConflictDoNothing();
    await testDb
      .insert(organization)
      .values([
        { id: TEAM, name: 'P0-4 Team', slug: TEAM, createdAt: new Date() },
        { id: OTHER_TEAM, name: 'P0-4 Other', slug: OTHER_TEAM, createdAt: new Date() },
      ])
      .onConflictDoNothing();
  });

  beforeEach(async () => {
    await cleanTestDb();
  });

  it('returns only sessions whose transcript matches the query', async () => {
    await seedSession('fts-ws', 'we are debugging a websocket reconnection bug', new Date());
    await seedSession('fts-db', 'discussing the postgres database schema', new Date());

    const results = await searchSessions({ teamId: TEAM, userId, query: 'websocket' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('fts-ws');
  });

  it('ranks the more relevant transcript first (ts_rank)', async () => {
    // Same matching term, different density → the term-dense transcript ranks higher,
    // even though it is the OLDER session (so recency alone would not pick it).
    await seedSession(
      'fts-dense',
      'database database database migration database tuning database',
      new Date('2020-01-01T00:00:00Z'),
    );
    await seedSession(
      'fts-sparse',
      'a short note that mentions database once',
      new Date('2025-01-01T00:00:00Z'),
    );

    const results = await searchSessions({ teamId: TEAM, userId, query: 'database' });
    expect(results.map((r) => r.id)).toEqual(['fts-dense', 'fts-sparse']);
  });

  it('handles a multi-word query (all terms must be present)', async () => {
    await seedSession('fts-both', 'the database migration index was rebuilt', new Date());
    await seedSession('fts-one', 'the database connection pool was resized', new Date());

    const results = await searchSessions({ teamId: TEAM, userId, query: 'database migration' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('fts-both');
  });

  it('is scoped to the team (a different owner in another team is excluded)', async () => {
    await seedSession('fts-mine', 'unique websocket discussion', new Date(), TEAM);
    // Owned by SOMEONE ELSE in another team → not visible to `userId`, even
    // though the transcript matches. (Same-owner cross-team is covered by the
    // ownership rule and intentionally not asserted here.)
    await seedSession(
      'fts-theirs',
      'unique websocket discussion',
      new Date(),
      OTHER_TEAM,
      'other-owner-p04',
    );

    const results = await searchSessions({ teamId: TEAM, userId, query: 'websocket' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('fts-mine');
  });

  it('does not throw on malformed input — returns empty instead of 500', async () => {
    await seedSession('fts-x', 'some ordinary transcript content', new Date());

    // Stray operators, unterminated quotes, and pure punctuation are all tolerated
    // by `websearch_to_tsquery`; each resolves to zero matches rather than an error.
    const malformed = ['!@#$%^&*()', '"unterminated', 'a <-> & | b', '   ', ''];
    const counts = await Promise.all(
      malformed.map(async (q) => (await searchSessions({ teamId: TEAM, userId, query: q })).length),
    );
    expect(counts).toEqual([0, 0, 0, 0, 0]);
  });
});
