import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export async function setup() {
  const pool = new Pool({
    connectionString: 'postgresql://orchid:orchid@localhost:5432/orchid_test',
  });

  const migrationsDir = join(process.cwd(), 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    await pool.query(sql);
  }

  await pool.end();
}
