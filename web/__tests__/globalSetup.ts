import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { join } from 'path';

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

  // Run Drizzle migrations
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') });

  await pool.end();
}
