import { Pool } from 'pg';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

async function runSqlMigrations(pool: Pool) {
  const migrationsFolder = join(__dirname, '..', 'drizzle');
  const migrationFiles = (await readdir(migrationsFolder))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  await migrationFiles.reduce(
    (migrationPromise, file) =>
      migrationPromise.then(async () => {
        const migrationSql = await readFile(join(migrationsFolder, file), 'utf8');
        const statements = migrationSql
          .split('--> statement-breakpoint')
          .map((statement) => statement.trim())
          .filter(Boolean);

        await statements.reduce(
          (statementPromise, statement) =>
            statementPromise.then(async () => {
              await pool.query(statement);
            }),
          Promise.resolve(),
        );
      }),
    Promise.resolve(),
  );
}

export async function setup() {
  const pool = new Pool({
    connectionString: 'postgresql://orchid:orchid@localhost:5432/orchid_test',
  });

  // Reset app tables and Drizzle's migration journal for a clean slate.
  await pool.query(`
    DROP SCHEMA IF EXISTS public CASCADE;
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    CREATE SCHEMA public;
  `);

  await runSqlMigrations(pool);

  await pool.end();
}
