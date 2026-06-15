import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { testDb, getTestAuth, cleanTestDb } from './setup';
import { orchidSession, organization, user, sessionShare } from '@/app/lib/schema';
import { getSessionById, getSessionTranscriptById } from '@/app/lib/queries';

// P0-3: the session-detail metadata read (`getSessionById`) must NOT pull the
// transcript TEXT column; the body is fetched separately via
// `getSessionTranscriptById`.
//
// P1-2: both reads now take object params and enforce the visible-session
// read-scope. `s-p03` is owned by the test user, so it resolves for that user
// (ownership branch) regardless of visibility. The "wrong team" case uses a
// DIFFERENT viewer in a DIFFERENT team so neither the ownership nor the
// team-visible branch matches → null.
const TEAM = 'team-p03';
const OTHER_TEAM = 'team-other';
const OTHER_USER = 'other-user-p03';
const TRANSCRIPT = '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi there"}';

describe('getSessionById / getSessionTranscriptById', () => {
  let userId: string;

  beforeAll(async () => {
    userId = (await getTestAuth()).userId;
    await testDb
      .insert(organization)
      .values({ id: TEAM, name: 'P0-3 Team', slug: TEAM, createdAt: new Date() })
      .onConflictDoNothing();
  });

  beforeEach(async () => {
    await cleanTestDb();
    await testDb.insert(orchidSession).values({
      id: 's-p03',
      userName: 'testuser',
      userEmail: 'test@example.com',
      workingDir: '/home/test/project',
      gitRemotes: ['https://github.com/test/repo.git'],
      branch: 'main',
      tool: 'claude',
      transcript: TRANSCRIPT,
      status: 'done',
      messageCount: 2,
      userId,
      teamId: TEAM,
    });
  });

  it('getSessionById returns metadata WITHOUT the transcript body', async () => {
    const session = await getSessionById({ sessionId: 's-p03', teamId: TEAM, userId });
    expect(session).not.toBeNull();
    expect(session && 'transcript' in session).toBe(false);
    expect(session?.id).toBe('s-p03');
    expect(session?.message_count).toBe(2);
    expect(session?.status).toBe('done');
  });

  it('getSessionTranscriptById returns only the transcript body', async () => {
    const transcript = await getSessionTranscriptById({ sessionId: 's-p03', teamId: TEAM, userId });
    expect(transcript).toBe(TRANSCRIPT);
  });

  it('both are scoped (a different viewer in a different team → null)', async () => {
    expect(
      await getSessionById({ sessionId: 's-p03', teamId: OTHER_TEAM, userId: OTHER_USER }),
    ).toBeNull();
    expect(
      await getSessionTranscriptById({
        sessionId: 's-p03',
        teamId: OTHER_TEAM,
        userId: OTHER_USER,
      }),
    ).toBeNull();
  });
});

// P1-5: getSessionById carries `is_owner` so the session page can owner-gate the
// manage-shares UI (share-session.tsx). It's true only for the session's owner;
// a non-owner viewer who can READ the session via a share grant gets `false`,
// so they see Copy-link but never the invite/remove controls.
const SHARE_TEAM = 'team-isowner';
const SHARE_VIEWER = 'isowner-viewer';
const SHARED_SESSION = 's-isowner';

describe('getSessionById is_owner (P1-5 owner gate)', () => {
  let ownerId: string;

  beforeAll(async () => {
    ownerId = (await getTestAuth()).userId;
    await testDb
      .insert(organization)
      .values({ id: SHARE_TEAM, name: 'is_owner Team', slug: SHARE_TEAM, createdAt: new Date() })
      .onConflictDoNothing();
    await testDb
      .insert(user)
      .values({
        id: SHARE_VIEWER,
        name: 'Shared Viewer',
        email: `${SHARE_VIEWER}@example.com`,
        emailVerified: true,
      })
      .onConflictDoNothing();
  });

  beforeEach(async () => {
    // cleanTestDb deletes orchid_session; the share grant cascades away with it.
    await cleanTestDb();
    await testDb.insert(orchidSession).values({
      id: SHARED_SESSION,
      userName: 'owner',
      userEmail: 'owner@example.com',
      workingDir: '/home/test/project',
      gitRemotes: [],
      branch: 'main',
      tool: 'claude',
      transcript: TRANSCRIPT,
      status: 'done',
      messageCount: 1,
      userId: ownerId,
      teamId: SHARE_TEAM,
      visibility: 'private',
    });
    // Grant the non-owner viewer scoped read access (so the session is visible
    // to them, but they are not the owner).
    await testDb.insert(sessionShare).values({
      sessionId: SHARED_SESSION,
      granteeUserId: SHARE_VIEWER,
      capability: 'read',
      createdBy: ownerId,
    });
  });

  it('is_owner is true for the owner', async () => {
    const session = await getSessionById({
      sessionId: SHARED_SESSION,
      teamId: SHARE_TEAM,
      userId: ownerId,
    });
    expect(session).not.toBeNull();
    expect(session?.is_owner).toBe(true);
  });

  it('is_owner is false for a non-owner viewer with shared access', async () => {
    const session = await getSessionById({
      sessionId: SHARED_SESSION,
      teamId: SHARE_TEAM,
      userId: SHARE_VIEWER,
    });
    // The viewer CAN read the session (shared-with-me branch)…
    expect(session).not.toBeNull();
    expect(session?.id).toBe(SHARED_SESSION);
    // …but is NOT the owner, so the manage-shares UI stays hidden.
    expect(session?.is_owner).toBe(false);
  });
});
