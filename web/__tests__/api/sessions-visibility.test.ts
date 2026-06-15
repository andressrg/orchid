import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb, cleanTestDb } from '../setup';
import { generateToken } from '@/app/lib/crypto';
import { user, organization, apiKey, orchidSession } from '@/app/lib/schema';
import { getSessionById, listSessions, getSessionTranscriptById } from '@/app/lib/queries';
import app from '@/app/lib/api-app';

// P1-2 — private-by-default sessions with ENFORCED read scoping.
//
// The visibility rule (one source of truth): a user sees a session IFF
//   orchid_session.user_id = <me>
//   OR (orchid_session.team_id = <myTeam> AND orchid_session.visibility = 'team').
//
// Cross-user scoping cannot be browser-tested with a single account, so this is
// the authoritative verification. Two users (A, B) share ONE team. We seed:
//   - A-private:      owned by A, visibility 'private'
//   - A-team-visible: owned by A, visibility 'team'
//   - B-private:      owned by B, visibility 'private'
// and assert both the API (real Hono requests) and the SSR queries layer.

const TEAM = 'team-vis';
const USER_A = 'user-a-vis';
const USER_B = 'user-b-vis';

// A PAT carrying BOTH user_id and team_id (the web-session/PAT auth shape that
// hits the `userId && teamId` branch of scopeConditions). Returns the bearer
// header the Hono app authenticates with.
const createScopedPat = async ({
  userId,
  teamId,
}: {
  readonly userId: string;
  readonly teamId: string;
}): Promise<Record<string, string>> => {
  const { token, hash, prefix } = generateToken();
  await testDb.insert(apiKey).values({
    userId,
    teamId,
    name: `pat-${userId}`,
    keyHash: hash,
    keyPrefix: prefix,
  });
  return { authorization: `Bearer ${token}` };
};

const seedSession = async ({
  id,
  ownerId,
  visibility,
}: {
  readonly id: string;
  readonly ownerId: string;
  readonly visibility: 'private' | 'team';
}): Promise<void> => {
  await testDb.insert(orchidSession).values({
    id,
    userName: ownerId,
    userEmail: `${ownerId}@example.com`,
    workingDir: '/home/test/project',
    gitRemotes: ['https://github.com/test/repo.git'],
    branch: 'main',
    tool: 'claude',
    transcript: `{"role":"user","content":"${id}"}`,
    status: 'done',
    messageCount: 1,
    userId: ownerId,
    teamId: TEAM,
    visibility,
  });
};

describe('P1-2 private-by-default read scoping', () => {
  let headersB: Record<string, string>;
  let headersA: Record<string, string>;

  beforeAll(async () => {
    await testDb
      .insert(user)
      .values([
        { id: USER_A, name: 'User A', email: `${USER_A}@example.com`, emailVerified: true },
        { id: USER_B, name: 'User B', email: `${USER_B}@example.com`, emailVerified: true },
      ])
      .onConflictDoNothing();
    await testDb
      .insert(organization)
      .values({ id: TEAM, name: 'Vis Team', slug: TEAM, createdAt: new Date() })
      .onConflictDoNothing();
    headersA = await createScopedPat({ userId: USER_A, teamId: TEAM });
    headersB = await createScopedPat({ userId: USER_B, teamId: TEAM });
  });

  beforeEach(async () => {
    await cleanTestDb();
    await seedSession({ id: 'a-private', ownerId: USER_A, visibility: 'private' });
    await seedSession({ id: 'a-team', ownerId: USER_A, visibility: 'team' });
    await seedSession({ id: 'b-private', ownerId: USER_B, visibility: 'private' });
  });

  describe('API layer (real Hono requests authed as B)', () => {
    it('GET /sessions for B excludes A-private, includes A-team-visible and B-private', async () => {
      const res = await app.request('/api/sessions', { headers: headersB });
      expect(res.status).toBe(200);
      const data = (await res.json()) as ReadonlyArray<{ readonly id: string }>;
      const ids = data.map((row) => row.id).sort();
      expect(ids).toEqual(['a-team', 'b-private']);
    });

    it('GET /sessions/:id on A-private as B → 404', async () => {
      const res = await app.request('/api/sessions/a-private', { headers: headersB });
      expect(res.status).toBe(404);
    });

    it('GET /sessions/:id on A-private as A → 200', async () => {
      const res = await app.request('/api/sessions/a-private', { headers: headersA });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { readonly id: string };
      expect(data.id).toBe('a-private');
    });

    it('GET /sessions/:id on A-team-visible as B → 200', async () => {
      const res = await app.request('/api/sessions/a-team', { headers: headersB });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { readonly id: string };
      expect(data.id).toBe('a-team');
    });

    it('DELETE /sessions/:id on A-private as B → 404 (no cross-user delete)', async () => {
      const res = await app.request('/api/sessions/a-private', {
        method: 'DELETE',
        headers: headersB,
      });
      expect(res.status).toBe(404);
    });

    it("GET /sessions/:id/commits on A-private as B → 404 (commits don't leak)", async () => {
      const res = await app.request('/api/sessions/a-private/commits', { headers: headersB });
      expect(res.status).toBe(404);
    });
  });

  describe('queries layer (SSR)', () => {
    it('getSessionById A-private as B → null', async () => {
      const row = await getSessionById({ sessionId: 'a-private', teamId: TEAM, userId: USER_B });
      expect(row).toBeNull();
    });

    it('getSessionById A-private as A → row', async () => {
      const row = await getSessionById({ sessionId: 'a-private', teamId: TEAM, userId: USER_A });
      expect(row).not.toBeNull();
      expect(row?.id).toBe('a-private');
    });

    it('getSessionById A-team-visible as B → row', async () => {
      const row = await getSessionById({ sessionId: 'a-team', teamId: TEAM, userId: USER_B });
      expect(row).not.toBeNull();
      expect(row?.id).toBe('a-team');
    });

    it('getSessionTranscriptById A-private as B → null', async () => {
      const transcript = await getSessionTranscriptById({
        sessionId: 'a-private',
        teamId: TEAM,
        userId: USER_B,
      });
      expect(transcript).toBeNull();
    });

    it('listSessions for B excludes A-private, includes A-team-visible and B-private', async () => {
      const rows = await listSessions({ teamId: TEAM, userId: USER_B });
      const ids = rows.map((row) => row.id).sort();
      expect(ids).toEqual(['a-team', 'b-private']);
    });

    it('listSessions for A includes A-private and A-team-visible, excludes B-private', async () => {
      const rows = await listSessions({ teamId: TEAM, userId: USER_A });
      const ids = rows.map((row) => row.id).sort();
      expect(ids).toEqual(['a-private', 'a-team']);
    });
  });

  describe('new-session default', () => {
    it("an inserted session with no visibility set defaults to 'private'", async () => {
      await testDb.insert(orchidSession).values({
        id: 'defaults-private',
        userName: 'tester',
        userEmail: 'tester@example.com',
        userId: USER_A,
        teamId: TEAM,
        // visibility intentionally omitted — exercises the column default.
      });
      const [row] = await testDb
        .select({ visibility: orchidSession.visibility })
        .from(orchidSession)
        .where(eq(orchidSession.id, 'defaults-private'));
      expect(row?.visibility).toBe('private');
    });
  });
});
