import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './db.js';
import { DrizzleMemoryRepository } from './memory-repository.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/podcusts_test';

/** Migrated, empty test database plus a repository bound to it. */
export async function createTestRepo() {
  const { db, close } = createDb(TEST_DATABASE_URL);
  await migrate(db, { migrationsFolder: 'drizzle' });
  await db.execute(sql`truncate table users, deceased, call_summaries cascade`);
  return { repo: new DrizzleMemoryRepository(db), close };
}
