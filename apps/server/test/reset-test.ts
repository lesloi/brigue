import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { previewReset, resetDatabase } from '../src/db/reset.ts';

// Runs alone, after the parallel suite: the reset drops the schema the other
// Postgres tests use, so it is gated on RESET_DATABASE_URL and never part of
// `pnpm test` as usual.
const resetUrl = process.env.RESET_DATABASE_URL ?? '';

const CROWNED_AT = new Date('2026-01-01T12:00:00Z');

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
      `INSERT INTO players (token_hash, town_id, house_id) VALUES ($1, $2, 'leclerc') RETURNING player_id`,
      [tokenHash, townId],
    );
    const playerId = Number(playerRows[0]?.player_id);
    await pool.query(
      `INSERT INTO kings (player_id, house_name, person_name, crowned_at, elapsed_hours)
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

  it('keeps the book of kings and deletes the town with its accounts', async () => {
    // Arrange
    const { playerId } = await seed();

    // Act
    const report = await resetDatabase(pool);

    // Assert: the town and its accounts are gone, the book crosses.
    const state = await pool.query('SELECT count(*)::int AS count FROM state');
    const players = await pool.query('SELECT count(*)::int AS count FROM players');
    const kings = await pool.query<{ player_id: string; crowned_at: Date }>('SELECT player_id, crowned_at FROM kings');

    expect(state.rows[0]?.count).toBe(0);
    expect(players.rows[0]?.count).toBe(0);
    expect(kings.rows).toHaveLength(1);
    expect(Number(kings.rows[0]?.player_id)).toBe(playerId);
    expect(kings.rows[0]?.crowned_at.toISOString()).toBe(CROWNED_AT.toISOString());
    expect(report).toMatchObject({ kings: 1, full: false });
    expect(report.applied).toContain('0001_initial.sql');
  });

  it('does not hand a carried king id to a new account', async () => {
    // Arrange: an ordinary reset carries a king whose player_id is 1.
    const { townId } = await seed();
    await resetDatabase(pool);

    // Act: a new account after the reset.
    const { rows } = await pool.query<{ player_id: string }>(
      `INSERT INTO players (token_hash, town_id, house_id) VALUES ($1, $2, 'herse') RETURNING player_id`,
      ['b'.repeat(64), townId],
    );

    // Assert: the rebuilt sequence starts after the carried king, not at 1.
    expect(Number(rows[0]?.player_id)).toBeGreaterThan(1);
  });

  it('previews the tables and the book without changing anything', async () => {
    // Arrange
    await seed();

    // Act
    const preview = await previewReset(pool);

    // Assert: the table list and the king are read, and nothing is touched.
    const rowsOf = (name: string) => preview.tables.find((table) => table.name === name)?.rows;

    expect(preview.tables.map((table) => table.name)).toContain('players');
    expect(rowsOf('players')).toBe(1);
    expect(preview.kings).toBe(1);
    expect(preview.full).toBe(false);

    const players = await pool.query('SELECT count(*)::int AS count FROM players');
    expect(players.rows[0]?.count).toBe(1);
  });

  it('deletes the book too when the reset is full', async () => {
    // Arrange
    await seed();

    // Act
    const report = await resetDatabase(pool, { full: true });

    // Assert: nothing is carried, and the schema is ready again.
    const kings = await pool.query('SELECT count(*)::int AS count FROM kings');
    const migrations = await pool.query('SELECT count(*)::int AS count FROM schema_migrations');

    expect(kings.rows[0]?.count).toBe(0);
    expect(migrations.rows[0]?.count).toBeGreaterThan(0);
    expect(report).toMatchObject({ kings: 0, full: true });
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
});
