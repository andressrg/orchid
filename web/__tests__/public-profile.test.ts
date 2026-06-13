import { describe, it, expect, beforeEach } from 'vitest';
import { inArray } from 'drizzle-orm';
import { testDb, cleanTestDb } from './setup';
import { user, orchidSession, sessionCommit } from '@/app/lib/schema';
import {
  slugifyHandle,
  resolveProfileUser,
  getPublicEfficiencyProfile,
  efficiencyScore,
  efficiencyTierForScore,
  sessionTokenEstimate,
  TOKENS_PER_MESSAGE,
} from '@/app/lib/queries';

// P7-4: the public efficiency profile. Verifies handle resolution against
// existing user data and the aggregate, public-safe roll-up (per-day series,
// totals, and the Efficiency Score: PRs merged ÷ tokens spent with tiers).

const USER_ID = 'u-p74';
const EMAIL = 'ada.lovelace@example.com';

const dayUtc = (iso: string): Date => new Date(`${iso}T12:00:00Z`);

describe('slugifyHandle', () => {
  it('lower-cases, strips accents, and dash-joins', () => {
    expect(slugifyHandle('Julian Mazo')).toBe('julian-mazo');
    expect(slugifyHandle('Ada  Lovelace!!')).toBe('ada-lovelace');
    expect(slugifyHandle('José Ñandú')).toBe('jose-nandu');
  });
});

describe('efficiency score (PRs merged ÷ tokens spent)', () => {
  it('is PRs per million tokens, rounded to one decimal', () => {
    // 6 PRs over 2M tokens → 3 PR/MTok.
    expect(efficiencyScore({ prsMerged: 6, tokensSpent: 2_000_000 })).toBe(3);
    // 5 PRs over 1.5M tokens → 3.333… → 3.3.
    expect(efficiencyScore({ prsMerged: 5, tokensSpent: 1_500_000 })).toBe(3.3);
  });

  it('is zero when no tokens are known (avoids divide-by-zero)', () => {
    expect(efficiencyScore({ prsMerged: 4, tokensSpent: 0 })).toBe(0);
  });

  it('escalates tiers as the score climbs', () => {
    expect(efficiencyTierForScore(0).label).toBe('Warming up');
    expect(efficiencyTierForScore(1).label).toBe('Lean');
    expect(efficiencyTierForScore(3).label).toBe('Efficient');
    expect(efficiencyTierForScore(5).label).toBe('Elite');
    expect(efficiencyTierForScore(12).label).toBe('Legendary');
  });

  it('estimates tokens from message count via a single swap point', () => {
    expect(sessionTokenEstimate(10)).toBe(10 * TOKENS_PER_MESSAGE);
    expect(sessionTokenEstimate(-3)).toBe(0);
  });
});

describe('public efficiency profile', () => {
  beforeEach(async () => {
    await cleanTestDb();
    await testDb.delete(user).where(inArray(user.id, [USER_ID, 'u-quiet']));
    await testDb
      .insert(user)
      .values({ id: USER_ID, name: 'Ada Lovelace', email: EMAIL, emailVerified: true });

    // 3 sessions across 2 active days, owned by USER_ID.
    await testDb.insert(orchidSession).values([
      {
        id: 's1',
        userName: 'Ada Lovelace',
        userEmail: EMAIL,
        status: 'done',
        messageCount: 5,
        startedAt: dayUtc('2026-01-10'),
        updatedAt: dayUtc('2026-01-10'),
        userId: USER_ID,
      },
      {
        id: 's2',
        userName: 'Ada Lovelace',
        userEmail: EMAIL,
        status: 'done',
        messageCount: 8,
        startedAt: dayUtc('2026-01-10'),
        updatedAt: dayUtc('2026-01-10'),
        userId: USER_ID,
      },
      {
        id: 's3',
        userName: 'Ada Lovelace',
        userEmail: EMAIL,
        status: 'active',
        messageCount: 2,
        startedAt: dayUtc('2026-01-12'),
        updatedAt: dayUtc('2026-01-12'),
        userId: USER_ID,
      },
      // A legacy session: email matches but no user_id (captured pre-account).
      {
        id: 's4-legacy',
        userName: 'Ada Lovelace',
        userEmail: EMAIL,
        status: 'done',
        messageCount: 3,
        startedAt: dayUtc('2026-01-12'),
        updatedAt: dayUtc('2026-01-12'),
        userId: null,
      },
    ]);

    // 4 commits total: 3 on Jan 10, 1 on Jan 12.
    await testDb.insert(sessionCommit).values([
      { id: 'c1', sessionId: 's1', commitSha: 'a1', committedAt: dayUtc('2026-01-10') },
      { id: 'c2', sessionId: 's1', commitSha: 'a2', committedAt: dayUtc('2026-01-10') },
      { id: 'c3', sessionId: 's2', commitSha: 'b1', committedAt: dayUtc('2026-01-10') },
      { id: 'c4', sessionId: 's3', commitSha: 'd1', committedAt: dayUtc('2026-01-12') },
    ]);
  });

  it('resolves a handle by slugified name', async () => {
    const byName = await resolveProfileUser('julian-mazo');
    expect(byName).toBeNull(); // no such user

    const identity = await resolveProfileUser('ada-lovelace');
    expect(identity?.userId).toBe(USER_ID);
    expect(identity?.displayName).toBe('Ada Lovelace');
    expect(identity?.avatarInitial).toBe('A');
  });

  it('also resolves by email local-part and raw user id', async () => {
    expect((await resolveProfileUser('ada.lovelace'))?.userId).toBe(USER_ID);
    expect((await resolveProfileUser(USER_ID))?.userId).toBe(USER_ID);
  });

  it('aggregates sessions, PRs, tokens, and the efficiency score', async () => {
    const identity = await resolveProfileUser('ada-lovelace');
    expect(identity).not.toBeNull();
    const profile = await getPublicEfficiencyProfile(identity!);

    // Includes the legacy email-only session (s4) in every total.
    expect(profile.totalSessions).toBe(4);
    expect(profile.totalCommits).toBe(4);
    // PRs merged proxies commits until P7-1.
    expect(profile.prsMerged).toBe(4);
    // Tokens estimated from message_count (5 + 8 + 2 + 3 = 18) × TOKENS_PER_MESSAGE.
    expect(profile.tokensSpent).toBe(18 * TOKENS_PER_MESSAGE);
    expect(profile.tokensEstimated).toBe(true);
    // Score = 4 PRs ÷ (45_000 / 1_000_000) MTok = 88.9.
    expect(profile.score).toBe(
      efficiencyScore({ prsMerged: 4, tokensSpent: 18 * TOKENS_PER_MESSAGE }),
    );
    expect(profile.headlineMode).toBe('efficiency');
    expect(profile.tier.label).toBe(efficiencyTierForScore(profile.score).label);

    expect(profile.activeDays).toBe(2);
    expect(profile.firstActiveDay).toBe('2026-01-10');
    expect(profile.lastActiveDay).toBe('2026-01-12');

    // Per-day series carries both session and commit counts.
    const jan10 = profile.days.find((d) => d.day === '2026-01-10');
    const jan12 = profile.days.find((d) => d.day === '2026-01-12');
    expect(jan10).toEqual({ day: '2026-01-10', sessions: 2, commits: 3 });
    expect(jan12).toEqual({ day: '2026-01-12', sessions: 2, commits: 1 });
  });

  it('returns a zeroed profile for a user with no activity', async () => {
    await testDb.insert(user).values({
      id: 'u-quiet',
      name: 'Quiet User',
      email: 'quiet@example.com',
      emailVerified: true,
    });
    const identity = await resolveProfileUser('quiet-user');
    const profile = await getPublicEfficiencyProfile(identity!);
    expect(profile.totalSessions).toBe(0);
    expect(profile.activeDays).toBe(0);
    expect(profile.prsMerged).toBe(0);
    expect(profile.tokensSpent).toBe(0);
    expect(profile.score).toBe(0);
    expect(profile.headlineMode).toBe('empty');
    expect(profile.days).toHaveLength(0);
  });
});
