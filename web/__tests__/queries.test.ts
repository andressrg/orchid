import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { testDb, getTestAuth, cleanTestDb } from './setup';
import { orchidSession, organization } from '@/app/lib/schema';
import { getSessionById, getSessionTranscriptById } from '@/app/lib/queries';

// P0-3: the session-detail metadata read (`getSessionById`) must NOT pull the
// transcript TEXT column; the body is fetched separately via
// `getSessionTranscriptById`. Both are scoped to the team.
const TEAM = 'team-p03';
const OTHER_TEAM = 'team-other';
const TRANSCRIPT = '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi there"}';

describe('getSessionById / getSessionTranscriptById', () => {
  beforeAll(async () => {
    await getTestAuth();
    await testDb
      .insert(organization)
      .values({ id: TEAM, name: 'P0-3 Team', slug: TEAM, createdAt: new Date() })
      .onConflictDoNothing();
  });

  beforeEach(async () => {
    await cleanTestDb();
    const { userId } = await getTestAuth();
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
    const session = await getSessionById('s-p03', TEAM);
    expect(session).not.toBeNull();
    expect(session && 'transcript' in session).toBe(false);
    expect(session?.id).toBe('s-p03');
    expect(session?.message_count).toBe(2);
    expect(session?.status).toBe('done');
  });

  it('getSessionTranscriptById returns only the transcript body', async () => {
    const transcript = await getSessionTranscriptById('s-p03', TEAM);
    expect(transcript).toBe(TRANSCRIPT);
  });

  it('both are scoped to the team (wrong team → null)', async () => {
    expect(await getSessionById('s-p03', OTHER_TEAM)).toBeNull();
    expect(await getSessionTranscriptById('s-p03', OTHER_TEAM)).toBeNull();
  });
});
