import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { previewReset, resetDatabase } from '../src/reset.ts';

// Runs alone, after the parallel suite: the reset drops the schema the other
// Postgres tests use, so it is gated on RESET_DATABASE_URL and never part of
// `pnpm test` as usual.
const resetUrl = process.env.RESET_DATABASE_URL ?? '';

describe.runIf(resetUrl !== '')('resetDatabase', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: resetUrl });
  });

  beforeEach(async () => {
    // Start every case from an empty database, sealed seasons included.
    await resetDatabase(pool, { full: true });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seed(): Promise<string> {
    // Arrange: a bound player, a sealed season and a town that should not
    // survive.
    const tokenHash = 'a'.repeat(64);
    await pool.query(`INSERT INTO players (token_hash, world_id, house_id) VALUES ($1, 'saint-aubin', 'leclerc')`, [
      tokenHash,
    ]);
    await pool.query(
      `INSERT INTO archive_houses (town_id, season, name, prestige, offices_held, title, generations, wealth_cents)
       VALUES ('saint-aubin', 1, 'Leclerc', 12, 3, 'roturier', 2, 5000)`,
    );
    await pool.query(
      `INSERT INTO kings (town_id, season, crowned_at, token_hash, house_name, person_name)
       VALUES ('saint-aubin', 1, 12, $1, 'Leclerc', 'Aubin')`,
      [tokenHash],
    );
    await pool.query(
      `INSERT INTO state (format_version, ruleset_version, seed, rng, hour, year, hour_started_at)
       VALUES (1, 1, 7, 7, 1, 1, now())`,
    );

    return tokenHash;
  }

  it('keeps the sealed seasons and deletes the town with its tokens', async () => {
    // Arrange
    await seed();

    // Act
    const report = await resetDatabase(pool);

    // Assert: the town and its tokens are gone, the register crosses.
    const state = await pool.query('SELECT count(*)::int AS count FROM state');
    const players = await pool.query('SELECT count(*)::int AS count FROM players');
    const archive = await pool.query('SELECT count(*)::int AS count FROM archive_houses');
    const kings = await pool.query('SELECT count(*)::int AS count FROM kings');

    expect(state.rows[0]?.count).toBe(0);
    expect(players.rows[0]?.count).toBe(0);
    expect(archive.rows[0]?.count).toBe(1);
    expect(kings.rows[0]?.count).toBe(1);
    expect(report).toMatchObject({ archivedHouses: 1, kings: 1, full: false });
    expect(report.applied).toContain('0001_initial.sql');
  });

  it('previews the tables and the sealed seasons without changing anything', async () => {
    // Arrange
    await seed();

    // Act
    const preview = await previewReset(pool);

    // Assert: the table list and the rows are read, and nothing is touched.
    const rowsOf = (name: string) => preview.tables.find((table) => table.name === name)?.rows;

    expect(preview.tables.map((table) => table.name)).toContain('players');
    expect(rowsOf('players')).toBe(1);
    expect(rowsOf('archive_houses')).toBe(1);
    expect(preview.archivedHouses).toBe(1);
    expect(preview.kings).toBe(1);
    expect(preview.full).toBe(false);

    const players = await pool.query('SELECT count(*)::int AS count FROM players');
    expect(players.rows[0]?.count).toBe(1);
  });

  it('deletes the sealed seasons too when the reset is full', async () => {
    // Arrange
    await seed();

    // Act
    const report = await resetDatabase(pool, { full: true });

    // Assert: nothing is carried, and the schema is ready again.
    const archive = await pool.query('SELECT count(*)::int AS count FROM archive_houses');
    const kings = await pool.query('SELECT count(*)::int AS count FROM kings');
    const migrations = await pool.query('SELECT count(*)::int AS count FROM schema_migrations');

    expect(archive.rows[0]?.count).toBe(0);
    expect(kings.rows[0]?.count).toBe(0);
    expect(migrations.rows[0]?.count).toBeGreaterThan(0);
    expect(report).toMatchObject({ archivedHouses: 0, kings: 0, full: true });
  });
});
