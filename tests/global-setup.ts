import { Client } from 'pg';

const DEFAULT_URL = 'postgres://postgres:postgres@localhost:5433/podcusts_test';

/** Creates the dedicated test database if it does not exist yet. */
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_URL);
  const dbName = url.pathname.slice(1);
  const admin = new Client({ connectionString: new URL('/postgres', url).toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
    if (!rowCount) await admin.query(`create database "${dbName}"`);
  } finally {
    await admin.end();
  }
}
