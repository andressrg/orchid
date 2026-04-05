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
  await testDb.insert(schema.user).values({
    id: userId,
    name: 'Test User',
    email: `test-${Date.now()}@example.com`,
    emailVerified: true,
  }).onConflictDoNothing();

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
  await testDb.delete(schema.orchidSession);
}

// Accept both snake_case (legacy test format) and camelCase keys
export async function insertTestSession(overrides: Record<string, unknown> = {}) {
  const { userId } = await getTestAuth();

  await testDb.insert(schema.orchidSession).values({
    id: (overrides.id ?? 'test-session-1') as string,
    userName: (overrides.user_name ?? overrides.userName ?? 'testuser') as string,
    userEmail: (overrides.user_email ?? overrides.userEmail ?? 'test@example.com') as string,
    workingDir: (overrides.working_dir ?? overrides.workingDir ?? '/home/test/project') as string,
    gitRemotes: (overrides.git_remotes ?? overrides.gitRemotes ?? ['https://github.com/test/repo.git']) as string[],
    branch: (overrides.branch ?? 'main') as string,
    tool: (overrides.tool ?? 'claude') as string,
    transcript: (overrides.transcript ?? '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi there"}') as string,
    status: (overrides.status ?? 'active') as string,
    messageCount: (overrides.message_count ?? overrides.messageCount ?? 2) as number,
    userId: (overrides.user_id ?? overrides.userId ?? userId) as string,
  });
}
