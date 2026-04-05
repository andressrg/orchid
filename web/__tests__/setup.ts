import { Pool } from 'pg';
import { generateToken } from '@/app/lib/crypto';

const TEST_DB_URL =
  process.env.DATABASE_URL || 'postgresql://orchid:orchid@localhost:5432/orchid_test';

export const testPool = new Pool({ connectionString: TEST_DB_URL });

// Cached test PAT — created once per test run
let _testToken: string | null = null;
let _testUserId: string | null = null;

export async function getTestAuth(): Promise<{ token: string; userId: string; headers: Record<string, string> }> {
  if (_testToken && _testUserId) {
    return { token: _testToken, userId: _testUserId, headers: { authorization: `Bearer ${_testToken}` } };
  }

  // Create a test user
  const userId = `test-user-${Date.now()}`;
  await testPool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [userId, 'Test User', `test-${Date.now()}@example.com`],
  );

  // Create a PAT
  const { token, hash, prefix } = generateToken();
  await testPool.query(
    `INSERT INTO api_keys (user_id, name, key_hash, key_prefix) VALUES ($1, $2, $3, $4)`,
    [userId, 'test-token', hash, prefix],
  );

  _testToken = token;
  _testUserId = userId;
  return { token, userId, headers: { authorization: `Bearer ${token}` } };
}

export async function cleanTestDb() {
  await testPool.query('DELETE FROM orchid_sessions');
}

export async function insertTestSession(overrides: Record<string, unknown> = {}) {
  // Ensure test user exists so we can associate sessions
  const { userId } = await getTestAuth();

  const defaults = {
    id: 'test-session-1',
    user_name: 'testuser',
    user_email: 'test@example.com',
    working_dir: '/home/test/project',
    git_remotes: JSON.stringify(['https://github.com/test/repo.git']),
    branch: 'main',
    tool: 'claude',
    transcript: '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi there"}',
    status: 'active',
    message_count: 2,
    user_id: userId,
  };

  const data = { ...defaults, ...overrides };

  await testPool.query(
    `INSERT INTO orchid_sessions (id, user_name, user_email, working_dir, git_remotes, branch, tool, transcript, status, message_count, user_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
    [
      data.id,
      data.user_name,
      data.user_email,
      data.working_dir,
      data.git_remotes,
      data.branch,
      data.tool,
      data.transcript,
      data.status,
      data.message_count,
      data.user_id,
    ],
  );
}
