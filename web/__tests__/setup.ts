import { Pool } from 'pg';

const TEST_DB_URL =
  process.env.DATABASE_URL || 'postgresql://orchid:orchid@localhost:5432/orchid_test';

export const testPool = new Pool({ connectionString: TEST_DB_URL });

export async function cleanTestDb() {
  await testPool.query('DELETE FROM sessions');
}

export async function insertTestSession(overrides: Record<string, unknown> = {}) {
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
  };

  const data = { ...defaults, ...overrides };

  await testPool.query(
    `INSERT INTO sessions (id, user_name, user_email, working_dir, git_remotes, branch, tool, transcript, status, message_count, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
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
    ],
  );
}
