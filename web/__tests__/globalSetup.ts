import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { join } from 'path';

export async function setup() {
  const pool = new Pool({
    connectionString: 'postgresql://orchid:orchid@localhost:5432/orchid_test',
  });

  // Drop all tables for a clean slate
  await pool.query(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS "' || r.tablename || '" CASCADE';
      END LOOP;
    END $$;
  `);

  // Run Drizzle migrations
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') });

  await pool.end();
}
