import type { Pool, PoolClient } from 'pg';

import { buildSchema, withMigrationLock } from './migrations.ts';

export interface ResetOptions {
  /**
   * Also delete the sealed seasons. They outlive every other reset, so this is
   * the one wipe that takes the register and the book of kings with it.
   */
  full?: boolean;
}

export interface ResetReport {
  /** Sealed seasons carried across; zero on a full reset. */
  archivedHouses: number;
  kings: number;
  /** Whether the sealed seasons were deleted too. */
  full: boolean;
  /** The migrations the empty schema was built from. */
  applied: string[];
}

interface SurvivingArchive {
  season: number;
  name: string;
  prestige: number;
  offices_held: number;
  title: string;
  generations: number;
  wealth_cents: number;
}

interface SurvivingKing {
  season: number;
  crowned_at: number;
  token_hash: string;
  house_name: string;
  person_name: string;
  ordinance: string | null;
  staple_good: string | null;
}

/**
 * Drops the whole schema and builds it again from the migrations.
 *
 * The sealed seasons — the register and the book of kings — are copied across,
 * because no ordinary reset touches them. A full reset deletes them too. The
 * town and its players always go: the tables that hold the token binding are
 * rebuilt, and nothing can bind a token to a new house yet.
 *
 * Destructive by design: the caller asks the operator first.
 */
export async function resetDatabase(pool: Pool, options: ResetOptions = {}): Promise<ResetReport> {
  const full = options.full === true;

  return withMigrationLock(pool, async (client) => {
    await client.query('BEGIN');

    try {
      // Read what survives before anything is dropped. The old schema has
      // neither the archive nor the kings, so each table is read only if it is
      // there, and a full reset carries nothing.
      const archivedHouses = full
        ? []
        : await survivors<SurvivingArchive>(
            client,
            'archive_houses',
            'season, name, prestige, offices_held, title, generations, wealth_cents',
          );
      const kings = full
        ? []
        : await survivors<SurvivingKing>(
            client,
            'kings',
            'season, crowned_at, token_hash, house_name, person_name, ordinance, staple_good',
          );

      await client.query('DROP SCHEMA public CASCADE');
      await client.query('CREATE SCHEMA public');

      const applied = await buildSchema(client);

      await insertRows(
        client,
        'archive_houses',
        ['season', 'name', 'prestige', 'offices_held', 'title', 'generations', 'wealth_cents'],
        archivedHouses.map((house) => [
          house.season,
          house.name,
          house.prestige,
          house.offices_held,
          house.title,
          house.generations,
          house.wealth_cents,
        ]),
      );
      await insertRows(
        client,
        'kings',
        ['season', 'crowned_at', 'token_hash', 'house_name', 'person_name', 'ordinance', 'staple_good'],
        kings.map((king) => [
          king.season,
          king.crowned_at,
          king.token_hash,
          king.house_name,
          king.person_name,
          king.ordinance,
          king.staple_good,
        ]),
      );

      // One commit: a crash before it leaves the old town and its tokens
      // untouched, and the operator retries.
      await client.query('COMMIT');

      return {
        archivedHouses: archivedHouses.length,
        kings: kings.length,
        full,
        applied,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function survivors<T>(client: PoolClient, table: string, columns: string): Promise<T[]> {
  const { rows } = await client.query<{ present: boolean }>(
    `SELECT to_regclass('public.${table}') IS NOT NULL AS present`,
  );

  if (rows[0]?.present !== true) {
    return [];
  }

  const survivors = await client.query(`SELECT ${columns} FROM ${table}`);

  return survivors.rows as T[];
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
  /** Sealed seasons that would survive; zero on a full reset. */
  archivedHouses: number;
  kings: number;
}

/**
 * Reads the database the way the reset would see it: every table in `public`
 * with its row count, and what the sealed seasons hold. Read-only, so it can
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
    archivedHouses: full ? 0 : await countIfPresent(pool, 'archive_houses'),
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
