import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { testDb, getTestAuth, cleanTestDb } from './setup';
import { orchidSession, organization } from '@/app/lib/schema';
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
