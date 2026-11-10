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
  /** Accounts carried across without a person; zero on a full reset. */
  accounts: number;
  /** Whether the book of kings was deleted too. */
  full: boolean;
  /** The schema file the empty schema was built from. */
  applied: string[];
}

interface SurvivingKing {
  dynasty_name: string;
  crowned_at: Date;
  elapsed_hours: number;
}

/** The identity a reset keeps: everything but the town and the person it lost. */
interface SurvivingAccount {
  token_hash: string;
  player_id: number;
  name: string;
  created_at: Date;
  last_seen_at: Date;
  delete_after: Date | null;
}

/**
 * Drops the whole schema and builds it again from `db/schema.sql`.
 *
 * The book of kings and the accounts are copied across, because no ordinary
 * reset touches them: the token is the identity, and a reset takes the person,
 * not the player. A carried account comes back with no town and no person, and
 * its player chooses a trade on the next visit. A full reset deletes both.
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
      const accounts = full ? [] : await survivingAccounts(client);

      await client.query('DROP SCHEMA public CASCADE');
      await client.query('CREATE SCHEMA public');

      const applied = await buildSchema(client);

      await insertRows(
        client,
        'kings',
        ['dynasty_name', 'crowned_at', 'elapsed_hours'],
        kings.map((king) => [king.dynasty_name, king.crowned_at, king.elapsed_hours]),
      );

      // The account keeps its id, its family name and its dates; the person
      // does not cross.
      await insertRows(
        client,
        'players',
        ['token_hash', 'player_id', 'name', 'created_at', 'last_seen_at', 'delete_after'],
        accounts.map((account) => [
          account.token_hash,
          account.player_id,
          account.name,
          account.created_at,
          account.last_seen_at,
          account.delete_after,
        ]),
      );

      // The rebuilt players sequence starts at one; the carried ids must not
      // be handed to a new account. The next account takes max + 1.
      const maxPlayerId = accounts.map((account) => account.player_id).reduce((max, id) => Math.max(max, id), 0);
      if (maxPlayerId > 0) {
        await client.query(`SELECT setval(pg_get_serial_sequence('players', 'player_id'), $1, false)`, [
          maxPlayerId + 1,
        ]);
      }

      // One commit: a crash before it leaves the old town and its accounts
      // untouched, and the operator retries.
      await client.query('COMMIT');

      return { kings: kings.length, accounts: accounts.length, full, applied };
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
  // This function reads the schema it is about to drop and writes the one the
  // migrations rebuild, so it is the one place that still knows the old name:
  // a database reset before the rename carries `house_name`, one reset after it
  // carries `dynasty_name`.
  const nameColumn = types.has('dynasty_name') ? 'dynasty_name' : types.has('house_name') ? 'house_name' : null;
  // The book names nobody: a crown is the town's memory, and the account it was
  // worn by does not cross. A book of the shape that still carries a player id
  // crosses the same way, the column dropped with the schema that held it.
  const shape =
    nameColumn !== null &&
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
    dynasty_name: string;
    crowned_at: Date;
    elapsed_hours: number;
  }>(`SELECT ${nameColumn} AS dynasty_name, crowned_at, elapsed_hours FROM kings`);

  return rows.map((row) => ({
    dynasty_name: row.dynasty_name,
    crowned_at: row.crowned_at,
    elapsed_hours: row.elapsed_hours,
  }));
}

/**
 * The accounts an ordinary reset keeps. The token, the player id, the family
 * name, the dates and a pending deletion cross; the town and the person do not,
 * so the player chooses a trade on the next visit. An accounts table of the
 * older shape (a world id, no stable player id, no family name) cannot be
 * carried, so a non-empty one stops the reset with a named reason instead of a
 * silent cast.
 */
async function survivingAccounts(client: PoolClient): Promise<SurvivingAccount[]> {
  const { rows: present } = await client.query<{ present: boolean }>(
    `SELECT to_regclass('public.players') IS NOT NULL AS present`,
  );

  if (present[0]?.present !== true) {
    return [];
  }

  const { rows: columns } = await client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'players'`,
  );
  const presentColumns = new Set(columns.map((column) => column.column_name));
  const needed = ['token_hash', 'player_id', 'name', 'created_at', 'last_seen_at', 'delete_after'];

  if (!needed.every((column) => presentColumns.has(column))) {
    const { rows: count } = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM players');

    if ((count[0]?.count ?? 0) > 0) {
      throw new Error(
        'the accounts have an old shape; delete their rows first, or reset with --full (which also deletes the accounts)',
      );
    }

    return [];
  }

  const { rows } = await client.query<{
    token_hash: string;
    player_id: string;
    name: string;
    created_at: Date;
    last_seen_at: Date;
    delete_after: Date | null;
  }>(
    `SELECT token_hash, player_id, name, created_at, last_seen_at, delete_after
     FROM players
     ORDER BY player_id`,
  );

  return rows.map((row) => ({
    token_hash: row.token_hash,
    player_id: Number(row.player_id),
    name: row.name,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    delete_after: row.delete_after,
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
  /** Accounts that would survive without a person; zero on a full reset. */
  accounts: number;
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
    accounts: full ? 0 : await countIfPresent(pool, 'players'),
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
