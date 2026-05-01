import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('drizzle migrations', () => {
  it('supports session commit upserts by session and commit SHA', async () => {
    const migrationSql = await readFile(
      new URL('../drizzle/0001_small_norrin_radd.sql', import.meta.url),
      'utf8',
    );

    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "session_commits_session_commit_uidx" ON "session_commits" USING btree ("session_id","commit_sha")',
    );
  });
});
