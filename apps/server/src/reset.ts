import type { Pool, PoolClient } from 'pg';

import { buildSchema, withMigrationLock } from './migrations.ts';

export interface ResetOptions {
  /**
   * Also delete the book of kings. It outlives every other reset, so this is
   * the one wipe that takes it with the town.
   */
  full?: boolean;
}

export interface ResetReport {
  /** Kings carried across; zero on a full reset. */
  kings: number;
  /** Whether the book of kings was deleted too. */
  full: boolean;
  /** The migrations the empty schema was built from. */
  applied: string[];
}

interface SurvivingKing {
  player_id: number;
  house_name: string;
  person_name: string;
  crowned_at: Date;
  elapsed_hours: number;
}

/**
 * Drops the whole schema and builds it again from the migrations.
 *
 * The book of kings is copied across, because no ordinary reset touches it. A
 * full reset deletes it too. The town and its accounts always go: the tables
 * that hold the binding are rebuilt, and nothing can bind an account to a new
 * house yet.
 *
 * Destructive by design: the caller asks the operator first.
 */
export async function resetDatabase(pool: Pool, options: ResetOptions = {}): Promise<ResetReport> {
  const full = options.full === true;

  return withMigrationLock(pool, async (client) => {
    await client.query('BEGIN');

    try {
      // Read what survives before anything is dropped. A full reset carries
      // nothing.
      const kings = full ? [] : await survivingKings(client);

      await client.query('DROP SCHEMA public CASCADE');
      await client.query('CREATE SCHEMA public');

      const applied = await buildSchema(client);

      await insertRows(
        client,
        'kings',
        ['player_id', 'house_name', 'person_name', 'crowned_at', 'elapsed_hours'],
        kings.map((king) => [king.player_id, king.house_name, king.person_name, king.crowned_at, king.elapsed_hours]),
      );

      // The rebuilt players sequence starts at one; the carried book must not
      // hand its ids to a new account. The next account takes max + 1.
      if (kings.length > 0) {
        const maxPlayerId = kings.reduce((max, king) => Math.max(max, king.player_id), 0);
        await client.query(`SELECT setval(pg_get_serial_sequence('players', 'player_id'), $1, false)`, [
          maxPlayerId + 1,
        ]);
      }

      // One commit: a crash before it leaves the old town and its accounts
      // untouched, and the operator retries.
      await client.query('COMMIT');

      return { kings: kings.length, full, applied };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

/**
 * The book of kings used to hold an older shape: a town, a token hash, an
 * integer instant, no player id. A reset cannot convert those rows, so an old
 * book with rows stops the reset with a named reason instead of a silent cast.
 * The book is empty today, so an empty old table crosses as nothing.
 */
async function survivingKings(client: PoolClient): Promise<SurvivingKing[]> {
  const { rows: present } = await client.query<{ present: boolean }>(
    `SELECT to_regclass('public.kings') IS NOT NULL AS present`,
  );

  if (present[0]?.present !== true) {
    return [];
  }

  const { rows: columns } = await client.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'kings'`,
  );
  const types = new Map(columns.map((column) => [column.column_name, column.data_type]));
  const shape =
    types.get('player_id') === 'bigint' &&
    types.get('elapsed_hours') === 'integer' &&
    types.get('crowned_at') === 'timestamp with time zone';

  if (!shape) {
    const { rows: count } = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM kings');

    if ((count[0]?.count ?? 0) > 0) {
      throw new Error(
        'the book of kings has an old shape; delete its rows first, or reset with --full (which also deletes the book)',
      );
    }

    return [];
  }

  const { rows } = await client.query<{
    player_id: string;
    house_name: string;
    person_name: string;
    crowned_at: Date;
    elapsed_hours: number;
  }>(`SELECT player_id, house_name, person_name, crowned_at, elapsed_hours FROM kings`);

  return rows.map((row) => ({
    player_id: Number(row.player_id),
    house_name: row.house_name,
    person_name: row.person_name,
    crowned_at: row.crowned_at,
    elapsed_hours: row.elapsed_hours,
  }));
}

async function insertRows(client: PoolClient, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const marks = row.map((value) => {
      values.push(value);

      return `$${values.length}`;
    });

    return `(${marks.join(', ')})`;
  });

  await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`, values);
}

export interface TablePreview {
  name: string;
  rows: number;
}

/** What a reset would destroy, read without touching anything. */
export interface ResetPreview {
  database: string;
  tables: TablePreview[];
  full: boolean;
  /** Kings that would survive; zero on a full reset. */
  kings: number;
}

/**
 * Reads the database the way the reset would see it: every table in `public`
 * with its row count, and what the book of kings holds. Read-only, so it can
 * answer before a destructive run.
 */
export async function previewReset(pool: Pool, options: ResetOptions = {}): Promise<ResetPreview> {
  const full = options.full === true;
  const { rows: database } = await pool.query<{ name: string }>('SELECT current_database() AS name');
  const { rows: tables } = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );

  const previews: TablePreview[] = [];
  for (const table of tables) {
    const { rows } = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM "${table.table_name}"`);
    previews.push({ name: table.table_name, rows: rows[0]?.count ?? 0 });
  }

  return {
    database: database[0]?.name ?? 'unknown',
    tables: previews,
    full,
    kings: full ? 0 : await countIfPresent(pool, 'kings'),
  };
}

async function countIfPresent(pool: Pool, table: string): Promise<number> {
  const { rows: present } = await pool.query<{ present: boolean }>(
    `SELECT to_regclass('public.${table}') IS NOT NULL AS present`,
  );

  if (present[0]?.present !== true) {
    return 0;
  }

  const { rows } = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);

  return rows[0]?.count ?? 0;
}
