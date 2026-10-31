import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Pool } from 'pg';

/**
 * Applies every migration exactly once, in file order, each in its own
 * transaction. Shared by the deploy command and the Postgres integration test:
 * the test starts from an empty database, and running this after the command is
 * a no-op because `schema_migrations` already lists the files.
 *
 * Returns the files it applied, so the caller decides whether to log them.
 */
export async function applyMigrations(pool: Pool): Promise<string[]> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  const directory = join(import.meta.dirname, '..', 'db', 'migrations');
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name));
  const appliedNow: string[] = [];

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = await readFile(join(directory, file), 'utf8');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      appliedNow.push(file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return appliedNow;
}
