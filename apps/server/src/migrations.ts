import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Pool, PoolClient } from 'pg';

/**
 * One Postgres advisory lock guards a migration run: two deploy runners can
 * start together, and only one of them may look at the schema at a time.
 * Arbitrary but stable, so two deployments of two versions meet on the same
 * key.
 */
const MIGRATION_LOCK = 4_211_902;

function defaultDirectory(): string {
  return join(import.meta.dirname, '..', 'db', 'migrations');
}

/**
 * Applies every migration exactly once, in file order, each in its own
 * transaction. Shared by the deploy command and the Postgres integration test:
 * the test starts from an empty database, and running this after the command is
 * a no-op because `schema_migrations` already lists the files.
 *
 * Returns the files it applied, so the caller decides whether to log them.
 */
export function applyMigrations(pool: Pool, directory = defaultDirectory()): Promise<string[]> {
  return withMigrationLock(pool, async (client) => {
    await ensureMigrationsTable(client);

    const files = await migrationFiles(directory);
    const applied = await appliedMigrations(client);
    const appliedNow: string[] = [];

    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }

      const sql = await readFile(join(directory, file), 'utf8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        appliedNow.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return appliedNow;
  });
}

/**
 * What a deploy's schema gate asks: does this image carry a migration the
 * database does not have yet? If so the release must not serve, and the
 * migrations have either not run or not finished. Waiting for the lock means a
 * check that arrives during a migration run answers about the schema after it.
 */
export function pendingMigrations(pool: Pool, directory = defaultDirectory()): Promise<string[]> {
  return withMigrationLock(pool, async (client) => {
    await ensureMigrationsTable(client);

    const applied = await appliedMigrations(client);

    return (await migrationFiles(directory)).filter((file) => !applied.has(file));
  });
}

async function withMigrationLock<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  // One connection for the lock and the whole run: a second connection would
  // need a slot in the pool while this one is already taken.
  const client = await pool.connect();
  let failed = false;

  try {
    // The lock comes before the table: two runners meeting an empty database
    // must not create `schema_migrations` at the same time.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);

    return await run(client);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    // A connection that died took its lock with it; unlocking must not hide
    // the error that made it die.
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
    // A run that failed may leave a broken connection behind; do not hand it
    // back to the pool.
    client.release(failed);
  }
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
}

async function migrationFiles(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
}

async function appliedMigrations(client: PoolClient): Promise<Set<string>> {
  const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');

  return new Set(rows.map((row) => row.name));
}
