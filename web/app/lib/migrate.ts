import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './db';

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Drizzle migrations applied');
}
