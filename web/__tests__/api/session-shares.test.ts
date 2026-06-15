import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { testDb, cleanTestDb } from '../setup';
import { generateToken } from '@/app/lib/crypto';
import {
  user,
  organization,
  apiKey,
  orchidSession,
  sessionShare,
  sessionCommit,
} from '@/app/lib/schema';
import { getSessionById, listSessions } from '@/app/lib/queries';
import app from '@/app/lib/api-app';

const FULL_SHA = 'c0ffee11c0ffee11c0ffee11c0ffee11c0ffee11';

// P1-3 — session share grants. An owner (A) grants another user scoped READ
// access to one of their PRIVATE sessions (S), and can revoke it. This extends
// the P1-2 read-scope (own OR team-visible) with a third disjunct: "OR the
// session is shared with me and the grant is not expired" — enforced in
// scopeConditions / sessionReadScopeSql (api-app.ts) and visibleSessionScope
// (queries.ts).
//
// Cross-user scoping can't be browser-tested with one account, so this is the
// authoritative verification. Three users (A, B, C). A owns a PRIVATE session S.
// B and C are NOT on A's team, so the only way either reads S is a grant.

const TEAM_A = 'team-share-a';
const USER_A = 'user-a-share';
const USER_B = 'user-b-share';
const USER_C = 'user-c-share';
const SESSION_S = 'session-s-share';

// A PAT carrying BOTH user_id and team_id (the web-session/PAT auth shape that
// hits the `userId && teamId` branch of scopeConditions).
const createScopedPat = async ({
  userId,
  teamId,
}: {
  readonly userId: string;
  readonly teamId: string | null;
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

const seedPrivateSessionS = async (): Promise<void> => {
  await testDb.insert(orchidSession).values({
    id: SESSION_S,
    userName: USER_A,
    userEmail: `${USER_A}@example.com`,
    workingDir: '/home/test/project',
    gitRemotes: ['https://github.com/test/repo.git'],
    branch: 'main',
    tool: 'claude',
    transcript: `{"role":"user","content":"${SESSION_S}"}`,
    status: 'done',
    messageCount: 1,
    userId: USER_A,
    teamId: TEAM_A,
    visibility: 'private',
  });
};

describe('P1-3 session share grants', () => {
  let headersA: Record<string, string>;
  let headersB: Record<string, string>;
  let headersC: Record<string, string>;

  beforeAll(async () => {
    await testDb
      .insert(user)
      .values([
        { id: USER_A, name: 'User A', email: `${USER_A}@example.com`, emailVerified: true },
        { id: USER_B, name: 'User B', email: `${USER_B}@example.com`, emailVerified: true },
        { id: USER_C, name: 'User C', email: `${USER_C}@example.com`, emailVerified: true },
      ])
      .onConflictDoNothing();
    await testDb
      .insert(organization)
      .values({ id: TEAM_A, name: 'Share Team A', slug: TEAM_A, createdAt: new Date() })
      .onConflictDoNothing();
    // A is on TEAM_A; B and C carry no team, so they can only read S via a grant.
    headersA = await createScopedPat({ userId: USER_A, teamId: TEAM_A });
    headersB = await createScopedPat({ userId: USER_B, teamId: null });
    headersC = await createScopedPat({ userId: USER_C, teamId: null });
  });

  beforeEach(async () => {
    // cleanTestDb deletes orchid_session; session_share cascades away with it.
    await cleanTestDb();
    await seedPrivateSessionS();
  });

  describe('before any share', () => {
    it('B GET /sessions/:S → 404', async () => {
      const res = await app.request(`/api/sessions/${SESSION_S}`, { headers: headersB });
      expect(res.status).toBe(404);
    });

    it('B GET /sessions list excludes S', async () => {
      const res = await app.request('/api/sessions', { headers: headersB });
      expect(res.status).toBe(200);
      const data = (await res.json()) as ReadonlyArray<{ readonly id: string }>;
      expect(data.map((row) => row.id)).not.toContain(SESSION_S);
    });

    it('queries getSessionById(S) as B → null', async () => {
      const row = await getSessionById({ sessionId: SESSION_S, teamId: TEAM_A, userId: USER_B });
      expect(row).toBeNull();
    });
  });

  describe('grant then read', () => {
    it('A POST /sessions/:S/share { granteeEmail: B } → 200; THEN B can read S and list includes it', async () => {
      const shareRes = await app.request(`/api/sessions/${SESSION_S}/share`, {
        method: 'POST',
        headers: { ...headersA, 'content-type': 'application/json' },
        body: JSON.stringify({ granteeEmail: `${USER_B}@example.com` }),
      });
      expect(shareRes.status).toBe(200);
      const grant = (await shareRes.json()) as {
        readonly grantee_user_id: string;
        readonly capability: string;
      };
      expect(grant.grantee_user_id).toBe(USER_B);
      expect(grant.capability).toBe('read');

      const getRes = await app.request(`/api/sessions/${SESSION_S}`, { headers: headersB });
      expect(getRes.status).toBe(200);
      const session = (await getRes.json()) as { readonly id: string };
      expect(session.id).toBe(SESSION_S);

      const listRes = await app.request('/api/sessions', { headers: headersB });
      const list = (await listRes.json()) as ReadonlyArray<{ readonly id: string }>;
      expect(list.map((row) => row.id)).toContain(SESSION_S);

      // queries layer mirrors the API: getSessionById is a row after the grant.
      const row = await getSessionById({ sessionId: SESSION_S, teamId: TEAM_A, userId: USER_B });
      expect(row).not.toBeNull();
      expect(row?.id).toBe(SESSION_S);

      const visible = await listSessions({ teamId: TEAM_A, userId: USER_B });
      expect(visible.map((r) => r.id)).toContain(SESSION_S);
    });

    it('A POST /sessions/:S/share { granteeUserId: B } also works', async () => {
      const res = await app.request(`/api/sessions/${SESSION_S}/share`, {
        method: 'POST',
        headers: { ...headersA, 'content-type': 'application/json' },
        body: JSON.stringify({ granteeUserId: USER_B }),
      });
      expect(res.status).toBe(200);
      const getRes = await app.request(`/api/sessions/${SESSION_S}`, { headers: headersB });
      expect(getRes.status).toBe(200);
    });

    it('granting to yourself → 400', async () => {
      const res = await app.request(`/api/sessions/${SESSION_S}/share`, {
        method: 'POST',
        headers: { ...headersA, 'content-type': 'application/json' },
        body: JSON.stringify({ granteeUserId: USER_A }),
      });
      expect(res.status).toBe(400);
    });

    it('unknown grantee email → 404', async () => {
      const res = await app.request(`/api/sessions/${SESSION_S}/share`, {
        method: 'POST',
        headers: { ...headersA, 'content-type': 'application/json' },
        body: JSON.stringify({ granteeEmail: 'nobody@example.com' }),
      });
      expect(res.status).toBe(404);
    });

    it('re-sharing upserts (one grant per session+grantee, updated capability)', async () => {
      await app.request(`/api/sessions/${SESSION_S}/share`, {
        method: 'POST',
        headers: { ...headersA, 'content-type': 'application/json' },
        body: JSON.stringify({ granteeUserId: USER_B, capability: 'read' }),
      });
      const res = await app.request(`/api/sessions/${SESSION_S}/share`, {
        method: 'POST',
        headers: { ...headersA, 'content-type': 'application/json' },
        body: JSON.stringify({ granteeUserId: USER_B, capability: 'continue' }),
      });
      expect(res.status).toBe(200);
      const rows = await testDb
        .select({ id: sessionShare.id, capability: sessionShare.capability })
        .from(sessionShare)
        .where(and(eq(sessionShare.sessionId, SESSION_S), eq(sessionShare.granteeUserId, USER_B)));
      expect(rows).toHaveLength(1);
      expect(rows[0].capability).toBe('continue');
    });
  });

  describe('non-owner cannot grant', () => {
    it('C POST /sessions/:S/share → 404 (S not visible to C) and C still cannot read S', async () => {
      const shareRes = await app.request(`/api/sessions/${SESSION_S}/share`, {
        method: 'POST',
        headers: { ...headersC, 'content-type': 'application/json' },
        body: JSON.stringify({ granteeUserId: USER_B }),
      });
      // S is private + C is not its owner and not on its team → not visible → 404.
      expect(shareRes.status).toBe(404);

      const getRes = await app.request(`/api/sessions/${SESSION_S}`, { headers: headersC });
      expect(getRes.status).toBe(404);
    });

    it('a non-owner who CAN see S (shared to C) still gets 403 on share', async () => {
      // Grant C read access first, so S is visible to C — but C is not the owner.
      await app.request(`/api/sessions/${SESSION_S}/share`, {
        method: 'POST',
        headers: { ...headersA, 'content-type': 'application/json' },
        body: JSON.stringify({ granteeUserId: USER_C }),
      });
      const canRead = await app.request(`/api/sessions/${SESSION_S}`, { headers: headersC });
      expect(canRead.status).toBe(200);

      const shareRes = await app.request(`/api/sessions/${SESSION_S}/share`, {
        method: 'POST',
        headers: { ...headersC, 'content-type': 'application/json' },
        body: JSON.stringify({ granteeUserId: USER_B }),
      });
      expect(shareRes.status).toBe(403);
    });
  });

  describe('revoke', () => {
    it('A DELETE /sessions/:S/share/:Bid → 200; THEN B GET /sessions/:S → 404 again', async () => {
      await app.request(`/api/sessions/${SESSION_S}/share`, {
        method: 'POST',
        headers: { ...headersA, 'content-type': 'application/json' },
        body: JSON.stringify({ granteeUserId: USER_B }),
      });
      const okBefore = await app.request(`/api/sessions/${SESSION_S}`, { headers: headersB });
      expect(okBefore.status).toBe(200);

      const delRes = await app.request(`/api/sessions/${SESSION_S}/share/${USER_B}`, {
        method: 'DELETE',
        headers: headersA,
      });
      expect(delRes.status).toBe(200);
      const deleted = (await delRes.json()) as { readonly deleted: string };
      expect(deleted.deleted).toBe(USER_B);

      const after = await app.request(`/api/sessions/${SESSION_S}`, { headers: headersB });
      expect(after.status).toBe(404);
    });

    it('DELETE a non-existent grant → 404', async () => {
      const res = await app.request(`/api/sessions/${SESSION_S}/share/${USER_B}`, {
        method: 'DELETE',
        headers: headersA,
      });
      expect(res.status).toBe(404);
    });
  });

  describe('expiry', () => {
    it('a grant with expiresAt in the past gives B NO access', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const shareRes = await app.request(`/api/sessions/${SESSION_S}/share`, {
        method: 'POST',
        headers: { ...headersA, 'content-type': 'application/json' },
        body: JSON.stringify({ granteeUserId: USER_B, expiresAt: past }),
      });
      expect(shareRes.status).toBe(200);

      const getRes = await app.request(`/api/sessions/${SESSION_S}`, { headers: headersB });
      expect(getRes.status).toBe(404);

      const row = await getSessionById({ sessionId: SESSION_S, teamId: TEAM_A, userId: USER_B });
      expect(row).toBeNull();
    });

    it('a grant with expiresAt in the future gives B access', async () => {
      const future = new Date(Date.now() + 3_600_000).toISOString();
      await app.request(`/api/sessions/${SESSION_S}/share`, {
        method: 'POST',
        headers: { ...headersA, 'content-type': 'application/json' },
        body: JSON.stringify({ granteeUserId: USER_B, expiresAt: future }),
      });
      const getRes = await app.request(`/api/sessions/${SESSION_S}`, { headers: headersB });
      expect(getRes.status).toBe(200);
    });
  });

  describe('list shares (owner-only)', () => {
    it('A GET /sessions/:S/shares returns the grantee + capability + expiry', async () => {
      await app.request(`/api/sessions/${SESSION_S}/share`, {
        method: 'POST',
        headers: { ...headersA, 'content-type': 'application/json' },
        body: JSON.stringify({ granteeEmail: `${USER_B}@example.com`, capability: 'read' }),
      });
      const res = await app.request(`/api/sessions/${SESSION_S}/shares`, { headers: headersA });
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        readonly shares: ReadonlyArray<{
          readonly grantee_user_id: string;
          readonly grantee_email: string;
          readonly capability: string;
        }>;
      };
      expect(data.shares).toHaveLength(1);
      expect(data.shares[0].grantee_user_id).toBe(USER_B);
      expect(data.shares[0].grantee_email).toBe(`${USER_B}@example.com`);
      expect(data.shares[0].capability).toBe('read');
    });

    it('B GET /sessions/:S/shares → 404 (not visible / not owner)', async () => {
      const res = await app.request(`/api/sessions/${SESSION_S}/shares`, { headers: headersB });
      expect(res.status).toBe(404);
    });
  });

  // A READ grant must never confer write/destroy. These guard the privilege-
  // escalation holes where DELETE /sessions/:id and POST /sessions/:id/commits
  // were gated on the read-scope predicate (which now includes the shared-with-me
  // branch) instead of ownership. B is granted read access to S, can READ it, but
  // must be blocked (403) from deleting it or writing commits to it — and S (plus
  // its grant) must survive intact.
  describe('a read grant does NOT confer write/delete (no privilege escalation)', () => {
    const grantReadToB = async (): Promise<void> => {
      const res = await app.request(`/api/sessions/${SESSION_S}/share`, {
        method: 'POST',
        headers: { ...headersA, 'content-type': 'application/json' },
        body: JSON.stringify({ granteeUserId: USER_B, capability: 'read' }),
      });
      expect(res.status).toBe(200);
      // Sanity: the grant really does give B READ access.
      const canRead = await app.request(`/api/sessions/${SESSION_S}`, { headers: headersB });
      expect(canRead.status).toBe(200);
    };

    it('B DELETE /sessions/:S → 403 and the session + grant survive', async () => {
      await grantReadToB();

      const delRes = await app.request(`/api/sessions/${SESSION_S}`, {
        method: 'DELETE',
        headers: headersB,
      });
      expect(delRes.status).toBe(403);

      // The session row was NOT destroyed.
      const [stillThere] = await testDb
        .select({ id: orchidSession.id })
        .from(orchidSession)
        .where(eq(orchidSession.id, SESSION_S));
      expect(stillThere?.id).toBe(SESSION_S);

      // The grant did NOT cascade away — B can still read.
      const stillReads = await app.request(`/api/sessions/${SESSION_S}`, { headers: headersB });
      expect(stillReads.status).toBe(200);
    });

    it('B POST /sessions/:S/commits → 403 and nothing is linked', async () => {
      await grantReadToB();

      const res = await app.request(`/api/sessions/${SESSION_S}/commits`, {
        method: 'POST',
        headers: { ...headersB, 'content-type': 'application/json' },
        body: JSON.stringify({ commits: [{ sha: FULL_SHA }] }),
      });
      expect(res.status).toBe(403);

      // No commit-link row was written to the owner's session.
      const rows = await testDb
        .select({ sha: sessionCommit.commitSha })
        .from(sessionCommit)
        .where(eq(sessionCommit.sessionId, SESSION_S));
      expect(rows).toHaveLength(0);
    });

    it('the owner (A) can still DELETE and POST commits to S', async () => {
      // Owner write still works (the fix must not break the legitimate path).
      const commitRes = await app.request(`/api/sessions/${SESSION_S}/commits`, {
        method: 'POST',
        headers: { ...headersA, 'content-type': 'application/json' },
        body: JSON.stringify({ commits: [{ sha: FULL_SHA }] }),
      });
      expect(commitRes.status).toBe(200);
      expect((await commitRes.json()).linked).toBe(1);

      const delRes = await app.request(`/api/sessions/${SESSION_S}`, {
        method: 'DELETE',
        headers: headersA,
      });
      expect(delRes.status).toBe(200);
      expect((await delRes.json()).deleted).toBe(SESSION_S);
    });
  });
});
