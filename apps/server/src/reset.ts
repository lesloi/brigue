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
  /** Place names already spent; zero on a full reset. */
  townNames: number;
  /** Whether the sealed seasons were deleted too. */
  full: boolean;
  /** The migrations the empty schema was built from. */
  applied: string[];
}

interface SurvivingArchive {
  town_id: string;
  season: number;
  name: string;
  prestige: number;
  offices_held: number;
  title: string;
  generations: number;
  wealth_cents: number;
}

interface SurvivingKing {
  town_id: string;
  crowned_at: Date;
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
            'town_id, season, name, prestige, offices_held, title, generations, wealth_cents',
          );
      const kings = full ? [] : await survivingKings(client);
      // A spent name stays spent: the archive keeps town ids, and a recycled
      // name would recycle its id into an archived season.
      const townNames = full ? [] : await survivors<{ name: string }>(client, 'town_names', 'name');

      await client.query('DROP SCHEMA public CASCADE');
      await client.query('CREATE SCHEMA public');

      const applied = await buildSchema(client);

      await insertRows(
        client,
        'archive_houses',
        ['town_id', 'season', 'name', 'prestige', 'offices_held', 'title', 'generations', 'wealth_cents'],
        archivedHouses.map((house) => [
          house.town_id,
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
        ['town_id', 'crowned_at', 'token_hash', 'house_name', 'person_name', 'ordinance', 'staple_good'],
        kings.map((king) => [
          king.town_id,
          king.crowned_at,
          king.token_hash,
          king.house_name,
          king.person_name,
          king.ordinance,
          king.staple_good,
        ]),
      );
      await insertRows(
        client,
        'town_names',
        ['name'],
        townNames.map((town) => [town.name]),
      );

      // One commit: a crash before it leaves the old town and its tokens
      // untouched, and the operator retries.
      await client.query('COMMIT');

      return {
        archivedHouses: archivedHouses.length,
        kings: kings.length,
        townNames: townNames.length,
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

/**
 * The book of kings used to hold the town's hour in an integer. A town hour
 * cannot become an instant once the town is dropped, so an old book with rows
 * stops the reset with a named reason instead of a silent cast. The book is
 * empty today, so an empty old table crosses as nothing.
 */
async function survivingKings(client: PoolClient): Promise<SurvivingKing[]> {
  const { rows: present } = await client.query<{ present: boolean }>(
    `SELECT to_regclass('public.kings') IS NOT NULL AS present`,
  );

  if (present[0]?.present !== true) {
    return [];
  }

  const { rows: columns } = await client.query<{ data_type: string }>(
    `SELECT data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'kings' AND column_name = 'crowned_at'`,
  );

  if (columns[0]?.data_type !== 'timestamp with time zone') {
    const { rows: count } = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM kings');

    if ((count[0]?.count ?? 0) > 0) {
      throw new Error(
        'the book of kings holds town hours that cannot be converted to instants; delete its rows first, or reset with --full (which also deletes the register)',
      );
    }

    return [];
  }

  const { rows } = await client.query(
    `SELECT town_id, crowned_at, token_hash, house_name, person_name, ordinance, staple_good
     FROM kings`,
  );

  return rows as SurvivingKing[];
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
  /** Spent place names that would survive; zero on a full reset. */
  townNames: number;
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
    townNames: full ? 0 : await countIfPresent(pool, 'town_names'),
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
