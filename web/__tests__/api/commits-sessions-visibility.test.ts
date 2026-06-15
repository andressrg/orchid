import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { testDb, cleanTestDb } from '../setup';
import { generateToken } from '@/app/lib/crypto';
import { user, organization, apiKey, orchidSession, sessionCommit } from '@/app/lib/schema';
import app from '@/app/lib/api-app';

// P1-2 — the commit reverse-lookup endpoint (GET /api/commits/sessions) is a
// session-READ path: it returns session metadata (user_email, working_dir,
// git_remotes, branch, tool, status, timestamps). It MUST enforce the same
// read-scope as scopeConditions / /review-context: a session surfaces IFF the
// caller owns it OR it is team-visible to the caller's team.
//
// Without that guard, ANY authenticated caller — even in a DIFFERENT team —
// could reverse a commit SHA prefix into another user's PRIVATE / cross-team
// session metadata. This file is the authoritative cross-user + cross-team
// verification (the leak the PR claims to close).

const TEAM_A = 'cs-team-a';
const TEAM_B = 'cs-team-b';
const USER_A = 'cs-user-a';
const USER_B = 'cs-user-b';

// A-private's commit — the SHA an attacker would reverse-lookup. Full 40-char
// hex so the >=7-char prefix guard is satisfied by any prefix slice.
const A_PRIVATE_SHA = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
const A_TEAM_SHA = 'ffff6666eeee7777dddd8888cccc9999bbbb0000';

// A PAT carrying BOTH user_id and team_id (the web-session/PAT auth shape that
// hits the `userId && teamId` branch of the scope). Returns the bearer header
// the Hono app authenticates with.
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
    name: `pat-${userId}-${teamId}`,
    keyHash: hash,
    keyPrefix: prefix,
  });
  return { authorization: `Bearer ${token}` };
};

const seedSessionWithCommit = async ({
  id,
  ownerId,
  teamId,
  visibility,
  commitSha,
}: {
  readonly id: string;
  readonly ownerId: string;
  readonly teamId: string;
  readonly visibility: 'private' | 'team';
  readonly commitSha: string;
}): Promise<void> => {
  await testDb.insert(orchidSession).values({
    id,
    userName: ownerId,
    userEmail: 'leak-user-a@secret.com',
    workingDir: '/home/a/secret-project',
    gitRemotes: ['https://github.com/a/private-repo.git'],
    branch: 'feat/secret',
    tool: 'claude',
    transcript: `{"role":"user","content":"${id}"}`,
    status: 'done',
    messageCount: 1,
    userId: ownerId,
    teamId,
    visibility,
  });
  await testDb.insert(sessionCommit).values({
    sessionId: id,
    commitSha,
    branch: 'feat/secret',
    message: 'secret commit',
    remote: 'https://github.com/a/private-repo.git',
    committedAt: new Date(),
  });
};

interface CommitSessionRow {
  readonly session_id: string;
  readonly commit_sha: string;
  readonly user_email: string;
  readonly working_dir: string;
  readonly git_remotes: readonly string[];
}

const requestSessionsForShas = async ({
  headers,
  shas,
}: {
  readonly headers: Record<string, string>;
  readonly shas: readonly string[];
}) => {
  const res = await app.request(`/api/commits/sessions?shas=${shas.join(',')}`, { headers });
  const data = (await res.json()) as { sessions?: readonly CommitSessionRow[]; error?: string };
  return { status: res.status, data };
};

describe('GET /api/commits/sessions — read-scope enforcement', () => {
  let headersA: Record<string, string>;
  let headersBSameTeam: Record<string, string>;
  let headersBOtherTeam: Record<string, string>;

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
      .values([
        { id: TEAM_A, name: 'Team A', slug: TEAM_A, createdAt: new Date() },
        { id: TEAM_B, name: 'Team B', slug: TEAM_B, createdAt: new Date() },
      ])
      .onConflictDoNothing();
    headersA = await createScopedPat({ userId: USER_A, teamId: TEAM_A });
    headersBSameTeam = await createScopedPat({ userId: USER_B, teamId: TEAM_A });
    headersBOtherTeam = await createScopedPat({ userId: USER_B, teamId: TEAM_B });
  });

  beforeEach(async () => {
    await cleanTestDb();
    await seedSessionWithCommit({
      id: 'a-private',
      ownerId: USER_A,
      teamId: TEAM_A,
      visibility: 'private',
      commitSha: A_PRIVATE_SHA,
    });
    await seedSessionWithCommit({
      id: 'a-team',
      ownerId: USER_A,
      teamId: TEAM_A,
      visibility: 'team',
      commitSha: A_TEAM_SHA,
    });
  });

  it('attacker B in a DIFFERENT team gets ZERO rows for A-private (no cross-team leak)', async () => {
    const { status, data } = await requestSessionsForShas({
      headers: headersBOtherTeam,
      shas: [A_PRIVATE_SHA],
    });
    expect(status).toBe(200);
    expect(data.sessions).toEqual([]);
    // None of the private metadata may surface.
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('leak-user-a@secret.com');
    expect(serialized).not.toContain('/home/a/secret-project');
    expect(serialized).not.toContain('https://github.com/a/private-repo.git');
  });

  it('attacker B in a DIFFERENT team gets ZERO rows even for A-team-visible (wrong team)', async () => {
    const { status, data } = await requestSessionsForShas({
      headers: headersBOtherTeam,
      shas: [A_TEAM_SHA],
    });
    expect(status).toBe(200);
    expect(data.sessions).toEqual([]);
  });

  it('team-mate B (same team) gets A-team-visible but NOT A-private', async () => {
    const teamVisible = await requestSessionsForShas({
      headers: headersBSameTeam,
      shas: [A_TEAM_SHA],
    });
    expect(teamVisible.status).toBe(200);
    expect(teamVisible.data.sessions).toHaveLength(1);
    expect(teamVisible.data.sessions?.[0].session_id).toBe('a-team');

    const privateLookup = await requestSessionsForShas({
      headers: headersBSameTeam,
      shas: [A_PRIVATE_SHA],
    });
    expect(privateLookup.status).toBe(200);
    expect(privateLookup.data.sessions).toEqual([]);
  });

  it('owner A sees their own private session by its commit sha', async () => {
    const { status, data } = await requestSessionsForShas({
      headers: headersA,
      shas: [A_PRIVATE_SHA],
    });
    expect(status).toBe(200);
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions?.[0].session_id).toBe('a-private');
    expect(data.sessions?.[0].user_email).toBe('leak-user-a@secret.com');
  });

  it('rejects short SHA prefixes (anti-enumeration) with 400', async () => {
    const { status } = await requestSessionsForShas({ headers: headersA, shas: ['aaaa11'] });
    expect(status).toBe(400);
  });

  it('rejects non-hex SHA prefixes with 400', async () => {
    const { status } = await requestSessionsForShas({
      headers: headersA,
      shas: ['not-a-real-sha'],
    });
    expect(status).toBe(400);
  });

  it('400s when shas is missing', async () => {
    const res = await app.request('/api/commits/sessions', { headers: headersA });
    expect(res.status).toBe(400);
  });
});
