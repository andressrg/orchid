import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@/app/lib/schema';
import { generateToken } from '@/app/lib/crypto';

const TEST_DB_URL =
  process.env.DATABASE_URL || 'postgresql://orchid:orchid@localhost:5432/orchid_test';

const testPool = new Pool({ connectionString: TEST_DB_URL });
export const testDb = drizzle(testPool, { schema });

let _testToken: string | null = null;
let _testUserId: string | null = null;

interface InsertTestSessionOverrides {
  readonly id?: string;
  readonly user_name?: string;
  readonly userName?: string;
  readonly user_email?: string;
  readonly userEmail?: string;
  readonly working_dir?: string;
  readonly workingDir?: string;
  readonly git_remotes?: readonly string[] | string;
  readonly gitRemotes?: readonly string[] | string;
  readonly branch?: string;
  readonly tool?: string;
  readonly transcript?: string;
  readonly status?: string;
  readonly message_count?: number;
  readonly messageCount?: number;
  readonly user_id?: string;
  readonly userId?: string;
}

export async function getTestAuth(): Promise<{
  token: string;
  userId: string;
  headers: Record<string, string>;
}> {
  if (_testToken && _testUserId) {
    return {
      token: _testToken,
      userId: _testUserId,
      headers: { authorization: `Bearer ${_testToken}` },
    };
  }

  const userId = `test-user-${Date.now()}`;
  await testDb
    .insert(schema.user)
    .values({
      id: userId,
      name: 'Test User',
      email: `test-${Date.now()}@example.com`,
      emailVerified: true,
    })
    .onConflictDoNothing();

  const { token, hash, prefix } = generateToken();
  await testDb.insert(schema.apiKey).values({
    userId,
    name: 'test-token',
    keyHash: hash,
    keyPrefix: prefix,
  });

  _testToken = token;
  _testUserId = userId;
  return { token, userId, headers: { authorization: `Bearer ${token}` } };
}

export async function cleanTestDb() {
  await testDb.delete(schema.subscription);
  await testDb.delete(schema.orchidSession);
  await testDb.delete(schema.organization);
}

// Accept both snake_case (legacy test format) and camelCase keys
export async function insertTestSession(overrides: InsertTestSessionOverrides = {}) {
  const { userId } = await getTestAuth();

  await testDb.insert(schema.orchidSession).values({
    id: (overrides.id ?? 'test-session-1') as string,
    userName: (overrides.user_name ?? overrides.userName ?? 'testuser') as string,
    userEmail: (overrides.user_email ?? overrides.userEmail ?? 'test@example.com') as string,
    workingDir: (overrides.working_dir ?? overrides.workingDir ?? '/home/test/project') as string,
    gitRemotes: (overrides.git_remotes ??
      overrides.gitRemotes ?? ['https://github.com/test/repo.git']) as string[],
    branch: (overrides.branch ?? 'main') as string,
    tool: (overrides.tool ?? 'claude') as string,
    transcript: (overrides.transcript ??
      '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi there"}') as string,
    status: (overrides.status ?? 'active') as string,
    messageCount: (overrides.message_count ?? overrides.messageCount ?? 2) as number,
    userId: (overrides.user_id ?? overrides.userId ?? userId) as string,
  });
}

export async function getTestTeamAuth(): Promise<{
  token: string;
  userId: string;
  teamId: string;
  teamSlug: string;
  headers: Record<string, string>;
}> {
  const { userId } = await getTestAuth();
  const teamId = `test-team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const teamSlug = `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await testDb.insert(schema.organization).values({
    id: teamId,
    name: 'Test Team',
    slug: teamSlug,
    createdAt: new Date(),
  });

  await testDb.insert(schema.member).values({
    id: `member-${teamId}`,
    organizationId: teamId,
    userId,
    role: 'owner',
    createdAt: new Date(),
  });

  const { token, hash, prefix } = generateToken();
  await testDb.insert(schema.apiKey).values({
    userId,
    teamId,
    name: 'test-team-token',
    keyHash: hash,
    keyPrefix: prefix,
  });

  return { token, userId, teamId, teamSlug, headers: { authorization: `Bearer ${token}` } };
}

export async function insertTestSubscription({
  teamId,
  status = 'active',
}: {
  readonly teamId: string;
  readonly status?: string;
}) {
  await testDb.insert(schema.subscription).values({
    id: `sub-${teamId}`,
    plan: 'team',
    referenceId: teamId,
    status,
    stripeCustomerId: `cus_${teamId.slice(-8)}`,
    stripeSubscriptionId: `sub_${teamId.slice(-8)}`,
    periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    seats: 1,
  });
}
