import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { previewReset, resetDatabase } from '../src/db/reset.ts';

// Runs alone, after the parallel suite: the reset drops the schema the other
// Postgres tests use, so it is gated on RESET_DATABASE_URL and never part of
// `pnpm test` as usual.
const resetUrl = process.env.RESET_DATABASE_URL ?? '';

const CROWNED_AT = new Date('2026-01-01T12:00:00Z');
const CREATED_AT = new Date('2026-01-01T10:00:00Z');
const LAST_SEEN_AT = new Date('2026-01-02T10:00:00Z');
const DELETE_AFTER = new Date('2026-01-09T10:00:00Z');

describe.runIf(resetUrl !== '')('resetDatabase', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: resetUrl });
  });

  beforeEach(async () => {
    // Start every case from an empty database, the book included.
    await resetDatabase(pool, { full: true });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seed(): Promise<{ tokenHash: string; townId: number; playerId: number }> {
    // Arrange: a bound account, a king, and a town that should not survive.
    const tokenHash = 'a'.repeat(64);
    const { rows: townRows } = await pool.query<{ id: string }>(
      `INSERT INTO towns (name) VALUES ('Saint-Aubin') RETURNING id`,
    );
    const townId = Number(townRows[0]?.id);
    const { rows: playerRows } = await pool.query<{ player_id: string }>(
      `INSERT INTO players (token_hash, dynasty_id, created_at, last_seen_at, delete_after)
       VALUES ($1, 'leclerc', $2, $3, $4)
       RETURNING player_id`,
      [tokenHash, CREATED_AT, LAST_SEEN_AT, DELETE_AFTER],
    );
    const playerId = Number(playerRows[0]?.player_id);
    await pool.query(
      `INSERT INTO kings (player_id, dynasty_name, person_name, crowned_at, elapsed_hours)
       VALUES ($1, 'Leclerc', 'Aubin', $2, 12)`,
      [playerId, CROWNED_AT],
    );
    await pool.query(
      `INSERT INTO state (town_id, format_version, ruleset_version, seed, rng, hour, year, hour_started_at)
       VALUES ($1, 1, 1, 7, 7, 1, 1, now())`,
      [townId],
    );

    return { tokenHash, townId, playerId };
  }

  it('keeps the book of kings and the account, and takes the dynasty', async () => {
    // Arrange
    const { tokenHash, playerId } = await seed();

    // Act
    const report = await resetDatabase(pool);

    // Assert: the town is gone, the account keeps its identity and its dates,
    // and the dynasty is the only thing it lost.
    const state = await pool.query('SELECT count(*)::int AS count FROM state');
    const players = await pool.query<{
      token_hash: string;
      player_id: string;
      dynasty_id: string | null;
      created_at: Date;
      last_seen_at: Date;
      revoked_at: Date | null;
      delete_after: Date | null;
    }>(
      `SELECT token_hash, player_id, dynasty_id, created_at, last_seen_at, revoked_at, delete_after
       FROM players`,
    );
    const kings = await pool.query<{ player_id: string; crowned_at: Date }>('SELECT player_id, crowned_at FROM kings');

    expect(state.rows[0]?.count).toBe(0);
    expect(players.rows).toHaveLength(1);
    expect(players.rows[0]).toMatchObject({
      token_hash: tokenHash,
      dynasty_id: null,
      revoked_at: null,
    });
    expect(Number(players.rows[0]?.player_id)).toBe(playerId);
    expect(players.rows[0]?.created_at.toISOString()).toBe(CREATED_AT.toISOString());
    expect(players.rows[0]?.last_seen_at.toISOString()).toBe(LAST_SEEN_AT.toISOString());
    expect(players.rows[0]?.delete_after?.toISOString()).toBe(DELETE_AFTER.toISOString());
    expect(kings.rows).toHaveLength(1);
    expect(Number(kings.rows[0]?.player_id)).toBe(playerId);
    expect(kings.rows[0]?.crowned_at.toISOString()).toBe(CROWNED_AT.toISOString());
    expect(report).toMatchObject({ kings: 1, accounts: 1, full: false });
    expect(report.applied).toContain('0001_initial.sql');
    expect(report.applied).toContain('0002_accounts_without_dynasty.sql');
  });

  it('carries a book of kings written before the rename', async () => {
    // Arrange: the book as a database has it before the world's fields took the
    // name dynasty, with one crowned king. The drop reads this column and the
    // rebuilt table has the other, so the reset is the bridge between the two.
    await pool.query('DROP TABLE kings');
    await pool.query(
      `CREATE TABLE kings (
         player_id bigint NOT NULL,
         house_name text NOT NULL,
         person_name text NOT NULL,
         crowned_at timestamp with time zone NOT NULL,
         elapsed_hours integer NOT NULL
       )`,
    );
    await pool.query(
      `INSERT INTO kings (player_id, house_name, person_name, crowned_at, elapsed_hours)
       VALUES (42, 'Leclerc', 'Aubin', $1, 12)`,
      [CROWNED_AT],
    );

    // Act
    const report = await resetDatabase(pool);

    // Assert: the book crosses, under its new column.
    const kings = await pool.query<{ player_id: string; dynasty_name: string }>(
      'SELECT player_id, dynasty_name FROM kings',
    );

    expect(report.kings).toBe(1);
    expect(kings.rows).toHaveLength(1);
    expect(Number(kings.rows[0]?.player_id)).toBe(42);
    expect(kings.rows[0]?.dynasty_name).toBe('Leclerc');
  });

  it('does not hand a carried id to a new account', async () => {
    // Arrange: an ordinary reset carries a king and an account whose id is 1.
    await seed();
    await resetDatabase(pool);

    // Act: a new account after the reset.
    const { rows } = await pool.query<{ player_id: string }>(
      `INSERT INTO players (token_hash, dynasty_id) VALUES ($1, 'herse') RETURNING player_id`,
      ['b'.repeat(64)],
    );

    // Assert: the rebuilt sequence starts after the carried ids, not at 1.
    expect(Number(rows[0]?.player_id)).toBeGreaterThan(1);
  });

  it('previews the tables, the book and the accounts without changing anything', async () => {
    // Arrange
    await seed();

    // Act
    const preview = await previewReset(pool);

    // Assert: the table list and what crosses are read, and nothing is touched.
    const rowsOf = (name: string) => preview.tables.find((table) => table.name === name)?.rows;

    expect(preview.tables.map((table) => table.name)).toContain('players');
    expect(rowsOf('players')).toBe(1);
    expect(preview.kings).toBe(1);
    expect(preview.accounts).toBe(1);
    expect(preview.full).toBe(false);

    const players = await pool.query('SELECT count(*)::int AS count FROM players');
    expect(players.rows[0]?.count).toBe(1);
  });

  it('deletes the book and the accounts too when the reset is full', async () => {
    // Arrange
    await seed();

    // Act
    const report = await resetDatabase(pool, { full: true });

    // Assert: nothing is carried, and the schema is ready again.
    const kings = await pool.query('SELECT count(*)::int AS count FROM kings');
    const players = await pool.query('SELECT count(*)::int AS count FROM players');
    const migrations = await pool.query('SELECT count(*)::int AS count FROM schema_migrations');

    expect(kings.rows[0]?.count).toBe(0);
    expect(players.rows[0]?.count).toBe(0);
    expect(migrations.rows[0]?.count).toBeGreaterThan(0);
    expect(report).toMatchObject({ kings: 0, accounts: 0, full: true });
  });

  it('refuses an old book of kings whose shape it cannot read', async () => {
    // Arrange: the schema before the player id and the elapsed time, with one
    // crowned king. The reset must stop rather than cast.
    await pool.query('DROP TABLE kings');
    await pool.query(
      `CREATE TABLE kings (
         town_id text NOT NULL,
         season integer NOT NULL,
         crowned_at integer NOT NULL,
         token_hash text NOT NULL,
         house_name text NOT NULL,
         person_name text NOT NULL,
         ordinance text,
         staple_good text,
         PRIMARY KEY (town_id, season)
       )`,
    );
    await pool.query(
      `INSERT INTO kings (town_id, season, crowned_at, token_hash, house_name, person_name)
       VALUES ('saint-aubin', 1, 12, $1, 'Leclerc', 'Aubin')`,
      ['a'.repeat(64)],
    );

    // Act / Assert
    await expect(resetDatabase(pool)).rejects.toThrow(/old shape/);

    // The reset rolled back: the old book is still there.
    const kings = await pool.query('SELECT count(*)::int AS count FROM kings');
    expect(kings.rows[0]?.count).toBe(1);
  });

  it('refuses accounts of an old shape, which cannot keep their identity', async () => {
    // Arrange: the accounts before the stable player id, with one row. Carrying
    // it would either lose the king's link or invent an id.
    await pool.query('DROP TABLE players');
    await pool.query(
      `CREATE TABLE players (
         token_hash text PRIMARY KEY,
         world_id text NOT NULL,
         dynasty_id text,
         created_at timestamptz NOT NULL DEFAULT now(),
         last_seen_at timestamptz NOT NULL DEFAULT now(),
         revoked_at timestamptz,
         delete_after timestamptz,
         cursor_event_id bigint NOT NULL DEFAULT 0
       )`,
    );
    await pool.query(`INSERT INTO players (token_hash, world_id) VALUES ($1, 'saint-aubin')`, ['a'.repeat(64)]);

    // Act / Assert
    await expect(resetDatabase(pool)).rejects.toThrow(/old shape/);

    // The reset rolled back: the old accounts are still there.
    const players = await pool.query('SELECT count(*)::int AS count FROM players');
    expect(players.rows[0]?.count).toBe(1);
  });
});
