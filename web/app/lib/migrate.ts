import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import pool from './db';

export async function runMigrations(): Promise<void> {
  const migrationsDir = join(process.cwd(), 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    await pool.query(sql);
  }

  console.log(`Migrations applied: ${files.length} files`);
}
