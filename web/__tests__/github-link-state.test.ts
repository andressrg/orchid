import { describe, it, expect, beforeEach } from 'vitest';
import { inArray } from 'drizzle-orm';
import { testDb } from './setup';
import { account, user } from '@/app/lib/schema';
import { getGithubLinkState } from '@/app/lib/queries';

// The server logic behind the settings "Connected accounts" affordance.
// `getGithubLinkState` drives whether the page shows "Link GitHub" or
// "Connected as @<login>". Linked-state is read from the `account` table so it
// holds for both the logged-out sign-in and the logged-in /link-social flows;
// `githubLogin` is the display handle and may be null even when linked.

const UNLINKED = 'u-link-none';
const LINKED_NO_LOGIN = 'u-link-bare';
const LINKED_WITH_LOGIN = 'u-link-handle';
const USER_IDS = [UNLINKED, LINKED_NO_LOGIN, LINKED_WITH_LOGIN];

const now = new Date();

describe('getGithubLinkState', () => {
  beforeEach(async () => {
    await testDb.delete(account).where(inArray(account.userId, USER_IDS));
    await testDb.delete(user).where(inArray(user.id, USER_IDS));

    await testDb.insert(user).values([
      { id: UNLINKED, name: 'No Link', email: 'none@example.com', emailVerified: true },
      { id: LINKED_NO_LOGIN, name: 'Bare Link', email: 'bare@example.com', emailVerified: true },
      {
        id: LINKED_WITH_LOGIN,
        name: 'Handle Link',
        email: 'handle@example.com',
        emailVerified: true,
        githubLogin: 'octocat',
        githubId: '583231',
      },
    ]);

    // GitHub account rows for the two "linked" users. The bare one mirrors the
    // logged-in /link-social path, which attaches the account without writing
    // githubLogin onto the user.
    await testDb.insert(account).values([
      {
        id: 'acc-bare-gh',
        accountId: '111',
        providerId: 'github',
        userId: LINKED_NO_LOGIN,
        updatedAt: now,
      },
      {
        id: 'acc-handle-gh',
        accountId: '583231',
        providerId: 'github',
        userId: LINKED_WITH_LOGIN,
        updatedAt: now,
      },
      // A credential (email/password) account on the unlinked user — must NOT
      // count as a GitHub link.
      {
        id: 'acc-none-cred',
        accountId: UNLINKED,
        providerId: 'credential',
        userId: UNLINKED,
        updatedAt: now,
      },
    ]);
  });

  it('reports not linked when the user has no GitHub account row', async () => {
    const state = await getGithubLinkState(UNLINKED);
    expect(state.linked).toBe(false);
    expect(state.githubLogin).toBeNull();
  });

  it('reports linked from the account table even when githubLogin is absent', async () => {
    const state = await getGithubLinkState(LINKED_NO_LOGIN);
    expect(state.linked).toBe(true);
    expect(state.githubLogin).toBeNull();
  });

  it('reports linked with the github handle for display when present', async () => {
    const state = await getGithubLinkState(LINKED_WITH_LOGIN);
    expect(state.linked).toBe(true);
    expect(state.githubLogin).toBe('octocat');
  });
});
