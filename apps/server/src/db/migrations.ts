import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { Pool, PoolClient } from 'pg';

/**
 * One Postgres advisory lock guards a schema run: two deploy runners can start
 * together, and only one of them may look at the schema at a time. Arbitrary but
 * stable, so two deployments of two versions meet on the same key. Shared with
 * the reset, which destroys the schema the runners watch.
 */
export const MIGRATION_LOCK = 4_211_902;

/** Where the image ships its schema: `src/db` sits two levels under the package's `db`. */
export function defaultSchemaPath(): string {
  return join(import.meta.dirname, '..', '..', 'db', 'schema.sql');
}

/**
 * Applies the schema to an empty database, once, in one transaction, and
 * records it in `schema_migrations`. There is one file and no upgrade path: a
 * change edits `db/schema.sql`, and a deployed database crosses with a reset.
 *
 * Shared by the deploy command and the Postgres integration tests. Returns the
 * file it applied, so the caller decides whether to log it.
 */
export function applySchema(pool: Pool, file = defaultSchemaPath()): Promise<string[]> {
  return withMigrationLock(pool, async (client) => {
    await ensureMigrationsTable(client);

    const name = basename(file);
    const applied = await appliedMigrations(client);

    if (applied.has(name)) {
      return [];
    }

    const sql = await readFile(file, 'utf8');

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');

      return [name];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

/**
 * Builds the schema inside a transaction the caller owns, against an empty
 * schema, and records it. The reset uses it so the drop, the rebuild and the
 * surviving rows commit together.
 */
export async function buildSchema(client: PoolClient, file = defaultSchemaPath()): Promise<string[]> {
  await ensureMigrationsTable(client);

  const name = basename(file);
  await client.query(await readFile(file, 'utf8'));
  await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);

  return [name];
}

/**
 * What a deploy's schema gate asks: does this image carry a schema the database
 * does not have yet? If so the release must not serve. Waiting for the lock
 * means a check that arrives during a run answers about the schema after it.
 */
export function pendingSchema(pool: Pool, file = defaultSchemaPath()): Promise<string[]> {
  return withMigrationLock(pool, async (client) => {
    await ensureMigrationsTable(client);

    const name = basename(file);
    const applied = await appliedMigrations(client);

    return applied.has(name) ? [] : [name];
  });
}

export async function withMigrationLock<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
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

async function appliedMigrations(client: PoolClient): Promise<Set<string>> {
  const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');

  return new Set(rows.map((row) => row.name));
}
