import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildSchema } from '../src/db/migrations.ts';

const databaseUrl = process.env.DATABASE_URL ?? '';
const referencePath = join(import.meta.dirname, '..', 'db', 'schema.sql');

// Two throwaway schemas of the same database, so nothing else in the suite sees
// them and a failed run leaves nothing behind but a schema the next run drops.
const MIGRATED = 'schema_reference_migrated';
const FOLDED = 'schema_reference_folded';

// The runner's book, not the town: `buildSchema` creates it on the migrated
// side, and the reference does not restate it.
const RUNNER_TABLE = 'schema_migrations';

// Skips as a whole when there is no database to talk to, like the store test.
describe.runIf(databaseUrl !== '')('the schema reference', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await dropSchemas();
    await pool.end();
  });

  it('describes, exactly, the schema the migrations build', async () => {
    // Arrange
    await dropSchemas();
    const client = await pool.connect();

    try {
      await buildIn(client, MIGRATED);
      await buildIn(client, FOLDED, await readFile(referencePath, 'utf8'));

      // Act
      const migrated = await shape(client, MIGRATED);
      const folded = await shape(client, FOLDED);

      // Assert
      expect(folded, 'db/schema.sql has drifted from db/migrations').toEqual(migrated);
    } finally {
      client.release();
    }
  });

  async function dropSchemas(): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query(`DROP SCHEMA IF EXISTS ${MIGRATED} CASCADE`);
      await client.query(`DROP SCHEMA IF EXISTS ${FOLDED} CASCADE`);
    } finally {
      client.release();
    }
  }
});

/**
 * Builds one schema on one connection. The migrations name their tables
 * unqualified, so `search_path` is what decides where they land; it is local to
 * the transaction so a pooled connection never carries it away.
 */
async function buildIn(client: PoolClient, schema: string, sql?: string): Promise<void> {
  await client.query('BEGIN');

  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path = ${schema}`);

    if (sql === undefined) {
      await buildSchema(client);
    } else {
      await client.query(sql);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * What a schema is, as the catalogue describes it: its tables, columns,
 * constraints, indexes and sequences, one sortable line each. Anything both
 * schemas share — the default of a column, the definition of a foreign key —
 * comes from Postgres itself (`pg_get_constraintdef`, `pg_get_indexdef`) and
 * never from how the SQL was written, so a difference is a real difference.
 *
 * Five categories are enough because the migrations create nothing else today:
 * a migration that introduces a trigger, a view, a type or a policy must add it
 * here, or the reference could miss it and stay green.
 */
async function shape(client: PoolClient, schema: string): Promise<string[]> {
  const lines: string[] = [];
  const normalise = (text: string): string => text.replaceAll(`${schema}.`, '');

  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
    [schema],
  );
  for (const row of tables.rows) {
    if (row.table_name !== RUNNER_TABLE) {
      lines.push(`table ${row.table_name}`);
    }
  }

  const columns = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
    is_identity: string;
    identity_generation: string | null;
  }>(
    `SELECT table_name, column_name, data_type, is_nullable, column_default, is_identity, identity_generation
     FROM information_schema.columns
     WHERE table_schema = $1`,
    [schema],
  );
  for (const row of columns.rows) {
    if (row.table_name === RUNNER_TABLE) {
      continue;
    }

    lines.push(
      `column ${row.table_name}.${row.column_name} ${normalise(row.data_type)}` +
        ` nullable=${row.is_nullable} default=${normalise(row.column_default ?? '-')}` +
        ` identity=${row.is_identity}/${row.identity_generation ?? '-'}`,
    );
  }

  const constraints = await client.query<{ table_name: string; contype: string; definition: string }>(
    `SELECT t.relname AS table_name, c.contype, pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = $1`,
    [schema],
  );
  for (const row of constraints.rows) {
    if (row.table_name !== RUNNER_TABLE) {
      lines.push(`constraint ${row.table_name} ${row.contype} ${normalise(row.definition)}`);
    }
  }

  const indexes = await client.query<{ indexname: string; tablename: string; indexdef: string }>(
    `SELECT indexname, tablename, indexdef FROM pg_indexes WHERE schemaname = $1`,
    [schema],
  );
  // An index that backs a constraint repeats it, under a name of its own; it is
  // compared all the same, so the reference cannot lose the name.
  for (const row of indexes.rows) {
    if (row.tablename !== RUNNER_TABLE) {
      lines.push(`index ${row.indexname} ${normalise(row.indexdef)}`);
    }
  }

  const sequences = await client.query<{
    sequencename: string;
    data_type: string;
    start_value: string;
    min_value: string;
    max_value: string;
    increment_by: string;
    cycle: boolean;
    cache_size: string;
  }>(
    `SELECT sequencename, data_type, start_value::text, min_value::text, max_value::text,
            increment_by::text, cycle, cache_size::text
     FROM pg_sequences
     WHERE schemaname = $1`,
    [schema],
  );
  for (const row of sequences.rows) {
    lines.push(
      `sequence ${row.sequencename} ${row.data_type} ` +
        `start=${row.start_value} min=${row.min_value} max=${row.max_value} ` +
        `increment=${row.increment_by} cycle=${row.cycle} cache=${row.cache_size}`,
    );
  }

  return lines.sort();
}
