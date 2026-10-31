import { applyMigrations, pendingMigrations } from '../src/migrations.ts';

/**
 * Two callers: a deploy runs it as is, and a schema gate runs it with `--check`
 * to refuse service until the database matches the image it ships with.
 */
const checkOnly = process.argv.includes('--check');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const { Pool } = await import('pg');
const pool = new Pool({ connectionString });

try {
  if (checkOnly) {
    const pending = await pendingMigrations(pool);

    if (pending.length > 0) {
      process.stderr.write(`pending migrations: ${pending.join(', ')}\n`);
      process.exitCode = 1;
    }
  } else {
    for (const file of await applyMigrations(pool)) {
      process.stdout.write(`applied ${file}\n`);
    }
  }
} finally {
  await pool.end();
}
