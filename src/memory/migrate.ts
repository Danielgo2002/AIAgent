import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../config/env.js';
import { logger } from '../logger.js';
import { createDb } from './db.js';

const { db, close } = createDb(loadEnv().DATABASE_URL);
await migrate(db, { migrationsFolder: 'drizzle' });
await close();
logger.info('migrations applied');
