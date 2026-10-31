import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const { Pool } = await import('pg');
const pool = new Pool({ connectionString });

try {
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
      process.stdout.write(`applied ${file}\n`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
